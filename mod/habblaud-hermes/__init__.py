"""Habblaud: mostra no escritório o que os agentes do Hermes estão fazendo e responde por ele.

Cada hook publica um evento pequeno no Habblaud local (``POST http://127.0.0.1:4747/api/hermes/events``).
A conversa da sessão aberta vai para o terminal do escritório; a caixa de mensagens injeta texto com
``ctx.inject_message``; e o transport ``habblaud`` leva as aprovações para o cartão do escritório,
com o prompt embutido do Hermes como fallback. A publicação é assíncrona (fila + thread daemon) e
falha em silêncio: o Habblaud fora do ar não afeta o Hermes.

Configuração (opcional):

    HABBLAUD_HERMES=0            desliga o plugin
    HABBLAUD_HERMES_URL=...      URL completa do POST (padrão: http://127.0.0.1:4747/api/hermes/events)
    HABBLAUD_PORT=...            porta do Habblaud quando a URL não é dada
    HABBLAUD_HERMES_PROJECT=...  sala do escritório (padrão: terminal.cwd do perfil)

O plugin é instalado como um symlink em ``~/.hermes/plugins/habblaud`` e em
``~/.hermes/profiles/<perfil>/plugins/habblaud`` por ``npm run hermes:install``, que também roda
``hermes [-p perfil] plugins enable habblaud`` e configura a injeção de mensagens e o transport de aprovação.
"""

from __future__ import annotations

import json
import logging
import os
import queue
import re
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional

try:
    from hermes_constants import get_hermes_home, profile_name_for_home
except ImportError:  # versões antigas ou validação estática
    def get_hermes_home() -> Path:
        return Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")

    def profile_name_for_home(path: Path) -> Optional[str]:
        return None

logger = logging.getLogger(__name__)

DEFAULT_PORT = 4747
QUEUE_MAX = 256
POST_TIMEOUT_S = 1.5
PREVIEW_MAX = 200
WARN_EVERY_S = 60.0
DISABLED_VALUES = {"0", "false", "off", "no"}

_queue: "queue.Queue[Dict[str, Any]]" = queue.Queue(maxsize=QUEUE_MAX)
_worker_lock = threading.Lock()
_worker_started = False
_warn_lock = threading.Lock()
_warn_at: Optional[float] = None
_warn_suppressed = 0
_last_pid = os.getpid()
_ctx = None
_contexts: list[tuple[Any, str, str]] = []
_plugin_profile = "default"
_poller_started = False
_poller_lock = threading.Lock()
_history_sent: set[str] = set()
_history_lock = threading.Lock()
_approval_context: dict[str, dict[str, str]] = {}
_approval_lock = threading.Lock()
_event_seq = 0
_event_lock = threading.Lock()

# O gateway do Hermes roda sessões concorrentes: guardar a última sessão global
# atribuiria a aprovação ao agente errado. O contexto é por thread/contexto.
try:
    import contextvars
    _current_session_id = contextvars.ContextVar("habblaud_session_id", default="")
    _current_call_id = contextvars.ContextVar("habblaud_call_id", default="")
except Exception:  # pragma: no cover — Python mínimo sem contextvars
    class _Var:
        def __init__(self) -> None:
            self.value = ""

        def get(self) -> str:
            return self.value

        def set(self, value: str) -> None:
            self.value = value

    _current_session_id = _Var()
    _current_call_id = _Var()


# ---------------------------------------------------------------------------
# Configuração e caminhos
# ---------------------------------------------------------------------------

def _disabled() -> bool:
    return str(os.environ.get("HABBLAUD_HERMES", "")).strip().lower() in DISABLED_VALUES


def _url() -> str:
    explicit = str(os.environ.get("HABBLAUD_HERMES_URL", "")).strip()
    if explicit:
        return explicit
    port = str(os.environ.get("HABBLAUD_PORT", "")).strip() or str(DEFAULT_PORT)
    return f"http://127.0.0.1:{port}/api/hermes/events"


def _base() -> str:
    parts = urllib.parse.urlsplit(_url())
    return f"{parts.scheme}://{parts.netloc}"


def _http_json(path: str, body: Optional[dict[str, Any]] = None, *, timeout: float = 3.0) -> Optional[dict[str, Any]]:
    """One local JSON request; None on any failure (never raises)."""
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    method = "GET" if body is None else "POST"
    request = urllib.request.Request(
        f"{_base()}{path}",
        data=data,
        method=method,
        headers={"Accept": "application/json", **({"Content-Type": "application/json"} if data else {})},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 — URL local
            raw = response.read(2 * 1024 * 1024)
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else None
    except Exception as exc:
        _warn(exc)
        return None


def _clip(value: Any, limit: int) -> str:
    text = "" if value is None else str(value)
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _text_of(value: Any, limit: int = 20_000) -> str:
    if isinstance(value, str):
        return _clip(value, limit)
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and item.get("type") == "text" and isinstance(item.get("text"), str):
                parts.append(item["text"])
            elif isinstance(item, dict) and item.get("type") == "image":
                parts.append("[imagem]")
        return _clip("\n".join(parts), limit)
    if isinstance(value, dict):
        for key in ("text", "content", "message", "output", "result"):
            if key in value:
                return _text_of(value[key], limit)
        try:
            return _clip(json.dumps(value, ensure_ascii=False, default=str), limit)
        except Exception:
            return ""
    return ""


def _jsonable(value: Any, limit: int = 8_000) -> Any:
    try:
        raw = json.dumps(value, ensure_ascii=False, default=str)
    except Exception:
        return {}
    if len(raw) > limit:
        return {"_truncated": raw[:limit]}
    try:
        parsed = json.loads(raw)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _profile() -> str:
    try:
        home = Path(get_hermes_home())
    except Exception:
        home = Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")
    try:
        name = profile_name_for_home(home)
    except Exception:
        name = None
    if name:
        return str(name)
    # profiles/<nome>/config.yaml; ~/.hermes/config.yaml é o perfil default.
    if home.parent.name == "profiles" and home.name:
        return home.name
    return "default"


def _home() -> str:
    try:
        return str(Path(get_hermes_home()).expanduser())
    except Exception:
        return str(Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes").expanduser())


def _profile_cwd() -> Optional[str]:
    """`terminal.cwd` do perfil (o mesmo diretório em que o Hermes trabalha)."""
    path = Path(_home()) / "config.yaml"
    raw: Optional[str] = None
    try:
        import yaml  # type: ignore

        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        terminal = data.get("terminal") if isinstance(data, dict) else None
        if isinstance(terminal, dict):
            value = terminal.get("cwd")
            if isinstance(value, str) and value.strip():
                raw = value.strip()
    except Exception:
        # Sem PyYAML ou config ilegível: um recorte mínimo do bloco terminal/cwd.
        try:
            text = path.read_text(encoding="utf-8")
            match = re.search(r"(?ms)^terminal:\s*\n(?:[ \t]+.*\n)*?[ \t]+cwd:\s*['\"]?([^'\"\n]+)", text)
            if match:
                raw = match.group(1).strip()
        except Exception:
            raw = None
    if not raw:
        return os.getcwd()
    expanded = os.path.expanduser(os.path.expandvars(raw))
    return os.path.abspath(expanded)


def _project(kw: Dict[str, Any]) -> str:
    explicit = str(os.environ.get("HABBLAUD_HERMES_PROJECT", "")).strip()
    if explicit:
        return os.path.abspath(os.path.expanduser(os.path.expandvars(explicit)))
    for key in ("project", "cwd", "directory"):
        value = kw.get(key)
        if isinstance(value, str) and value.strip():
            return os.path.abspath(os.path.expanduser(os.path.expandvars(value.strip())))
    return _profile_cwd() or os.getcwd()


def _short(value: Any, limit: int = PREVIEW_MAX) -> str:
    text = "" if value is None else str(value)
    text = text.replace("\r", "").split("\n")[0].strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _preview(args: Any) -> str:
    if not isinstance(args, dict):
        return ""
    for key in ("command", "path", "query", "url", "goal", "pattern", "prompt", "file_path"):
        value = args.get(key)
        if isinstance(value, str) and value.strip():
            return _short(value)
    return ""


# ---------------------------------------------------------------------------
# Publicação assíncrona (o hook nunca espera a rede)
# ---------------------------------------------------------------------------

def _warn(exc: BaseException) -> None:
    global _warn_at, _warn_suppressed
    try:
        with _warn_lock:
            now = time.monotonic()
            if _warn_at is not None and now - _warn_at < WARN_EVERY_S:
                _warn_suppressed = min(_warn_suppressed + 1, 1_000_000)
                return
            suppressed = _warn_suppressed
            _warn_suppressed = 0
            _warn_at = now
        logger.warning(
            "habblaud: evento não entregue (%s); %d avisos iguais suprimidos. O escritório segue funcionando.",
            type(exc).__name__,
            suppressed,
        )
    except Exception:
        pass


def _post(body: Dict[str, Any]) -> None:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        _url(),
        data=data,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=POST_TIMEOUT_S) as response:  # noqa: S310 — URL local
        response.read(1024)


def _worker() -> None:
    while True:
        body = _queue.get()
        try:
            if body is None:
                return
            _post(body)
        except Exception as exc:  # observador: nunca propaga
            _warn(exc)
        finally:
            _queue.task_done()


def _start_worker() -> None:
    global _worker_started
    with _worker_lock:
        if _worker_started:
            return
        thread = threading.Thread(target=_worker, name="habblaud-hermes", daemon=True)
        thread.start()
        _worker_started = True


def _after_fork() -> None:
    """O filho não herda as threads do pai; recomeça fila, poller e travas para não repetir eventos do pai."""
    global _queue, _worker_started, _last_pid, _poller_started, _poller_lock, _event_lock, _history_lock, _approval_lock
    _queue = queue.Queue(maxsize=QUEUE_MAX)
    _worker_started = False
    _last_pid = os.getpid()
    _poller_started = False
    _poller_lock = threading.Lock()
    _event_lock = threading.Lock()
    _history_lock = threading.Lock()
    _approval_lock = threading.Lock()


def _publish(event: Dict[str, Any]) -> None:
    global _event_seq
    if _disabled():
        return
    if not isinstance(event, dict) or not event.get("type"):
        return
    if os.getpid() != _last_pid:
        _after_fork()
    with _event_lock:
        _event_seq += 1
        seq = _event_seq
    event.setdefault("ts", time.time())
    event.setdefault("event_id", f"{os.getpid()}-{time.time_ns()}-{seq}")
    body = {"profile": _profile(), "home": _home(), "event": event}
    _start_worker()
    try:
        _queue.put_nowait(body)
    except queue.Full:
        _warn(RuntimeError("fila cheia"))


# ---------------------------------------------------------------------------
# Hooks (todos observadores; sempre devolvem None)
# ---------------------------------------------------------------------------

def _on_session_open(**kw: Any) -> None:
    _publish({
        "type": "session_open",
        "session_id": kw.get("session_id"),
        "platform": kw.get("platform"),
        "reason": kw.get("reason"),
        "project": _project(kw),
    })
    _start_poller()


def _on_session_start(**kw: Any) -> None:
    _publish({
        "type": "session_start",
        "session_id": kw.get("session_id"),
        "platform": kw.get("platform"),
        "model": kw.get("model"),
        "project": _project(kw),
    })
    _start_poller()


def _on_session_end(**kw: Any) -> None:
    _publish({
        "type": "session_end",
        "session_id": kw.get("session_id"),
        "completed": kw.get("completed"),
        "failed": kw.get("failed"),
        "interrupted": kw.get("interrupted"),
        "turn_exit_reason": kw.get("turn_exit_reason"),
        "platform": kw.get("platform"),
    })


def _on_session_finalize(**kw: Any) -> None:
    _publish({"type": "session_finalize", "session_id": kw.get("session_id")})


def _on_session_reset(**kw: Any) -> None:
    _publish({"type": "session_reset", "session_id": kw.get("session_id")})


def _on_session_delete(**kw: Any) -> None:
    _publish({"type": "session_delete", "session_id": kw.get("session_id")})


def _publish_history(session_id: str, history: Any) -> None:
    key = f"{_profile()}:{session_id}"
    with _history_lock:
        if key in _history_sent:
            return
        # O primeiro turno é a única chance: se o histórico vier vazio (sessão nova), os turnos seguintes já
        # aparecem ao vivo como user_message/assistant_message.
        _history_sent.add(key)
    if not isinstance(history, list) or not history:
        return
    messages = []
    for item in history[-101:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        if role not in ("user", "assistant"):
            continue
        text = _text_of(item.get("content"))
        if text.strip():
            messages.append({"role": role, "content": text})
    # A lista do hook termina com a mensagem deste turno; ela sai em user_message, não no histórico.
    if messages and messages[-1]["role"] == "user":
        messages.pop()
    messages = messages[-100:]
    if messages:
        _publish({"type": "history", "session_id": session_id, "messages": messages})


def _pre_llm_call(**kw: Any) -> None:
    sid = kw.get("session_id")
    if isinstance(sid, str) and sid:
        _publish_history(sid, kw.get("conversation_history"))
        text = _text_of(kw.get("user_message"))
        if text.strip():
            _publish({"type": "user_message", "session_id": sid, "text": text, "turn_id": kw.get("turn_id")})
    _publish({"type": "session_busy", "session_id": sid, "platform": kw.get("platform") or "hermes"})


def _post_llm_call(**kw: Any) -> None:
    sid = kw.get("session_id")
    if isinstance(sid, str) and sid:
        text = _text_of(kw.get("assistant_response"))
        if text.strip():
            _publish({"type": "assistant_message", "session_id": sid, "text": text, "turn_id": kw.get("turn_id")})
    _publish({"type": "session_idle", "session_id": sid, "platform": kw.get("platform") or "hermes"})


def _pre_tool_call(**kw: Any) -> None:
    sid = str(kw.get("session_id") or "")
    call = str(kw.get("tool_call_id") or kw.get("call_id") or "")
    _current_session_id.set(sid)
    _current_call_id.set(call)
    _publish({
        "type": "tool_start",
        "session_id": sid,
        "call_id": call,
        "tool_name": kw.get("tool_name"),
        "preview": _preview(kw.get("args")),
        "input": _jsonable(kw.get("args") or {}),
    })
    return None


def _post_tool_call(**kw: Any) -> None:
    _publish({
        "type": "tool_end",
        "session_id": kw.get("session_id"),
        "call_id": kw.get("tool_call_id") or kw.get("call_id") or "",
        "tool_name": kw.get("tool_name"),
        "status": kw.get("status") or "ok",
        "error_message": _short(kw.get("error_message")),
        "result": _text_of(kw.get("result")),
        "duration_ms": kw.get("duration_ms"),
    })
    return None


def _subagent_start(**kw: Any) -> None:
    _publish({
        "type": "subagent_start",
        "parent_session_id": kw.get("parent_session_id"),
        "child_session_id": kw.get("child_session_id"),
        "child_role": kw.get("child_role"),
        "child_goal": _short(kw.get("child_goal"), 300),
        "project": _project(kw),
    })


def _subagent_stop(**kw: Any) -> None:
    _publish({
        "type": "subagent_stop",
        "parent_session_id": kw.get("parent_session_id"),
        "child_session_id": kw.get("child_session_id"),
        "child_role": kw.get("child_role"),
        "child_status": kw.get("child_status"),
        "child_summary": _short(kw.get("child_summary"), 300),
        "duration_ms": kw.get("duration_ms"),
    })


def _approval_identity(kw: Dict[str, Any]) -> tuple[str, str]:
    # O hook documenta `session_key`; em CLI/TUI ele é o id da sessão. O id de observabilidade vem quando existe.
    sid = str(kw.get("session_id") or _current_session_id.get() or kw.get("session_key") or "")
    call = str(kw.get("tool_call_id") or kw.get("call_id") or "")
    if not call and sid == _current_session_id.get():
        call = _current_call_id.get()
    return sid, call


def _pre_approval_request(**kw: Any) -> None:
    sid, call = _approval_identity(kw)
    request_id = str(kw.get("request_id") or "")
    if request_id and sid:
        with _approval_lock:
            _approval_context[request_id] = {"session_id": sid, "profile": _profile(), "home": _home()}
    _publish({
        "type": "approval_request",
        "session_id": sid,
        "call_id": call,
        "request_id": request_id,
        "command": _short(kw.get("command") or kw.get("description")),
        "description": _short(kw.get("description")),
        "surface": kw.get("surface"),
    })


def _post_approval_response(**kw: Any) -> None:
    sid, call = _approval_identity(kw)
    request_id = str(kw.get("request_id") or "")
    if request_id:
        with _approval_lock:
            _approval_context.pop(request_id, None)
    _publish({
        "type": "approval_response",
        "session_id": sid,
        "call_id": call,
        "request_id": request_id,
        "choice": kw.get("choice"),
    })


def _post_api_request(**kw: Any) -> None:
    source = kw.get("usage")
    sid = kw.get("session_id")
    if not isinstance(source, dict) or not isinstance(sid, str) or not sid:
        return
    usage_id = kw.get("api_request_id")
    if not isinstance(usage_id, str) or not usage_id:
        started = kw.get("started_at")
        call = kw.get("api_call_count")
        usage_id = f"{sid}:{started or ''}:{call or ''}"
        # Sem nenhuma identidade da tentativa, um id único evita que o servidor trate todas como a mesma medição.
        if started is None and call is None:
            usage_id = f"{usage_id}:{time.time_ns()}"
    event: Dict[str, Any] = {
        "type": "usage",
        "session_id": sid,
        "usage_id": usage_id,
        "usage_scope": "api_request",
        "model": kw.get("response_model") or kw.get("model"),
        "provider": kw.get("provider"),
        "platform": kw.get("platform"),
    }
    fields = {
        "prompt_tokens": "input_tokens",
        "output_tokens": "output_tokens",
        "cache_read_tokens": "cached_input_tokens",
        "cache_write_tokens": "cache_write_tokens",
        "reasoning_tokens": "reasoning_output_tokens",
        "total_tokens": "total_tokens",
    }
    for source_key, target_key in fields.items():
        value = source.get(source_key)
        if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= (1 << 53) - 1:
            event[target_key] = value
    _publish(event)


class _ApprovalFallback(Exception):
    """No office answer: let the host fall back to the built-in terminal prompt."""


def _approval_present(request: Any):
    """Approval transport: turn the Hermes approval into a Habblaud card and wait for the answer."""
    request_id = str(getattr(request, "request_id", "") or "")
    with _approval_lock:
        where = dict(_approval_context.get(request_id) or {})
    session_id = where.get("session_id", "")
    if not request_id or not session_id:
        raise _ApprovalFallback("sem sessão para o pedido")
    body = {
        "provider": "hermes",
        "account": where.get("profile") or _profile(),
        "session_id": session_id,
        "tool_name": "terminal",
        "tool_input": {
            "command": getattr(request, "command", "") or "",
            "description": getattr(request, "description", "") or "",
        },
        "timeout_ms": int(max(5.0, float(getattr(request, "timeout_seconds", 300.0) or 300.0)) * 1000),
    }
    created = _http_json("/api/permissions", body, timeout=4.0)
    if not created or not created.get("id") or created.get("skip"):
        raise _ApprovalFallback("escritório sem página ou sessão desconhecida")
    permission_id = str(created["id"])
    deadline = time.monotonic() + max(5.0, float(getattr(request, "timeout_seconds", 300.0) or 300.0))
    while time.monotonic() < deadline:
        answer = _http_json(f"/api/permissions/{urllib.parse.quote(permission_id, safe='')}/wait?timeout=20", None, timeout=25.0)
        if not answer:
            raise _ApprovalFallback("Habblaud não respondeu")
        status = answer.get("status")
        if status == "decided":
            behavior = answer.get("behavior")
            if behavior == "allow":
                return request.respond("once")
            if behavior == "deny":
                return request.respond("deny")
            raise _ApprovalFallback("resposta que o transport não entende")
        if status == "released":
            raise _ApprovalFallback("devolvido ao terminal")
    raise _ApprovalFallback("tempo esgotado no escritório")


def _poll_once() -> None:
    """One inbox round; separated from the loop so tests can call it without sleeping."""
    if _disabled():
        return
    contexts = list(_contexts) or ([(_ctx, _plugin_profile, _home())] if _ctx is not None else [])
    if not contexts:
        return
    listing = _http_json("/api/hermes/sessions", None, timeout=4.0)
    sessions = listing.get("sessions") if isinstance(listing, dict) else None
    for ctx, profile, _home_dir in contexts:
        if not hasattr(ctx, "inject_message"):
            continue
        for item in sessions if isinstance(sessions, list) else []:
            if not isinstance(item, dict) or item.get("profile") != profile:
                continue
            session = item.get("session")
            account = item.get("account")
            if not isinstance(session, str) or not session:
                continue
            inbox = _http_json(
                "/api/mod/inbox",
                {"provider": "hermes", "account": account, "session": session, "profile": profile},
                timeout=4.0,
            )
            messages = inbox.get("messages") if isinstance(inbox, dict) else None
            for message in messages if isinstance(messages, list) else []:
                if not isinstance(message, dict):
                    continue
                mid, text = message.get("id"), message.get("text")
                if not isinstance(mid, str) or not isinstance(text, str) or not text.strip():
                    continue
                try:
                    delivered = bool(ctx.inject_message(text, session_key=session))
                except Exception as exc:
                    _warn(exc)
                    delivered = False
                # Outro processo do mesmo perfil pode ser o dono da sessão: devolve à fila para ele buscar.
                if delivered:
                    _http_json("/api/mod/inbox/ack", {"session": session, "results": [{"id": mid, "ok": True}]}, timeout=4.0)
                else:
                    _http_json(
                        "/api/mod/inbox/ack",
                        {"session": session, "results": [{"id": mid, "ok": False, "retry": True, "error": "sessão não está neste processo do Hermes"}]},
                        timeout=4.0,
                    )


def _poll_inbox() -> None:
    """Polls the office for messages and injects them into the live Hermes sessions."""
    while True:
        try:
            _poll_once()
        except Exception as exc:
            _warn(exc)
        time.sleep(2.0)


def _start_poller() -> None:
    global _poller_started
    with _poller_lock:
        if _poller_started:
            return
        threading.Thread(target=_poll_inbox, name="habblaud-hermes-inbox", daemon=True).start()
        _poller_started = True


def register(ctx: Any) -> None:
    """Registra os hooks; nomes opcionais só entram quando o Hermes desta versão os conhece."""
    global _ctx, _plugin_profile
    _ctx = ctx
    _plugin_profile = _profile()
    if not any(item[0] is ctx for item in _contexts):
        _contexts.append((ctx, _plugin_profile, _home()))
    core = (
        ("on_session_start", _on_session_start),
        ("on_session_end", _on_session_end),
        ("pre_tool_call", _pre_tool_call),
        ("post_tool_call", _post_tool_call),
        ("subagent_start", _subagent_start),
        ("subagent_stop", _subagent_stop),
        ("pre_approval_request", _pre_approval_request),
        ("post_approval_response", _post_approval_response),
    )
    optional = (
        ("on_session_open", _on_session_open),
        ("on_session_finalize", _on_session_finalize),
        ("on_session_reset", _on_session_reset),
        ("on_session_delete", _on_session_delete),
        ("pre_llm_call", _pre_llm_call),
        ("post_llm_call", _post_llm_call),
        ("post_api_request", _post_api_request),
    )
    for name, callback in core:
        ctx.register_hook(name, callback)
    try:
        from hermes_cli.plugins import VALID_HOOKS  # type: ignore
    except (ImportError, AttributeError):
        VALID_HOOKS = set()
    for name, callback in optional:
        if name in VALID_HOOKS:
            ctx.register_hook(name, callback)
    try:
        ctx.register_approval_transport("habblaud", _approval_present)
    except (AttributeError, TypeError, ValueError):
        logger.info("habblaud: approval transport indisponível nesta versão do Hermes")
    logger.info("habblaud: plugin do escritório registrado — eventos para %s", _url())

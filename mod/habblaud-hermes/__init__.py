"""Habblaud: mostra no escritório o que os agentes do Hermes estão fazendo.

Observador, não participante: cada hook publica um evento pequeno no Habblaud local
(``POST http://127.0.0.1:4747/api/hermes/events``). Nada volta para a conversa, nenhum
prompt/transcript é enviado e o hook nunca bloqueia o agente. A publicação é assíncrona
(fila + thread daemon) e falha em silêncio: o Habblaud fora do ar não afeta o Hermes.

O escritório mostra sessões, status, ferramentas, subagentes, aprovações (só o estado
"esperando") e tokens. Terminal/histórico do Hermes ainda não existem nesta fase.

Configuração (opcional):

    HABBLAUD_HERMES=0            desliga o plugin
    HABBLAUD_HERMES_URL=...      URL completa do POST (padrão: http://127.0.0.1:4747/api/hermes/events)
    HABBLAUD_PORT=...            porta do Habblaud quando a URL não é dada
    HABBLAUD_HERMES_PROJECT=...  sala do escritório (padrão: terminal.cwd do perfil)

O plugin é instalado como um symlink em ``~/.hermes/plugins/habblaud`` por
``npm run hermes:install`` e habilitado por perfil com ``hermes [-p perfil] plugins enable habblaud``.
"""

from __future__ import annotations

import json
import logging
import os
import queue
import re
import threading
import time
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
    """O filho não herda a thread do pai; recomeça a fila para não repetir eventos do pai."""
    global _queue, _worker_started, _last_pid
    _queue = queue.Queue(maxsize=QUEUE_MAX)
    _worker_started = False
    _last_pid = os.getpid()


def _publish(event: Dict[str, Any]) -> None:
    if _disabled():
        return
    if not isinstance(event, dict) or not event.get("type"):
        return
    if os.getpid() != _last_pid:
        _after_fork()
    event.setdefault("ts", time.time())
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


def _on_session_start(**kw: Any) -> None:
    _publish({
        "type": "session_start",
        "session_id": kw.get("session_id"),
        "platform": kw.get("platform"),
        "model": kw.get("model"),
        "project": _project(kw),
    })


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


def _pre_llm_call(**kw: Any) -> None:
    _publish({"type": "session_busy", "session_id": kw.get("session_id"), "platform": kw.get("platform") or "hermes"})


def _post_llm_call(**kw: Any) -> None:
    _publish({"type": "session_idle", "session_id": kw.get("session_id"), "platform": kw.get("platform") or "hermes"})


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
    sid = str(kw.get("session_id") or _current_session_id.get() or "")
    call = str(kw.get("tool_call_id") or kw.get("call_id") or "")
    if not call and sid == _current_session_id.get():
        call = _current_call_id.get()
    return sid, call


def _pre_approval_request(**kw: Any) -> None:
    sid, call = _approval_identity(kw)
    _publish({
        "type": "approval_request",
        "session_id": sid,
        "call_id": call,
        "request_id": kw.get("request_id") or "",
        "command": _short(kw.get("command") or kw.get("description")),
        "surface": kw.get("surface"),
    })


def _post_approval_response(**kw: Any) -> None:
    sid, call = _approval_identity(kw)
    _publish({
        "type": "approval_response",
        "session_id": sid,
        "call_id": call,
        "request_id": kw.get("request_id") or "",
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


def register(ctx: Any) -> None:
    """Registra os hooks; nomes opcionais só entram quando o Hermes desta versão os conhece."""
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
    logger.info("habblaud: plugin do escritório registrado — eventos para %s", _url())

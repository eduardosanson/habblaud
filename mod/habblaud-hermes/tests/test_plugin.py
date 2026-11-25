"""Testes do plugin do Hermes sem uma sessão real: hooks puros + fila assíncrona com `_post` falso."""
from __future__ import annotations

import importlib.util
import sys
import time
import types
from pathlib import Path

import pytest

PLUGIN = Path(__file__).resolve().parents[1] / "__init__.py"


def load(tmp_path: Path):
    home = tmp_path / "profiles" / "developer"
    home.mkdir(parents=True)
    (home / "config.yaml").write_text("terminal:\n  cwd: /tmp/projeto\n", encoding="utf-8")
    constants = types.ModuleType("hermes_constants")
    constants.get_hermes_home = lambda: home
    constants.profile_name_for_home = lambda _home: "developer"
    sys.modules["hermes_constants"] = constants
    sys.modules.pop("habblaud_hermes_test", None)
    spec = importlib.util.spec_from_file_location("habblaud_hermes_test", PLUGIN)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_profile_home_and_project(tmp_path):
    plugin = load(tmp_path)
    assert plugin._profile() == "developer"
    assert plugin._home().endswith("profiles/developer")
    assert plugin._project({}) == "/tmp/projeto"
    assert plugin._project({"project": "/p/loja"}) == "/p/loja"


def test_tool_and_approval_events_use_the_hook_context(tmp_path, monkeypatch):
    plugin = load(tmp_path)
    events = []
    monkeypatch.setattr(plugin, "_publish", events.append)

    assert plugin._pre_tool_call(session_id="s1", tool_call_id="c1", tool_name="terminal", args={"command": "npm test"}) is None
    assert events[-1] == {
        "type": "tool_start", "session_id": "s1", "call_id": "c1", "tool_name": "terminal",
        "preview": "npm test", "input": {"command": "npm test"},
    }

    plugin._pre_approval_request(command="rm -rf /tmp/x", surface="cli")
    assert events[-1]["type"] == "approval_request"
    assert events[-1]["session_id"] == "s1" and events[-1]["call_id"] == "c1"
    assert plugin._post_approval_response(choice="approve") is None
    assert events[-1] == {"type": "approval_response", "session_id": "s1", "call_id": "c1", "request_id": "", "choice": "approve"}


def test_usage_is_normalized_and_private_fields_are_not_sent(tmp_path, monkeypatch):
    plugin = load(tmp_path)
    events = []
    monkeypatch.setattr(plugin, "_publish", events.append)
    plugin._post_api_request(
        session_id="s1",
        api_request_id="req1",
        response_model="hermes-4",
        provider="p",
        user_message="segredo do usuário",
        usage={"prompt_tokens": 35, "output_tokens": 8, "cache_read_tokens": 20, "reasoning_tokens": 3},
    )
    event = events[-1]
    assert event["type"] == "usage" and event["usage_id"] == "req1"
    assert event["input_tokens"] == 35 and event["output_tokens"] == 8
    assert event["cached_input_tokens"] == 20 and event["reasoning_output_tokens"] == 3
    assert "segredo" not in str(event)
    # Sem usage ou sem sessão não publica.
    before = len(events)
    plugin._post_api_request(session_id="s1", usage=None)
    plugin._post_api_request(session_id="", usage={"prompt_tokens": 1})
    assert len(events) == before


def test_register_only_adds_optional_hooks_the_runtime_knows(tmp_path):
    plugin = load(tmp_path)
    plugins = types.ModuleType("hermes_cli.plugins")
    plugins.VALID_HOOKS = {"pre_llm_call", "post_llm_call", "post_api_request"}
    sys.modules["hermes_cli.plugins"] = plugins

    class Ctx:
        def __init__(self):
            self.hooks = {}

        def register_hook(self, name, callback):
            self.hooks[name] = callback

    ctx = Ctx()
    plugin.register(ctx)
    assert {"on_session_start", "on_session_end", "pre_tool_call", "post_tool_call",
            "subagent_start", "subagent_stop", "pre_approval_request", "post_approval_response"} <= set(ctx.hooks)
    assert {"pre_llm_call", "post_llm_call", "post_api_request"} <= set(ctx.hooks)
    assert "on_session_open" not in ctx.hooks


def test_worker_posts_enqueued_events(tmp_path, monkeypatch):
    plugin = load(tmp_path)
    posted = []
    monkeypatch.setattr(plugin, "_post", posted.append)
    plugin._queue = plugin.queue.Queue(maxsize=10)
    plugin._worker_started = False
    plugin._publish({"type": "session_busy", "session_id": "s1"})
    for _ in range(100):
        if posted:
            break
        time.sleep(0.01)
    assert posted and posted[0]["profile"] == "developer"
    assert posted[0]["event"]["type"] == "session_busy"
    assert posted[0]["event"]["ts"] > 0


def test_llm_turn_sends_history_prompt_and_response_once(tmp_path, monkeypatch):
    plugin = load(tmp_path)
    events = []
    monkeypatch.setattr(plugin, "_publish", events.append)
    history = [
        {"role": "system", "content": "prompt do sistema"},
        {"role": "user", "content": "primeira"},
        {"role": "assistant", "content": "resposta"},
        # O hook entrega a lista com a mensagem deste turno no fim; ela não pode repetir no histórico.
        {"role": "user", "content": "agora"},
    ]
    plugin._pre_llm_call(session_id="s1", turn_id="t1", user_message="agora", conversation_history=history)
    kinds = [e["type"] for e in events]
    assert kinds == ["history", "user_message", "session_busy"]
    assert events[0]["messages"] == [{"role": "user", "content": "primeira"}, {"role": "assistant", "content": "resposta"}]
    assert events[1]["text"] == "agora" and events[1]["turn_id"] == "t1"

    # A segunda rodada não repete o histórico; manda só o novo prompt e a resposta.
    events.clear()
    plugin._pre_llm_call(session_id="s1", turn_id="t2", user_message="de novo", conversation_history=history)
    plugin._post_llm_call(session_id="s1", turn_id="t2", assistant_response="feito")
    assert [e["type"] for e in events] == ["user_message", "session_busy", "assistant_message", "session_idle"]
    assert events[2]["text"] == "feito"


def test_approval_context_falls_back_to_session_key(tmp_path, monkeypatch):
    plugin = load(tmp_path)
    monkeypatch.setattr(plugin, "_publish", lambda event: None)
    # O contrato documenta session_key; session_id nem sempre vem no hook.
    plugin._pre_approval_request(session_key="sess-9", request_id="r9", command="ls", surface="cli")
    assert plugin._approval_context["r9"]["session_id"] == "sess-9"
    plugin._post_approval_response(session_key="sess-9", request_id="r9", choice="once")
    assert "r9" not in plugin._approval_context


def test_approval_transport_posts_to_the_office_and_returns_the_choice(tmp_path, monkeypatch):
    plugin = load(tmp_path)
    plugin._approval_context["r1"] = {"session_id": "s1", "profile": "developer"}
    calls = []
    answers = [{"id": "p1"}, {"status": "decided", "behavior": "allow"}]

    def fake_http(path, body=None, *, timeout=3.0):
        calls.append((path, body))
        return answers.pop(0)

    monkeypatch.setattr(plugin, "_http_json", fake_http)

    class Request:
        request_id = "r1"
        timeout_seconds = 10
        command = "rm -rf /tmp/x"
        description = "Apagar"

        def respond(self, choice):
            return {"request_id": self.request_id, "choice": choice}

    assert plugin._approval_present(Request()) == {"request_id": "r1", "choice": "once"}
    assert calls[0][0] == "/api/permissions"
    assert calls[0][1]["provider"] == "hermes" and calls[0][1]["session_id"] == "s1"
    assert calls[1][0].startswith("/api/permissions/p1/wait")


def test_approval_transport_falls_back_when_the_office_cannot_answer(tmp_path, monkeypatch):
    plugin = load(tmp_path)
    plugin._approval_context["r1"] = {"session_id": "s1", "profile": "developer"}
    monkeypatch.setattr(plugin, "_http_json", lambda *a, **k: {"skip": "no-viewers"})

    class Request:
        request_id = "r1"
        timeout_seconds = 10
        command = "ls"
        description = ""

        def respond(self, choice):
            raise AssertionError("não deveria responder")

    with pytest.raises(plugin._ApprovalFallback):
        plugin._approval_present(Request())


def office(plugin, monkeypatch, sessions, text="Pergunta pelo roadmap: como ficou?"):
    """Escritório falso: entrega uma mensagem por sessão, uma vez, e guarda as confirmações."""
    acks, served = [], set()

    def fake_http(path, body=None, *, timeout=3.0):
        if path == "/api/hermes/sessions":
            return {"sessions": [{"profile": "developer", "account": "developer", "session": s} for s in sessions]}
        if path == "/api/mod/inbox":
            sid = body["session"]
            if sid in served:
                return {"messages": []}
            served.add(sid)
            return {"messages": [{"id": f"m-{sid}", "text": text}]}
        if path == "/api/mod/inbox/ack":
            acks.append(body)
            return {"ok": True}
        return None

    monkeypatch.setattr(plugin, "_http_json", fake_http)
    monkeypatch.setattr(plugin, "_publish", lambda event: None)
    monkeypatch.setattr(plugin, "_start_poller", lambda: None)
    return acks


class Ctx:
    def __init__(self, accepted=True):
        self.accepted, self.calls = accepted, []

    def inject_message(self, text, *, session_key=None):
        self.calls.append((text, session_key))
        return self.accepted


def test_inbox_injects_with_the_route_key_of_the_session(tmp_path, monkeypatch):
    plugin = load(tmp_path)
    plugin._plugin_profile = "developer"
    plugin._ctx = ctx = Ctx()
    office(plugin, monkeypatch, ["local-abc"])
    monkeypatch.setattr(plugin, "_session_route", lambda: "agent:main:local:dm:local-abc")
    plugin._on_session_open(session_id="local-abc", platform="cli")
    plugin._poll_once()
    assert ctx.calls[0][1] == "agent:main:local:dm:local-abc"


def test_inbox_only_confirms_when_the_question_enters_the_session(tmp_path, monkeypatch):
    plugin = load(tmp_path)
    plugin._plugin_profile = "developer"
    plugin._ctx = Ctx()
    acks = office(plugin, monkeypatch, ["s1"])
    plugin._poll_once()
    assert acks == [], "aceitar o agendamento não é entregar"
    plugin._pre_llm_call(session_id="s2", user_message="Pergunta pelo roadmap: como ficou?")
    plugin._pre_llm_call(session_id="s1", user_message="outra coisa")
    assert acks == []
    plugin._pre_llm_call(session_id="s1", user_message="Pergunta pelo roadmap: como ficou?")
    assert acks == [{"session": "s1", "results": [{"id": "m-s1", "ok": True}]}]
    plugin._pre_llm_call(session_id="s1", user_message="Pergunta pelo roadmap: como ficou?")
    assert len(acks) == 1


def test_inbox_returns_to_the_queue_what_the_host_refused(tmp_path, monkeypatch):
    plugin = load(tmp_path)
    plugin._plugin_profile = "developer"
    plugin._ctx = ctx = Ctx(accepted=False)
    acks = office(plugin, monkeypatch, ["s1"])
    plugin._poll_once()
    assert ctx.calls[0][1] == "s1", "sem chave de rota conhecida, tenta o id da sessão"
    assert acks[0]["results"][0]["ok"] is False and acks[0]["results"][0]["retry"] is True


def test_register_optional_hooks_and_approval_transport(tmp_path, monkeypatch):
    plugin = load(tmp_path)
    registered = []

    class Ctx:
        def register_hook(self, name, callback):
            registered.append(name)

        def register_approval_transport(self, name, present):
            registered.append(f"transport:{name}")

    monkeypatch.setattr(plugin, "_start_poller", lambda: registered.append("poller"))
    monkeypatch.setattr(plugin, "_publish", lambda event: None)
    pkg = types.ModuleType("hermes_cli")
    pkg.__path__ = []
    mod = types.ModuleType("hermes_cli.plugins")
    mod.VALID_HOOKS = {"pre_llm_call"}
    monkeypatch.setitem(sys.modules, "hermes_cli", pkg)
    monkeypatch.setitem(sys.modules, "hermes_cli.plugins", mod)
    plugin.register(Ctx())
    assert "pre_llm_call" in registered
    assert "transport:habblaud" in registered
    assert "poller" not in registered
    plugin._on_session_open(session_id="s1", platform="cli")
    assert "poller" in registered


def test_heartbeat_remembers_live_sessions_and_forgets_ended_ones(tmp_path, monkeypatch):
    plugin = load(tmp_path)
    events = []
    monkeypatch.setattr(plugin, "_publish", events.append)
    monkeypatch.setattr(plugin, "_start_poller", lambda: None)
    plugin._on_session_open(session_id="s1", platform="cli", project="/p/loja")
    plugin._pre_llm_call(session_id="s1", platform="cli", user_message="oi", conversation_history=[])
    plugin._heartbeat_once(now=31)
    heartbeats = [e for e in events if e["type"] == "session_heartbeat"]
    assert heartbeats == [
        {"type": "session_heartbeat", "session_id": "s1", "platform": "cli", "project": "/p/loja", "status": "working"}
    ]
    plugin._on_session_end(session_id="s1", completed=True)
    plugin._heartbeat_once(now=62)
    assert len([e for e in events if e["type"] == "session_heartbeat"]) == 1


def test_gateway_session_profile_only_lets_the_owner_plugin_publish(tmp_path, monkeypatch):
    plugin = load(tmp_path)
    plugin._registered = True
    plugin._plugin_profile = "developer"
    plugin._plugin_home = "/x/developer"
    monkeypatch.setattr(plugin, "_session_profile", lambda: "tester")
    assert plugin._session_owner_allows() is False
    monkeypatch.setattr(plugin, "_session_profile", lambda: "developer")
    assert plugin._session_owner_allows() is True
    # CLI/teste sem contexto de sessão: o plugin publica normalmente.
    monkeypatch.setattr(plugin, "_session_profile", lambda: "")
    assert plugin._session_owner_allows() is True

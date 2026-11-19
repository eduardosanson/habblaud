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
    assert events[-1] == {"type": "tool_start", "session_id": "s1", "call_id": "c1", "tool_name": "terminal", "preview": "npm test"}

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

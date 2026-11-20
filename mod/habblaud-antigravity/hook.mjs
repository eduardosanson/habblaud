#!/usr/bin/env node
// Hook do Antigravity CLI (`agy`) para o Habblaud.
//
// O agy chama este comando nos hooks de ~/.gemini/config/hooks.json e manda o contexto em JSON no stdin:
// hookEventName, conversationId, lastUserInput, modelName, cwd, toolName/toolCall, error...
// Aqui o evento é normalizado e enviado ao Habblaud local. Nada é impresso e nada bloqueia o agente: qualquer
// falha (Habblaud fechado, JSON estranho) termina em 0.
import { stdin, stdout } from 'node:process';

const HABBLAUD_PORT = process.env.HABBLAUD_PORT || '4747';
const URL = process.env.HABBLAUD_ANTIGRAVITY_URL || `http://127.0.0.1:${HABBLAUD_PORT}/api/antigravity/events`;
const PLATFORM = 'antigravity';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clean(value, max = 120) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function toolOf(raw) {
  const call = raw.toolCall && typeof raw.toolCall === 'object' ? raw.toolCall : {};
  const name = clean(raw.toolName || call.name || call.toolName, 60);
  const input = raw.toolInput || call.args || call.arguments || call.input || {};
  const previewFields = ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'description'];
  let preview = '';
  if (input && typeof input === 'object') {
    for (const field of previewFields) {
      const value = text(input[field]);
      if (value) {
        preview = clean(value, 80);
        break;
      }
    }
  }
  const callId = clean(raw.toolCallId || call.id, 80);
  return { name, input, preview, callId };
}

function eventOf(raw) {
  const name = clean(raw.hookEventName || raw.hook_event_name, 40);
  const sessionId = clean(raw.conversationId || raw.session_id, 120);
  if (!name || !sessionId) return undefined;
  const base = { session_id: sessionId, platform: PLATFORM, at: Date.now() / 1000 };
  const cwd = text(raw.cwd);
  if (cwd) base.project = cwd;
  const model = text(raw.modelName || raw.model);
  if (model) base.model = model;
  const title = clean(raw.lastUserInput || raw.last_user_input, 90);
  if (title) base.title = title;

  switch (name) {
    case 'SessionStart':
      return { ...base, type: 'session_start' };
    case 'UserPromptSubmit':
    case 'PreInvocation':
      return { ...base, type: 'session_busy' };
    case 'PostInvocation':
      return undefined;
    case 'Stop':
      if (raw.fullyIdle === false || raw.continuationActive) return { ...base, type: 'session_busy' };
      return { ...base, type: 'session_idle' };
    case 'SessionEnd': {
      const error = clean(raw.error || raw.error_message, 120);
      return { ...base, type: 'session_end', failed: !!error || raw.failed === true, ...(error ? { error } : {}) };
    }
    case 'PreToolUse':
    case 'PostToolUse': {
      const tool = toolOf(raw);
      if (!tool.name) return undefined;
      if (name === 'PreToolUse') {
        return {
          ...base,
          type: 'tool_start',
          tool_name: tool.name,
          call_id: tool.callId || tool.name,
          input: tool.input,
          ...(tool.preview ? { preview: tool.preview } : {}),
        };
      }
      const error = clean(raw.error || raw.error_message, 120);
      return {
        ...base,
        type: 'tool_end',
        tool_name: tool.name,
        call_id: tool.callId || tool.name,
        status: error ? 'error' : 'ok',
        ...(error ? { error } : {}),
      };
    }
    default:
      return undefined;
  }
}

async function main() {
  let raw = '';
  for await (const chunk of stdin) raw += chunk;
  let input;
  try {
    input = JSON.parse(raw || '{}');
  } catch {
    return;
  }
  if (!input || typeof input !== 'object') return;
  const event = eventOf(input);
  if (!event) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event }),
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch {
    // Habblaud fechado ou lento: o hook do Antigravity nunca pode atrapalhar o agente.
  }
}

main().finally(() => {
  stdout.end?.();
  process.exitCode = 0;
});

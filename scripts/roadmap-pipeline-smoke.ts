// Smoke de integração do Habblaud contra o Hermes Pipeline de pé.
//
// Uso:
//   PIPELINE_HABBLAUD_TOKEN=... npx tsx scripts/roadmap-pipeline-smoke.ts
//   PIPELINE_URL=http://127.0.0.1:49500 ... (default)
//
// O teste só usa o token do Habblaud: lê roadmaps e conversa. Ele confirma que a
// sessão de leitura não move item e que a sessão com escrita responde sem alterar o
// roadmap em uma pergunta de progresso.
import { randomUUID } from 'node:crypto';

const base = process.env.PIPELINE_URL ?? 'http://127.0.0.1:49500';
const token = process.env.PIPELINE_HABBLAUD_TOKEN ?? '';
if (!token) {
  console.error('defina PIPELINE_HABBLAUD_TOKEN');
  process.exit(2);
}

let passed = 0;
function ok(label: string, condition: unknown, detail = ''): void {
  if (!condition) {
    console.error(`falhou: ${label}${detail ? ` — ${detail}` : ''}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`ok ${String(passed).padStart(2, '0')} · ${label}`);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${response.status} ${body?.error?.message ?? text}`);
  return body as T;
}

interface Counts {
  total: number;
  done: number;
  in_progress: number;
  blocked: number;
  review: number;
  ready: number;
  backlog: number;
  canceled: number;
}
interface Item {
  id: string;
  key: string;
  status: string;
  links: { kind: string; targetId: string }[];
}
interface Snapshot {
  schemaVersion: number;
  source: string;
  revision: number;
  generatedAt: string;
  roadmap: {
    id: string;
    counts: Counts;
    progress: { done: number; total: number; percent: number };
    phases: { id: string; items: Item[] }[];
    activity: unknown[];
    milestone: string;
  };
}
interface Message {
  messageId: string;
  role: 'user' | 'agent';
  text: string;
  replyTo: string | null;
  status: string;
  actions: { status: string; summary: string; error?: { message: string } }[];
}
interface Session {
  id: string;
  agentId: string;
  capabilities: string[];
  roadmapIds: string[];
}

async function snapshot(id: string): Promise<Snapshot> {
  return request(`/api/roadmaps/${id}`);
}

async function messages(sessionId: string): Promise<Message[]> {
  const body = await request<{ messages: Message[] }>(`/api/agent/sessions/${sessionId}/messages?limit=100`);
  return body.messages;
}

async function ask(sessionId: string, text: string, context: Record<string, string>): Promise<{ reply: Message; before: number; after: number }> {
  const before = (await snapshot(context.roadmapId ?? 'praca')).revision;
  const messageId = randomUUID();
  await request(`/api/agent/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageId, text, context }),
  });
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const list = await messages(sessionId);
    const reply = list.find((message) => message.role === 'agent' && message.replyTo === messageId);
    if (reply) {
      const after = (await snapshot(context.roadmapId ?? 'praca')).revision;
      return { reply, before, after };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`sem resposta do agente para ${messageId}`);
}

const health = await request<{ ok: boolean; service: string }>('/health');
ok('health responde roadmap-api', health.ok && health.service === 'roadmap-api');

const list = await request<{ roadmaps: { id: string; revision: number; counts: Counts }[] }>('/api/roadmaps');
const ids = list.roadmaps.map((roadmap) => roadmap.id);
const existingId = process.env.PIPELINE_EXISTING_ROADMAP_ID ?? 'atlas-ondas';
const existing = list.roadmaps.find((roadmap) => roadmap.id === existingId);
ok('lista o roadmap existente do pipeline', Boolean(existing), ids.join(', '));
ok('o roadmap existente é o primeiro da lista (padrão da página)', list.roadmaps[0]?.id === existingId, list.roadmaps[0]?.id);
if (!existing) {
  console.error(`ajuste PIPELINE_EXISTING_ROADMAP_ID; ${existingId} não está no pipeline`);
  process.exit(1);
}

const existingSnapshot = await snapshot(existingId);
ok(
  'snapshot do roadmap existente bate com o resumo',
  existingSnapshot.roadmap.counts.total === existing?.counts.total && existingSnapshot.roadmap.counts.done === existing?.counts.done,
  `${existingSnapshot.roadmap.counts.done}/${existingSnapshot.roadmap.counts.total}`,
);

const praca = await snapshot('praca');
ok('snapshot tem schemaVersion/source/revisão', praca.schemaVersion === 1 && praca.source === 'hermes-pipeline' && praca.revision > 0);
ok('Praça compartilhada está em 20/38', praca.roadmap.counts.done === 20 && praca.roadmap.counts.total === 38, JSON.stringify(praca.roadmap.counts));

const items = praca.roadmap.phases.flatMap((phase) => phase.items);
const statusCounts = items.reduce<Record<string, number>>((acc, item) => {
  if (item.status !== 'canceled') acc[item.status] = (acc[item.status] ?? 0) + 1;
  return acc;
}, {});
ok(
  'contagem do snapshot bate com os itens (cancelado fora)',
  (statusCounts.done ?? 0) === praca.roadmap.counts.done &&
    (statusCounts.in_progress ?? 0) === praca.roadmap.counts.in_progress &&
    (statusCounts.blocked ?? 0) === praca.roadmap.counts.blocked &&
    (statusCounts.backlog ?? 0) + (statusCounts.ready ?? 0) === praca.roadmap.counts.backlog,
  JSON.stringify(statusCounts),
);

const byKey = new Map(items.map((item) => [item.key, item]));
const bug = byKey.get('3.7');
const fix = byKey.get('3.8');
ok(
  'bug 3.7 tem causa e relação canônicas',
  bug?.links.some((link) => link.kind === 'caused_by' && link.targetId === 'praca-3.3') &&
    bug.links.some((link) => link.kind === 'relates_to' && link.targetId === 'praca-3.4'),
  JSON.stringify(bug?.links),
);
ok('correção 3.8 aponta fixes para o 3.7', fix?.links.some((link) => link.kind === 'fixes' && link.targetId === 'praca-3.7'), JSON.stringify(fix?.links));

const confianca = await snapshot('confianca');
ok('Confiança e privacidade está em 5/15', confianca.roadmap.counts.done === 5 && confianca.roadmap.counts.total === 15, JSON.stringify(confianca.roadmap.counts));
ok('marco e atividade vêm do pipeline', Boolean(praca.roadmap.milestone) && praca.roadmap.activity.length > 0);

const sessions = (await request<{ sessions: Session[] }>('/api/agent/sessions')).sessions;
const nina = sessions.find((session) => session.id === 'sess-nina');
const leitor = sessions.find((session) => session.id === 'sess-leitor');
ok('sessão com escrita está listada', Boolean(nina?.capabilities.includes('roadmap.write')));
ok('sessão somente leitura está listada', Boolean(leitor && !leitor.capabilities.includes('roadmap.write')));

const progress = await ask('sess-nina', 'Qual o progresso do roadmap?', { roadmapId: 'praca' });
ok('agente responde o progresso', progress.reply.text.includes('20/38'), progress.reply.text);
ok('pergunta de leitura não muda a revisão', progress.before === progress.after, `${progress.before} -> ${progress.after}`);

const beforeLeitor = (await snapshot('praca')).revision;
const denied = await ask('sess-leitor', 'mova o 6.1 para pronto', { roadmapId: 'praca' });
const afterLeitor = await snapshot('praca');
const item61 = afterLeitor.roadmap.phases.flatMap((phase) => phase.items).find((item) => item.key === '6.1');
ok('sessão somente leitura recebe recusa', denied.reply.text.includes('Não consegui') || denied.reply.actions.some((action) => action.status === 'rejected'), denied.reply.text);
ok('sessão somente leitura não move o item', item61?.status === 'backlog' && beforeLeitor === afterLeitor.revision, `${item61?.status} · ${beforeLeitor} -> ${afterLeitor.revision}`);

console.log(`\n${passed} verificações passaram contra ${base}`);

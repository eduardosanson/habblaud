// E2E do roadmap com uma cópia descartável do Hermes Pipeline.
//
// O teste:
// 1. copia o banco do pipeline para um temporário;
// 2. remove os roadmaps e as sessões de seed;
// 3. registra uma sessão de teste vinculada ao roadmap real (Atlas Store);
// 4. sobe o pipeline e o Habblaud em portas livres;
// 5. abre /roadmap, confere que só o roadmap real aparece, conversa com a sessão
//    vinculada, move um item e vê o recibo + o snapshot atualizado.
//
// Uso:
//   PIPELINE_REPO=/caminho/hermes-pipeline npm run build
//   PIPELINE_REPO=/caminho/hermes-pipeline node scripts/roadmap-e2e.mjs
//
// O banco de origem padrão é ~/.local/state/hermes-pipeline/roadmap-api.db
// (PIPELINE_DB para outro caminho). Nada toca no banco original.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { chromium } from 'playwright-core';

const repoRoot = process.cwd();
const candidates = [
  process.env.PIPELINE_REPO,
  join(homedir(), 'Dev/projects/hermes-pipeline'),
  join(repoRoot, '..', 'hermes-pipeline'),
].filter(Boolean);
const pipelineRepo = candidates.find((path) => existsSync(join(path, 'pipeline', 'roadmap_api')));
if (!pipelineRepo) {
  console.error('defina PIPELINE_REPO com o repositório hermes-pipeline');
  process.exit(2);
}
if (!existsSync(join(repoRoot, 'dist', 'server', 'index.js'))) {
  console.error('rode npm run build antes do E2E');
  process.exit(2);
}
const sourceDb =
  process.env.PIPELINE_DB ?? join(homedir(), '.local/state/hermes-pipeline/roadmap-api.db');
if (!existsSync(sourceDb)) {
  console.error(`banco do pipeline não encontrado: ${sourceDb}`);
  process.exit(2);
}

const tmp = mkdtempSync(join(tmpdir(), 'roadmap-e2e-'));
const db = join(tmp, 'pipeline.db');
const dataDir = join(tmp, 'habblaud');
const children = [];
let browser;

function ok(label, condition, detail = '') {
  if (!condition) throw new Error(`falhou: ${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`ok ${String(++passed).padStart(2, '0')} · ${label}`);
}
let passed = 0;

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(url, ms = 20_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // servidor ainda subindo
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`tempo esgotado esperando ${url}`);
}

function stop(child) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 400).unref();
}

const setup = `
import json, sqlite3, sys
src = sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True)
dst = sqlite3.connect(sys.argv[2])
src.backup(dst)
src.close()
dst.execute('PRAGMA foreign_keys = ON')
seed = ('praca', 'confianca')
dst.execute("DELETE FROM agent_messages")
dst.execute("DELETE FROM agent_sessions")
for table in ('actions', 'audit', 'roadmap_events'):
    dst.execute(f"DELETE FROM {table} WHERE roadmap_id IN (?, ?)", seed)
dst.execute("DELETE FROM roadmaps WHERE id IN (?, ?)", seed)
caps = ['roadmap.read', 'roadmap.write', 'roadmap.complete', 'roadmap.estimate', 'agent.converse']
dst.execute(
    """INSERT INTO agent_sessions
       (id, agent_id, display_name, harness, model, status, capabilities, roadmap_ids, current_item_id, last_seen)
       VALUES (?,?,?,?,?,?,?,?,?,?)""",
    ('sess-atlas', 'atlas-agent', 'Agente Atlas', 'claude-code', 'agente-e2e', 'active',
     json.dumps(caps), json.dumps(['atlas-ondas']), '', '2026-11-19T22:00:00Z'),
)
key = dst.execute("SELECT key FROM items WHERE roadmap_id='atlas-ondas' AND status='backlog' ORDER BY idx LIMIT 1").fetchone()
if not key:
    raise SystemExit('o roadmap atlas-ondas não tem item em backlog')
dst.commit()
print(key[0])
`;

try {
  const itemKey = execFileSync('python3', ['-c', setup, sourceDb, db], { encoding: 'utf8' }).trim();
  if (!itemKey) throw new Error('não encontrei item de backlog no roadmap real');
  console.log(`item do teste: ${itemKey}`);

  const pipelinePort = await freePort();
  const habblaudPort = await freePort();
  const pipeline = spawn(
    'python3',
    ['-m', 'pipeline.roadmap_api', '--db', db, 'serve', '--port', String(pipelinePort)],
    {
      cwd: pipelineRepo,
      env: {
        ...process.env,
        PIPELINE_HABBLAUD_TOKEN: 'e2e-habblaud',
        PIPELINE_AGENT_TOKEN: 'e2e-agent',
        PIPELINE_ADMIN_TOKEN: 'e2e-admin',
      },
      stdio: 'ignore',
    },
  );
  children.push(pipeline);
  await waitFor(`http://127.0.0.1:${pipelinePort}/health`);

  const habblaud = spawn('node', ['dist/server/index.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HABBLAUD_PORT: String(habblaudPort),
      HABBLAUD_DATA_DIR: dataDir,
      HABBLAUD_ROADMAP_URL: `http://127.0.0.1:${pipelinePort}`,
      HABBLAUD_ROADMAP_TOKEN: 'e2e-habblaud',
      HABBLAUD_ROADMAP_IDS: 'atlas-ondas',
      HABBLAUD_WORLD: '0',
      HABBLAUD_CODEX: '0',
      HABBLAUD_OPENCODE: '0',
      HABBLAUD_UPDATE_CHECK: '0',
      HABBLAUD_TIMELINE: '0',
    },
    stdio: 'ignore',
  });
  children.push(habblaud);
  const appUrl = `http://localhost:${habblaudPort}`;
  await waitFor(`${appUrl}/api/roadmap/status`);

  const status = await fetch(`${appUrl}/api/roadmap/status`).then((r) => r.json());
  ok('proxy do Habblaud está disponível', status.available === true);
  const list = await fetch(`${appUrl}/api/roadmap/roadmaps`).then((r) => r.json());
  ok('só o roadmap real aparece na lista', list.roadmaps.length === 1 && list.roadmaps[0].id === 'atlas-ondas', JSON.stringify(list.roadmaps.map((r) => r.id)));
  const sessions = await fetch(`${appUrl}/api/roadmap/agent/sessions`).then((r) => r.json());
  ok('só a sessão vinculada ao roadmap real aparece', sessions.sessions.length === 1 && sessions.sessions[0].id === 'sess-atlas');

  const chrome = process.env.CHROME_PATH ?? (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
  browser = await chromium.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'pt-BR' });
  const problems = [];
  page.on('pageerror', (error) => problems.push(`[pageerror] ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`[console.error] ${message.text()}`);
  });

  await page.goto(`${appUrl}/roadmap`);
  await page.locator('.rp-hero__title', { hasText: 'Atlas Store' }).waitFor({ timeout: 20_000 });
  const beforeBadge = await page.locator('.rp-source-badge').textContent();
  const beforeRevision = Number(beforeBadge.match(/revisão (\d+)/)?.[1] ?? 0);

  await page.locator('#rp-open-roadmaps').click();
  const cards = await page.locator('.rp-roadmap-card:not(.is-static)').allTextContents();
  ok('a página não mostra os roadmaps de seed', cards.length === 1 && cards[0].includes('Atlas Store'), JSON.stringify(cards.map((c) => c.slice(0, 40))));
  await page.locator('#rp-roadmap-index-close').click();
  ok('o escritório e o roadmap não têm sessões de seed', !(await page.locator('body').textContent()).includes('Nina') && !(await page.locator('body').textContent()).includes('Leitor'));

  await page.locator('.rp-tab', { hasText: 'Backlog' }).click();
  await page.locator('#rp-search').fill(itemKey);
  const row = page.locator('.rp-backlog-row', { hasText: itemKey }).first();
  await row.waitFor({ timeout: 10_000 });
  ok('o item real começa no backlog', (await row.textContent()).includes('Backlog'));

  await page.locator('#rp-open-conversation').click();
  await page.locator('#rp-composer-input').waitFor({ timeout: 10_000 });
  const sessionText = await page.locator('#rp-session-btn').textContent();
  ok('a conversa usa a sessão vinculada ao roadmap', sessionText.includes('Agente Atlas') && !sessionText.includes('Nina'), sessionText.slice(0, 80));
  await page.locator('#rp-composer-input').fill(`Mova o ${itemKey} para pronto`);
  await page.locator('#rp-composer-input').press('Enter');
  await page.locator('#rp-chat-history').getByText(new RegExp(`Movi ${itemKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)).first().waitFor({ timeout: 20_000 });
  await page.locator('.rp-receipt.is-applied').first().waitFor({ timeout: 20_000 });
  ok('a conversa mostra o recibo applied', true);

  await page.locator('#rp-chat-close').click();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.waitForFunction(
    (key) => {
      const row = [...document.querySelectorAll('.rp-backlog-row')].find((el) => el.textContent?.includes(key));
      return Boolean(row && row.textContent?.includes('Pronto'));
    },
    itemKey,
    { timeout: 20_000 },
  );
  const afterRevision = Number((await page.locator('.rp-source-badge').textContent()).match(/revisão (\d+)/)?.[1] ?? 0);
  ok('o snapshot recarregado mostra o item pronto', true);
  ok('a revisão do pipeline avançou', afterRevision > beforeRevision, `${beforeRevision} -> ${afterRevision}`);

  const snapshot = await fetch(`${appUrl}/api/roadmap/roadmaps/atlas-ondas`).then((r) => r.json());
  const item = snapshot.roadmap.phases.flatMap((phase) => phase.items).find((candidate) => candidate.key === itemKey);
  ok('o pipeline persistiu o novo status', item?.status === 'ready', item?.status);
  ok('sem erros de página ou console', problems.length === 0, problems.join(' | '));
  await page.screenshot({ path: 'docs/screenshots/roadmap/e2e-real.png', fullPage: false });
  console.log(`\n${passed} verificações passaram no E2E real (${appUrl}/roadmap)`);
} finally {
  await browser?.close();
  for (const child of children) stop(child);
  await new Promise((resolve) => setTimeout(resolve, 500));
  rmSync(tmp, { recursive: true, force: true });
}

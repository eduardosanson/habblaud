// Valida a fonte do OpenCode sem abrir o servidor HTTP do Habblaud: lê o service.json (ou HABBLAUD_OPENCODE_URL),
// faz o boot da fonte, imprime um resumo e confere que a senha não entrou no snapshot.
//
//   npm run opencode:smoke
//   HABBLAUD_OPENCODE_URL=http://127.0.0.1:49700 HABBLAUD_OPENCODE_PASSWORD=... npm run opencode:smoke
//
// Sai com código 1 se o serviço não responder, se a fonte ficar com erro ou se a senha aparecer no snapshot.
import { homedir } from 'node:os';
import { AccountsService } from '../server/accounts/service';
import { NameStore } from '../server/model/names';
import { Office } from '../server/model/office';
import { openCodeServiceFile, parseOpenCodeService, readOpenCodeService, type OpenCodeEndpoint } from '../server/sources/opencode/client';
import { OpenCodeSource } from '../server/sources/opencode/source';

function endpointFromEnv(env: NodeJS.ProcessEnv): OpenCodeEndpoint | undefined {
  const url = env.HABBLAUD_OPENCODE_URL?.trim();
  if (!url) return undefined;
  return parseOpenCodeService({ url, password: env.HABBLAUD_OPENCODE_PASSWORD });
}

async function main(): Promise<void> {
  const home = process.env.HOME || homedir();
  const serviceFile = process.env.HABBLAUD_OPENCODE_SERVICE?.trim() || openCodeServiceFile(process.env, home);
  const endpoint = endpointFromEnv(process.env);
  if (!endpoint) {
    const fromFile = readOpenCodeService(serviceFile);
    if (!fromFile) {
      console.error(`OpenCode smoke: serviço não encontrado em ${serviceFile} (e HABBLAUD_OPENCODE_URL não foi definida).`);
      process.exitCode = 1;
      return;
    }
    const accounts = new AccountsService({ dirs: [], home, env: {}, onChange: () => {} });
    const office = new Office({
      names: new NameStore(null),
      version: 'smoke',
      startedAt: Date.now(),
      accounts: (s) => accounts.list(s),
      sources: () => [],
      accountName: (id) => accounts.find(id)?.detected.name,
    });
    const source = new OpenCodeSource({ accounts, office, serviceFile, env: process.env, home });
    await source.boot();
    const src = source.sources()[0];
    const snap = office.commit().snapshot;
    const agents = snap.agents.filter((a) => a.provider === 'opencode');
    const account = snap.accounts.find((a) => a.provider === 'opencode');
    console.log(`OpenCode smoke: serviço em ${fromFile.url}${fromFile.version ? ` (v${fromFile.version})` : ''}`);
    console.log(`fonte: ok=${src?.ok} sessões=${src?.sessions}${src?.error ? ` erro=${src.error}` : ''}`);
    console.log(
      `conta: ${account ? `${account.id} (${account.short}) uso=${account.usageStatus}${account.usage?.fiveHour ? ` 5h=${account.usage.fiveHour.utilization}%` : ''}${account.usage?.sevenDay ? ` semana=${account.usage.sevenDay.utilization}%` : ''}` : 'ausente'}`,
    );
    console.log(`agentes: ${agents.length} (${agents.filter((a) => a.kind === 'main').length} principais, ${agents.filter((a) => a.kind === 'sub').length} subagentes)`);
    for (const a of agents.slice(0, 12)) console.log(`  - ${a.kind} ${a.status} ${a.role} · ${a.roomId}`);
    if (JSON.stringify(snap).includes(fromFile.password)) {
      console.error('OpenCode smoke: a senha do service.json apareceu no snapshot — não use esta versão.');
      process.exitCode = 1;
    }
    source.stop();
    if (!src?.ok) process.exitCode = 1;
    else console.log('OpenCode smoke: ok');
    return;
  }

  // URL explícita: o mesmo caminho, sem precisar do arquivo.
  const accounts = new AccountsService({ dirs: [], home, env: {}, onChange: () => {} });
  const office = new Office({
    names: new NameStore(null),
    version: 'smoke',
    startedAt: Date.now(),
    accounts: (s) => accounts.list(s),
    sources: () => [],
    accountName: (id) => accounts.find(id)?.detected.name,
  });
  const source = new OpenCodeSource({ accounts, office, serviceFile, endpoint, env: process.env, home });
  await source.boot();
  const src = source.sources()[0];
  const snap = office.commit().snapshot;
  const agents = snap.agents.filter((a) => a.provider === 'opencode');
  console.log(`OpenCode smoke: serviço em ${endpoint.url}`);
  console.log(`fonte: ok=${src?.ok} sessões=${src?.sessions}${src?.error ? ` erro=${src.error}` : ''}`);
  console.log(`agentes: ${agents.length}`);
  for (const a of agents.slice(0, 12)) console.log(`  - ${a.kind} ${a.status} ${a.role} · ${a.roomId}`);
  if (JSON.stringify(snap).includes(endpoint.password)) {
    console.error('OpenCode smoke: a senha apareceu no snapshot — não use esta versão.');
    process.exitCode = 1;
  }
  source.stop();
  if (!src?.ok) process.exitCode = 1;
  else console.log('OpenCode smoke: ok');
}

void main();

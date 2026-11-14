// The local NEAR chain for the dev-local "Demo cheat" entry (folder: minear-r3f/server/tools).
//   npm run dev:local       the full local testnet in one process (Ctrl+C stops it all):
//                             1. the chain on 127.0.0.1:3030,
//                             2. on a fresh chain: the items contract, the relayer and the merchant accounts
//                                (minear-r3f/server/tools/setup.ts),
//                             3. the MINEAR server for it on 127.0.0.1:8788 (the testnet server stays on 8787),
//                             4. the bot miners (bot01..bot06.test.near, made on their first run) for 10 minutes, so
//                                the merchants have trades at once (minear-r3f/server/tools/bots.ts; --no-bots skips
//                                them; they stop by themselves),
//                             5. a Vite page on 127.0.0.1:5187 (--vite <port>); the Demo cheat is /?mode=cheat.
//   npm run local:chain     only the chain, in the foreground
// With local:chain, the other parts one by one: npm run local:setup, local:server, local:bots.
// Everything lives in minear-r3f/server/.sandbox/ (gitignored): bin/near-sandbox, data/ (the chain), keys/ and
// deploy.local.json. To start over with an empty chain, stop it and delete server/.sandbox/data, keys and
// deploy.local.json (keep bin/).
// The binary is nearcore's sandbox build. This script never downloads it; if it is missing it prints the command.
// Nothing here touches a database. The bots make about one call each every 15-22 s to this machine's chain and
// server only, for 10 minutes.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { SANDBOX_DIR } from '../src/env';

const VERSION = `2.14.0`;
const BIN = join(SANDBOX_DIR, `bin`, `near-sandbox`);
const DATA = join(SANDBOX_DIR, `data`);
const CONFIG = join(DATA, `config.json`);

if (!existsSync(BIN)) {
  const url = `https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/Darwin-arm64/${VERSION}/near-sandbox.tar.gz`;
  console.error(`[local] no ${BIN}.\nDownload nearcore's sandbox build (macOS arm64, about 29 MB) from NEAR's build bucket:\n` +
    `  mkdir -p server/.sandbox/bin && curl -sSfL ${url} | tar -xz -C server/.sandbox/bin --strip-components 1`);
  process.exit(1);
}

if (!existsSync(CONFIG)) {
  console.log(`[local] new chain in ${DATA}`);
  const r = spawnSync(BIN, [`--home`, DATA, `init`], { stdio: `inherit` });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// Listen on this machine only (the default is 0.0.0.0: the whole network).
const c = JSON.parse(readFileSync(CONFIG, `utf8`)) as { rpc: { addr: string }; network: { addr: string } };
if (c.rpc.addr !== `127.0.0.1:3030` || c.network.addr !== `127.0.0.1:24567`) {
  c.rpc.addr = `127.0.0.1:3030`;
  c.network.addr = `127.0.0.1:24567`;
  writeFileSync(CONFIG, JSON.stringify(c, null, 2));
}

console.log(`[local] NEAR local chain on http://127.0.0.1:3030 (genesis account test.near)`);
const children: ReturnType<typeof spawn>[] = [];
const chain = spawn(BIN, [`--home`, DATA, `run`], { stdio: `inherit` });
children.push(chain);
const stopAll = (sig: NodeJS.Signals) => {
  for (const c of children) if (!c.killed) c.kill(sig);
};
for (const sig of [`SIGINT`, `SIGTERM`] as const) process.on(sig, () => stopAll(sig));
chain.on(`exit`, (code) => {
  stopAll(`SIGTERM`);
  process.exit(code ?? 0);
});

// `npm run dev:local` (--stack): the setup (first run only), the local MINEAR server, the bots and the Vite page.
if (process.argv.includes(`--stack`)) void stack();

/** Waits for a URL to answer: bounded, at most `n` checks 0.5 s apart, at start only. */
async function waitFor(url: string, n: number): Promise<boolean> {
  for (let i = 0; i < n; i++) {
    if (await fetch(url).then((r) => r.ok, () => false)) return true;
    await Bun.sleep(500);
  }
  return false;
}

async function stack(): Promise<void> {
  if (!(await waitFor(`http://127.0.0.1:3030/status`, 60))) return console.error(`[local] the chain did not answer on 127.0.0.1:3030`);
  const env = { ...process.env, MINEAR_NETWORK: `local` };
  const app = join(SANDBOX_DIR, `..`, `..`);
  if (!existsSync(join(SANDBOX_DIR, `deploy.local.json`))) {
    console.log(`[local] fresh chain: setting up the items contract, the relayer and the merchants`);
    const r = spawnSync(`bun`, [`server/tools/setup.ts`], { cwd: app, env, stdio: `inherit` });
    if (r.status !== 0) return console.error(`[local] setup failed`);
  } else {
    // a kept chain: put the latest contract build on it (state kept), so it never runs older code than the game
    console.log(`[local] kept chain: deploying the latest items contract build (state kept)`);
    const r = spawnSync(`bun`, [`server/tools/setup.ts`, `--code-only`], { cwd: app, env, stdio: `inherit` });
    if (r.status !== 0) return console.error(`[local] contract deploy failed`);
  }
  children.push(spawn(`bun`, [`--watch`, `server/src/main.ts`], { cwd: app, env, stdio: `inherit` }));
  const i = process.argv.indexOf(`--vite`);
  const port = i >= 0 ? process.argv[i + 1] : `5187`;
  children.push(spawn(`npx`, [`vite`, `--port`, port, `--strictPort`, `--host`, `127.0.0.1`], { cwd: app, stdio: `inherit` }));
  if (!(await waitFor(`http://127.0.0.1:8788/health`, 40))) return console.error(`[local] the local server did not answer on 127.0.0.1:8788`);
  console.log(`[local] full local testnet is up.\n[local]   Demo cheat: http://127.0.0.1:${port}/?mode=cheat\n[local]   Google and Play demo on the same page use NEAR testnet (its server: npm run dev:testnet, or 8787 if it already runs)`);
  if (!process.argv.includes(`--no-bots`)) {
    // the bot miners: their accounts are made on the first run; they trade for 10 minutes, then stop by themselves
    const bots = spawn(`bun`, [`server/tools/bots.ts`, `--minutes`, `10`], {
      cwd: app,
      env: { ...env, MINEAR_SERVER: `http://127.0.0.1:8788` },
      stdio: `inherit`,
    });
    children.push(bots);
    bots.on(`exit`, (code) => console.log(`[local] the bots stopped (${code ?? 0}); the chain, server and page keep running`));
  }
}

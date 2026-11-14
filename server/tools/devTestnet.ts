// The dev run on the REAL NEAR testnet (folder: minear-r3f/server/tools): the same chain, contract and accounts as
// production, on this machine.
//   npm run dev:testnet     one process (Ctrl+C stops what it started):
//                             1. the MINEAR testnet server on 127.0.0.1:8787 (minear-r3f/server/src/main.ts), or the
//                                one that already answers there (it is not started twice, and it is not stopped),
//                             2. a Vite page on http://localhost:3000 (--vite <port>; --strictPort, so it never
//                                serves from a port another checkout holds).
// On that page: Continue with Google (NEAR Auth) and Play demo. The Demo cheat needs the local testnet
// (npm run dev:local) and shows as off when it does not answer.
// Port 3000: NEAR Auth's shared testnet login client (np8paq...) returns only to http://localhost:3000. Any other
// address answers "Callback URL mismatch" (seen on http://localhost:5187 and :5188, 2026-11-14/15). Open the page as
// http://localhost:3000, not http://127.0.0.1:3000: the address must match exactly. Our own client id
// (VITE_NEAR_AUTH_CLIENT_ID in .env.local, minear-r3f/src/near/nearAuth.ts) can allow other addresses.
// Nothing here touches a database, and nothing runs on a timer: one bounded wait for the server at start only.
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const APP = join(import.meta.dir, `..`, `..`);
const SERVER = `http://127.0.0.1:8787`;
const i = process.argv.indexOf(`--vite`);
const PORT = i >= 0 ? process.argv[i + 1] : `3000`;

const children: ReturnType<typeof spawn>[] = [];
const stopAll = (sig: NodeJS.Signals) => {
  for (const c of children) if (c.exitCode === null) c.kill(sig);
};
for (const sig of [`SIGINT`, `SIGTERM`] as const)
  process.on(sig, () => {
    stopAll(sig);
    process.exit(0);
  });

/** The network of the MINEAR server on 8787, or null when nothing answers there. */
async function serverNetwork(): Promise<string | null> {
  try {
    const r = await fetch(`${SERVER}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok ? (((await r.json()) as { network?: string }).network ?? `unknown`) : `unknown`;
  } catch {
    return null;
  }
}

const net = await serverNetwork();
if (net === `testnet`) console.log(`[testnet] a MINEAR testnet server already answers on ${SERVER}: using it`);
else if (net) {
  console.error(`[testnet] something else answers on ${SERVER} (network: ${net}). Stop it, or free port 8787, then run again.`);
  process.exit(1);
} else {
  console.log(`[testnet] starting the MINEAR testnet server on ${SERVER}`);
  children.push(spawn(`bun`, [`--watch`, `server/src/main.ts`], { cwd: APP, env: { ...process.env, MINEAR_NETWORK: `testnet` }, stdio: `inherit` }));
  let up = false;
  for (let k = 0; k < 40 && !up; k++) {
    up = (await serverNetwork()) === `testnet`;
    if (!up) await Bun.sleep(500);
  }
  if (!up) {
    console.error(`[testnet] the server did not answer on ${SERVER}`);
    stopAll(`SIGTERM`);
    process.exit(1);
  }
}

const vite = spawn(`npx`, [`vite`, `--port`, PORT, `--strictPort`, `--host`, `127.0.0.1`], { cwd: APP, stdio: `inherit` });
children.push(vite);
vite.on(`exit`, (code) => {
  stopAll(`SIGTERM`);
  process.exit(code ?? 0);
});
console.log(`[testnet] NEAR testnet page: http://localhost:${PORT}/  (Continue with Google, Play demo)`);

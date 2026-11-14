// MINEAR server (folder: minear-r3f/server): gas relayer, account setup and merchant agents.
// Start: `bun server/src/main.ts` from minear-r3f (port 8787, testnet).
//   GET  /health            network, contract, and `gas`: today's system cap use and the last balance check
//                           (minear-r3f/server/src/budget.ts)
//   GET  /deploy            the public account ids (minear-r3f/src/economy/deploy.testnet.json)
//   GET  /board             the market board (cached 4 s; refreshed only when someone asks)
//   GET  /quote?merchant=&token=&side=&amount=&player=   a signed merchant quote
//   GET  /talk?merchant=&token=&side=&player=&outcome=   one line the merchant says (NEAR AI; never a price)
//   GET  /events?merchant=<account>&world=1&limit=N   the last relayed actions, newest first (in memory,
//                                                      empty after a restart; minear-r3f/server/src/relayer.ts)
//   POST /relay   { signedDelegate }        pays gas for one game call
//   POST /onboard { name, sessionKey, fullKey }   creates <name>.<root>
//   POST /dev/grant { accountId, items: [[token, n]] }   LOCAL CHAIN ONLY (MINEAR_NETWORK=local, port 8788):
//                                                      Stock up of the dev-local Demo cheat (owner_mint)
import { budgetStatus } from './budget';
import { devGrant } from './devGrant';
import { HOST, LOCAL, NETWORK, PORT, loadDeploy } from './env';
import { getBoard, invalidateBoard, quoteFor } from './merchants';
import { errorText } from './near';
import { onboard } from './onboard';
import { recentEvents, relay } from './relayer';
import { aiEnabled, talkFor } from './talk';

const deploy = loadDeploy();

const CORS = {
  'access-control-allow-origin': `*`,
  'access-control-allow-methods': `GET, POST, OPTIONS`,
  'access-control-allow-headers': `content-type`,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': `application/json`, ...CORS } });

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (req.method === `OPTIONS`) return new Response(null, { status: 204, headers: CORS });
    try {
      if (req.method === `GET`) {
        if (url.pathname === `/` || url.pathname === `/health`)
          return json({ ok: true, service: `MINEAR server`, network: NETWORK, contract: deploy.contract, ai: aiEnabled(), gas: budgetStatus() });
        if (url.pathname === `/deploy`) return json(deploy);
        if (url.pathname === `/board`) return json(await getBoard(deploy));
        if (url.pathname === `/quote`) {
          const r = await quoteFor(deploy, url.searchParams);
          return json(r.body, r.status);
        }
        if (url.pathname === `/events`) {
          const q = url.searchParams;
          return json({ ok: true, events: recentEvents(q.get(`merchant`), q.get(`world`) === `1`, Number(q.get(`limit`) ?? 50)) });
        }
        if (url.pathname === `/talk`) {
          const r = await talkFor(deploy, url.searchParams);
          return json(r.body, r.status);
        }
      }
      if (req.method === `POST`) {
        const body = (await req.json().catch(() => ({}))) as Record<string, string>;
        if (url.pathname === `/relay`) {
          const r = await relay(deploy, String(body.signedDelegate ?? ``), invalidateBoard);
          return json(r.body, r.status);
        }
        if (url.pathname === `/onboard`) {
          const ip = srv.requestIP(req)?.address ?? `unknown`;
          const r = await onboard(deploy, body, ip);
          return json(r.body, r.status);
        }
        // local chain only (dev-local Demo cheat): Stock up mints into the player's vault
        if (url.pathname === `/dev/grant` && LOCAL) {
          const r = await devGrant(deploy, body);
          return json(r.body, r.status);
        }
      }
      return json({ ok: false, error: `Not found` }, 404);
    } catch (e) {
      return json({ ok: false, error: errorText(e) }, 500);
    }
  },
});

console.log(`MINEAR server on http://${server.hostname}:${server.port} (${NETWORK}, contract ${deploy.contract})`);

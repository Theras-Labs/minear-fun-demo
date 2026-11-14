// End-to-end smoke test on testnet (folder: minear-r3f/server/tools). Needs the server running
// (bun server/src/main.ts). Run from minear-r3f: bun server/tools/smoke.ts
// It creates a fresh player through /onboard and plays one trip: register, save_trip, sell, buy, smelt,
// with the relayer paying, then checks the bot guard and the merchant's signature check.
import { Player, createAccount, viewCall, type PlayerKeys } from '../../src/near/play';
import type { LobbyFeed } from '../../src/economy/types';
import { saveKey } from '../src/env';
import { loadDeploy } from '../src/env';
import { onboard } from '../src/onboard';
import { KeyPair } from 'near-api-js';

const SERVER = process.env.MINEAR_SERVER ?? `http://127.0.0.1:8787`;
const d = loadDeploy();
const ok = (c: boolean, msg: string) => {
  console.log(`${c ? `PASS` : `FAIL`}  ${msg}`);
  if (!c) process.exitCode = 1;
};
const bal = async (p: Player, t: string) => Number((await p.view()).balances.find(([k]) => k === t)?.[1] ?? 0);

async function freshPlayer(): Promise<PlayerKeys> {
  const name = `bot-smoke-${Date.now().toString(36)}`;
  // bots skip the name rules and the per-IP limit; humans go through POST /onboard
  const full = KeyPair.fromRandom(`ed25519`);
  const session = KeyPair.fromRandom(`ed25519`);
  const r = await onboard(d, { name, fullKey: full.getPublicKey().toString(), sessionKey: session.getPublicKey().toString() }, `smoke`, { skipIpLimit: true });
  if (r.status !== 200) throw new Error(`onboard: ${JSON.stringify(r.body)}`);
  const keys = { accountId: String(r.body.accountId), sessionKey: session.toString() as `ed25519:${string}`, fullKey: full.toString() as `ed25519:${string}` };
  saveKey(keys.accountId, session.getPublicKey().toString(), keys.sessionKey);
  return keys;
}

async function main() {
  const t0 = Date.now();
  const human = await createAccount(d, SERVER, `ab`).catch((e) => e as Error);
  ok(human instanceof Error && /3 to 32/.test(human.message), `/onboard rejects a bad name (${(human as Error).message})`);

  const p = new Player(d, SERVER, await freshPlayer());
  console.log(`player ${p.id}`);
  let r = await p.register();
  ok(r.paidBy === `relayer`, `register paid by the relayer`);
  ok((await bal(p, `coin`)) === 200, `starter coins arrived`);

  await new Promise((s) => setTimeout(s, 2_600));
  r = await p.saveTrip([[`ore.iron`, 40], [`gem.quartz`, 3], [`ore.gold`, 12]], { depth_m: 420 });
  const v = await p.view();
  ok(r.paidBy === `relayer`, `save_trip paid by the relayer`);
  ok((await bal(p, `ore.iron`)) === 40, `40 iron saved`);
  const v2 = !!v.stats;
  if (v2) {
    const feed = await viewCall<LobbyFeed>(d, `lobby_feed`);
    ok(v.stats!.best_depth === 420 && v.stats!.trips === 1, `the trip report is recorded: best depth ${v.stats!.best_depth} m`);
    ok(feed.trips[0]?.account_id === p.id && feed.trips[0].depth_m === 420, `the trip is first in the lobby feed`);
    ok(feed.top_depth.some((l) => l.account_id === p.id), `the player is on the Depth board`);
  } else console.log(`(v1 contract: no trip records, gear checks skipped)`);
  ok(v.player.used === 1 && v.free_left === v.free_limit - 1, `save_trip used 1 gas-free action (signer = relayer works): ${v.free_left}/${v.free_limit}`);

  await new Promise((s) => setTimeout(s, 2_600));
  const before = (await p.board()).merchants.find((m) => m.account_id === d.merchants.smelter)!;
  const q = await p.quote(`smelter`, `ore.iron`, `sell`, 30);
  console.log(`quote: sell ${q.quote.amount} iron for ${q.quote.coins} coins`);
  console.log(`  reasons: ${q.reasons.join(` | `)}`);
  await p.trade(q);
  ok((await bal(p, `ore.iron`)) === 40 - Number(q.quote.amount), `iron moved to the smelter`);
  ok((await bal(p, `coin`)) === 200 + Number(q.quote.coins), `coins moved to the player`);

  await new Promise((s) => setTimeout(s, 2_600));
  const q2 = await p.quote(`smelter`, `ore.iron`, `sell`, 5);
  ok(Number(q2.quote.coins) / 5 <= Number(q.quote.coins) / Number(q.quote.amount), `price fell after the sale (${Number(q2.quote.coins) / 5} <= ${Number(q.quote.coins) / Number(q.quote.amount)})`);

  const greedy = { ...q2, quote: { ...q2.quote, coins: String(Number(q2.quote.coins) * 10) } };
  const bad = await p.trade(greedy).catch((e) => e as Error);
  ok(bad instanceof Error && /signature/.test(bad.message), `a changed price is refused (${(bad as Error).message})`);

  await new Promise((s) => setTimeout(s, 2_600));
  const buy = await p.quote(`smelter`, `ore.copper`, `buy`, 10);
  await p.trade(buy);
  ok((await bal(p, `ore.copper`)) === 10, `bought 10 copper for ${buy.quote.coins}`);

  // a call that panics inside the meta transaction must come back as an error, not as done
  await new Promise((s) => setTimeout(s, 2_600));
  const short = await p.craft(`smelt.copper`, 3).catch((e) => e as Error);
  ok(short instanceof Error && (await bal(p, `ore.copper`)) === 10, `smelting 15 copper with 10 is refused (${(short as Error).message})`);

  await new Promise((s) => setTimeout(s, 2_600));
  await p.craft(`smelt.copper`, 2);
  ok((await bal(p, `ore.copper`)) === 0 && (await bal(p, `ore.iron`)) === 40 - Number(q.quote.amount) + 2, `smelted 10 copper into 2 iron`);

  if (v2) {
    // v2: the Forge on chain (gold grade: 12 gold + 10 iron), then salvage the piece
    await new Promise((s) => setTimeout(s, 2_600));
    const ironBefore = await bal(p, `ore.iron`);
    const made = await p.forge(`knighthelm`, `gold`, 1);
    ok(made.length === 1 && /^g\d+$/.test(made[0].token_id), `forge minted gear NFT ${made[0]?.token_id} (tier ${made[0]?.gear.tier}), returned through the relayer`);
    ok((await bal(p, `ore.gold`)) === 0 && (await bal(p, `ore.iron`)) === ironBefore - 10, `forge burned 12 gold and 10 iron`);
    ok((await p.gearOf()).length === 1, `gear_of lists the new piece`);
    await new Promise((s) => setTimeout(s, 2_600));
    const out = await p.salvage(made[0].token_id);
    ok((await p.gearOf()).length === 0 && out.length > 0, `salvage burned the NFT and minted ${out.map(([t, n]) => `${n} ${t}`).join(`, `)}`);
    await new Promise((s) => setTimeout(s, 2_600));
  }

  const fast = await Promise.allSettled([p.saveTrip([[`ore.iron`, 1]]), p.saveTrip([[`ore.iron`, 1]])]);
  const refused = fast.filter((x) => x.status === `rejected`).map((x) => ((x as PromiseRejectedResult).reason as Error).message);
  ok(refused.length >= 1, `back-to-back requests are refused: ${refused.join(` / `)}`);

  const after = (await p.board()).merchants.find((m) => m.account_id === d.merchants.smelter)!;
  console.log(`smelter coins ${before.coins} -> ${after.coins}`);
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

main().catch((e) => {
  console.error(`smoke failed:`, e instanceof Error ? e.message : e);
  process.exit(1);
});

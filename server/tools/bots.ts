// Bot miners on testnet (folder: minear-r3f/server/tools). They play real trips through the same path
// as people: session key -> relayer (minear-r3f/server) -> items contract, and real merchant quotes.
// Use them to make the live market move. They run only while this script runs, and stop by themselves.
//   bun server/tools/bots.ts [--bots 6] [--minutes 10] [--gap 15]
// Needs the server running (bun server/src/main.ts). Bot accounts are bot01.<root>... and are made once;
// their session keys stay in minear-r3f/server/.keys/testnet/.
// Personas:
//   farmer   digs copper and iron in bulk and sells to whoever pays most (floods ore: ore gets cheap)
//   gemmer   digs common gems and sells them
//   deep     digs rare gems now and then and sells them to the rich merchants
//   crafter  buys cheap ore, smelts it up (burns it: WORLD factor), sells the result
//   investor buys what is cheap, and invests in any shop that went broke
import { KeyPair } from 'near-api-js';
import { TOKEN_BY_ID, type TokenId } from '../../src/economy/catalog';
import { MERCHANTS, price, snapshot } from '../../src/economy/pricing';
import type { Board } from '../../src/economy/types';
import { GameError, Player } from '../../src/near/play';
import { hasKey, loadDeploy, loadKey, saveKey } from '../src/env';
import { onboard } from '../src/onboard';

const args = process.argv.slice(2);
const opt = (k: string, d: number) => {
  const i = args.indexOf(k);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const BOTS = opt(`--bots`, 6);
const MINUTES = opt(`--minutes`, 10);
const GAP_S = Math.max(4, opt(`--gap`, 15));
const SERVER = process.env.MINEAR_SERVER ?? `http://127.0.0.1:8787`;
const PERSONAS = [`farmer`, `gemmer`, `crafter`, `farmer`, `investor`, `deep`] as const;
type Persona = (typeof PERSONAS)[number];

const d = loadDeploy();
const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const pick = <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);

async function botPlayer(i: number): Promise<Player> {
  const name = `bot${String(i).padStart(2, `0`)}`;
  const id = `${name}.${d.root}`;
  if (!hasKey(id)) {
    const full = KeyPair.fromRandom(`ed25519`);
    const session = KeyPair.fromRandom(`ed25519`);
    const r = await onboard(d, { name, fullKey: full.getPublicKey().toString(), sessionKey: session.getPublicKey().toString() }, `bots`, { skipIpLimit: true });
    if (r.status !== 200) throw new Error(`${id}: ${JSON.stringify(r.body)}`);
    saveKey(id, session.getPublicKey().toString(), session.toString());
    console.log(`${stamp()} made ${id}`);
  }
  return new Player(d, SERVER, { accountId: id, sessionKey: loadKey(id) });
}

/** The open merchant that pays most for `token` (sell) or asks least (buy), by the shared rules. */
function bestMerchant(b: Board, token: TokenId, side: `sell` | `buy`): { id: string; px: number } | null {
  let best: { id: string; px: number } | null = null;
  for (const m of MERCHANTS) {
    if (!(token in m.target)) continue;
    const s = b.merchants.find((x) => x.account_id === d.merchants[m.id]);
    if (!s || s.closed) continue;
    const p = price(m, token, snapshot(b, s, token));
    const px = side === `sell` ? p.bid : p.ask;
    if (!best || (side === `sell` ? px > best.px : px < best.px)) best = { id: m.id, px };
  }
  return best;
}

const DIG: Record<Persona, [TokenId, number, number][]> = {
  farmer: [[`ore.copper`, 20, 30], [`ore.iron`, 15, 25]],
  gemmer: [[`gem.quartz`, 3, 9], [`gem.amethyst`, 1, 4], [`ore.gold`, 4, 10]],
  deep: [[`gem.emerald`, 1, 2], [`gem.sapphire`, 0, 1], [`gem.ruby`, 0, 1], [`gem.fireopal`, 0, 1], [`ore.mythril`, 1, 3]],
  crafter: [[`ore.copper`, 10, 20]],
  investor: [[`ore.iron`, 5, 10]],
};

/** How deep each persona's trips go (metres), for the trip report (v2 contract: the feed and the Depth board). */
const DEPTH: Record<Persona, [number, number]> = { farmer: [40, 220], gemmer: [150, 460], deep: [600, 1080], crafter: [30, 140], investor: [60, 260] };

class Bot {
  trips = 0;
  log: string[] = [];
  constructor(
    readonly p: Player,
    readonly persona: Persona,
  ) {}

  say(s: string) {
    console.log(`${stamp()} ${this.p.id.split(`.`)[0]} ${this.persona.padEnd(8)} ${s}`);
  }

  async sellAll(b: Board, have: Map<TokenId, number>, only?: (t: TokenId) => boolean) {
    for (const [t, n] of have) {
      if (n < 1 || (only && !only(t))) continue;
      const m = bestMerchant(b, t, `sell`);
      if (!m) continue;
      const q = await this.p.quote(m.id, t, `sell`, n);
      await this.p.trade(q);
      this.say(`sold ${q.quote.amount} ${TOKEN_BY_ID[t].name} to ${m.id} for ${q.quote.coins}c (${(Number(q.quote.coins) / Number(q.quote.amount)).toFixed(1)} each)`);
      return true;
    }
    return false;
  }

  /** One action per turn, like a player at base: save a trip, or one trade, or one craft, or invest. */
  async turn(): Promise<void> {
    const [v, b] = await Promise.all([this.p.view(), this.p.board()]);
    const have = new Map(v.balances.map(([t, n]) => [t, Number(n)] as const));
    const coins = have.get(`coin`) ?? 0;
    have.delete(`coin`);
    const canSave = v.next_save_ms <= v.now_ms;

    if (this.persona === `investor`) {
      const broke = b.merchants.find((m) => m.closed);
      if (broke && coins > 50) {
        const amt = Math.min(coins - 20, Math.max(50, Number(broke.reopen) - Number(broke.coins)));
        await this.p.invest(broke.account_id, amt);
        return this.say(`invested ${amt}c in ${broke.name} (it was CLOSED with ${broke.coins}c)`);
      }
    }
    if (this.persona === `crafter`) {
      if ((have.get(`ore.copper`) ?? 0) >= 5) {
        const times = Math.min(20, Math.floor((have.get(`ore.copper`) ?? 0) / 5));
        await this.p.craft(`smelt.copper`, times);
        return this.say(`smelted ${times * 5} copper into ${times} iron (burned)`);
      }
      if ((have.get(`ore.iron`) ?? 0) >= 5 && Math.random() < 0.5) {
        const times = Math.min(10, Math.floor((have.get(`ore.iron`) ?? 0) / 5));
        await this.p.craft(`smelt.iron`, times);
        return this.say(`smelted ${times * 5} iron into ${times} gold (burned)`);
      }
      const cheap = bestMerchant(b, `ore.copper`, `buy`);
      if (cheap && coins > cheap.px * 10 && Math.random() < 0.6) {
        const q = await this.p.quote(cheap.id, `ore.copper`, `buy`, Math.min(40, Math.floor(coins / cheap.px / 2)));
        await this.p.trade(q);
        return this.say(`bought ${q.quote.amount} copper from ${cheap.id} for ${q.quote.coins}c`);
      }
    }
    if (this.persona === `investor` && coins > 200 && Math.random() < 0.5) {
      const t = pick([`ore.iron`, `gem.quartz`, `ore.gold`]);
      const m = bestMerchant(b, t, `buy`);
      if (m) {
        const q = await this.p.quote(m.id, t, `buy`, rnd(2, 8));
        await this.p.trade(q);
        return this.say(`bought ${q.quote.amount} ${TOKEN_BY_ID[t].name} from ${m.id} for ${q.quote.coins}c`);
      }
    }
    const holding = [...have.values()].reduce((a, n) => a + n, 0);
    if (canSave && (holding === 0 || Math.random() < 0.45)) {
      const items = DIG[this.persona].map(([t, a, z]) => [t, rnd(a, z)] as [TokenId, number]).filter(([, n]) => n > 0);
      if (items.length) {
        const depth_m = rnd(...DEPTH[this.persona]);
        await this.p.saveTrip(items, { depth_m });
        this.trips++;
        return this.say(`finished a trip at ${depth_m} m: saved ${items.map(([t, n]) => `${n} ${TOKEN_BY_ID[t].name}`).join(`, `)}`);
      }
    }
    const keep = this.persona === `crafter` ? (t: TokenId) => t !== `ore.copper` : undefined;
    if (!(await this.sellAll(b, have, keep))) this.say(`waits`);
  }
}

async function main() {
  console.log(`${stamp()} ${BOTS} bots for ${MINUTES} min, one action each every ~${GAP_S} s, server ${SERVER}`);
  const bots: Bot[] = [];
  for (let i = 1; i <= BOTS; i++) bots.push(new Bot(await botPlayer(i), PERSONAS[(i - 1) % PERSONAS.length]));
  for (const b of bots) {
    const v = await b.p.view();
    if (!v.known) await b.p.register();
  }
  const watch = async () => {
    const b = await bots[0].p.board();
    const row = (id: string, t: TokenId) => {
      const m = MERCHANTS.find((x) => x.id === id)!;
      const s = b.merchants.find((x) => x.account_id === d.merchants[id])!;
      const p = price(m, t, snapshot(b, s, t));
      return `${m.name}/${TOKEN_BY_ID[t].name} pays ${p.bid} (stock ${s.stock.find(([x]) => x === t)?.[1]}, cash ${s.coins}${s.closed ? `, CLOSED` : ``})`;
    };
    return [row(`smelter`, `ore.iron`), row(`quartermaster`, `ore.iron`), row(`quartermaster`, `ore.copper`), row(`gemcutter`, `gem.quartz`)];
  };
  const before = await watch();
  const end = Date.now() + MINUTES * 60_000;
  await Promise.all(
    bots.map(async (bot, i) => {
      await sleep(i * 1_300);
      while (Date.now() < end) {
        try {
          await bot.turn();
        } catch (e) {
          const msg = e instanceof GameError || e instanceof Error ? e.message : String(e);
          bot.say(`refused: ${msg}`);
          if (e instanceof GameError && e.retryMs > 0) await sleep(Math.min(e.retryMs, 60_000));
        }
        await sleep((GAP_S + Math.random() * GAP_S * 0.5) * 1000);
      }
    }),
  );
  const after = await watch();
  console.log(`\nBefore:\n  ${before.join(`\n  `)}\nAfter:\n  ${after.join(`\n  `)}`);
  console.log(`Trips: ${bots.map((b) => `${b.p.id.split(`.`)[0]} ${b.trips}`).join(`, `)}`);
}

main().catch((e) => {
  console.error(`bots failed:`, e instanceof Error ? e.message : e);
  process.exit(1);
});

// Testnet and local-chain setup (folder: minear-r3f/server/tools). Run from minear-r3f:
//   bun server/tools/setup.ts [--root minear-game.testnet] [--redeploy] [--clear-flows]
//   npm run local:setup     the same on the local chain (MINEAR_NETWORK=local, root test.near, no faucet;
//                           writes minear-r3f/server/.sandbox/deploy.local.json instead of step 5's file)
// --redeploy: new contract code, state kept. On a v1 contract (no forge_config view) it sends the code and
// `migrate` in ONE transaction, so the state is never unreadable. --clear-flows: forget the 24 h mint and burn counts.
// --config-only: send only set_config (GAME_CONFIG in minear-r3f/src/economy/catalog.ts, for example daily_free).
// --code-only: deploy only the new contract code (state kept, no owner calls). `npm run dev:local` runs it on
// every start of a kept local chain, so the local contract always has the latest build.
// Safe to run again: it skips what already exists.
//   1. root account: created from the testnet faucet if this server has no key for it
//   2. items.<root> (the contract, 4.5 NEAR for storage), relay.<root> (2 NEAR for gas),
//      one account per merchant in pricing.ts (no NEAR: they only sign quotes)
//   3. deploys minear-r3f/contracts/items/target/near/minear_items.wasm and calls new()
//   4. item types, merchants, caravans, Refinery recipes, the Forge (set_forge, minear-r3f/src/economy/forgeRules.ts);
//      merchant capital and starting stock once
//   5. writes minear-r3f/src/economy/deploy.testnet.json
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KeyPair, PublicKey, actions, nearToYocto, teraToGas, type Action } from 'near-api-js';
import { COIN, GAME_CONFIG, RECIPES, TOKENS } from '../../src/economy/catalog';
import { MERCHANTS, caravan } from '../../src/economy/pricing';
import { forgeChainConfig } from '../../src/economy/forgeRules';
import type { Board, Deployment } from '../../src/economy/types';
import { APP_DIR, DEPLOY_FILE, LOCAL, NETWORK, RPC, SANDBOX_DIR, hasKey, loadKey, saveDeploy, saveKey } from '../src/env';
import { account, exists, provider, view } from '../src/near';

const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
if (NETWORK === `mainnet`) throw new Error(`setup.ts is for testnet and the local chain only`);
// the local chain's genesis account test.near is the root there (its key: minear-r3f/server/.sandbox/data/validator_key.json)
const ROOT = opt(`--root`) ?? process.env.MINEAR_ROOT ?? (LOCAL ? `test.near` : `minear-game.testnet`);
const CONTRACT = `items.${ROOT}`;
const RELAY = `relay.${ROOT}`;
const FAUCET = `https://helper.nearprotocol.com/account`;
const WASM = join(APP_DIR, `contracts`, `items`, `target`, `near`, `minear_items.wasm`);

const log = (...a: unknown[]) => console.log(`[setup]`, ...a);
const near = (yocto: bigint) => (Number(yocto / 10n ** 20n) / 1e4).toFixed(4);

async function balance(id: string): Promise<bigint> {
  const a = (await provider.viewAccount({ accountId: id })) as unknown as { amount: string | bigint };
  return BigInt(a.amount);
}

function newKey(id: string): KeyPair {
  const k = KeyPair.fromRandom(`ed25519`);
  saveKey(id, k.getPublicKey().toString(), k.toString());
  return k;
}

async function ensureRoot() {
  if (LOCAL) {
    // the local chain: copy the genesis key of test.near once; no faucet
    if (!hasKey(ROOT)) {
      const v = JSON.parse(readFileSync(join(SANDBOX_DIR, `data`, `validator_key.json`), `utf8`)) as {
        account_id: string;
        public_key: string;
        secret_key: string;
      };
      if (v.account_id !== ROOT) throw new Error(`the local chain's genesis account is ${v.account_id}, not ${ROOT}`);
      saveKey(ROOT, v.public_key, v.secret_key);
    }
    if (!(await exists(ROOT))) throw new Error(`${ROOT} is not on the local chain: is it running (npm run local:chain)?`);
    log(`root ${ROOT} (local chain)`);
    return;
  }
  if (await exists(ROOT)) {
    if (!hasKey(ROOT)) throw new Error(`${ROOT} exists but this server has no key for it: pass --root <new-name>.testnet`);
    log(`root ${ROOT} exists`);
    return;
  }
  const k = hasKey(ROOT) ? KeyPair.fromString(loadKey(ROOT)) : newKey(ROOT);
  log(`creating ${ROOT} from the testnet faucet`);
  const r = await fetch(FAUCET, {
    method: `POST`,
    headers: { 'content-type': `application/json` },
    body: JSON.stringify({ newAccountId: ROOT, newAccountPublicKey: k.getPublicKey().toString() }),
  });
  if (!r.ok) throw new Error(`faucet: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
  for (let i = 0; i < 20 && !(await exists(ROOT)); i++) await Bun.sleep(1500);
  if (!(await exists(ROOT))) throw new Error(`faucet answered but ${ROOT} does not exist yet`);
}

async function ensureSub(id: string, nearAmount: string) {
  if (await exists(id)) {
    if (!hasKey(id)) throw new Error(`${id} exists but this server has no key for it`);
    return;
  }
  const k = hasKey(id) ? KeyPair.fromString(loadKey(id)) : newKey(id);
  const acts: Action[] = [actions.createAccount()];
  if (nearAmount !== `0`) acts.push(actions.transfer(nearToYocto(nearAmount)));
  acts.push(actions.addFullAccessKey(PublicKey.fromString(k.getPublicKey().toString())));
  await account(ROOT).signAndSendTransaction({ receiverId: id, actions: acts });
  log(`created ${id}${nearAmount !== `0` ? ` with ${nearAmount} NEAR` : ``}`);
}

const call = (method: string, a: object, tgas = 15) => actions.functionCall(method, a, teraToGas(tgas), 0n);

/** Owner calls in transactions of at most 14 calls (14 x 15 Tgas). */
async function ownerCalls(list: Action[]) {
  for (let i = 0; i < list.length; i += 14) {
    await account(ROOT).signAndSendTransaction({ receiverId: CONTRACT, actions: list.slice(i, i + 14) });
    log(`owner calls ${i + 1}-${Math.min(list.length, i + 14)} of ${list.length} done`);
  }
}

async function deployed(): Promise<boolean> {
  try {
    await view(CONTRACT, `catalog`);
    return true;
  } catch {
    return false;
  }
}

function chainConfig() {
  return {
    relayer: RELAY,
    daily_free: GAME_CONFIG.dailyFree,
    pack_size: GAME_CONFIG.packSize,
    pack_price: String(GAME_CONFIG.packPrice),
    save_cooldown_ms: GAME_CONFIG.saveCooldownMs,
    starter_coins: String(GAME_CONFIG.starterCoins),
    return_bps: GAME_CONFIG.returnBps,
    repay_bps: GAME_CONFIG.repayBps,
  };
}

async function main() {
  log(`network ${NETWORK}, rpc ${RPC}`);
  if (args.includes(`--config-only`)) {
    // one owner call: the contract settings from minear-r3f/src/economy/catalog.ts GAME_CONFIG (daily_free...)
    await ownerCalls([call(`set_config`, { config: chainConfig() })]);
    log(`config set: daily_free ${GAME_CONFIG.dailyFree}`);
    return;
  }
  if (args.includes(`--code-only`)) {
    // new contract code only, state kept, no owner calls (a v1 contract also gets `migrate` in the same transaction)
    if (!(await deployed())) throw new Error(`${CONTRACT} has no contract yet: run setup without --code-only`);
    const code = readFileSync(WASM);
    const v2 = await view(CONTRACT, `forge_config`).then(() => true, () => false);
    const acts: Action[] = [actions.deployContract(new Uint8Array(code))];
    if (!v2) acts.push(call(`migrate`, {}, 100));
    await account(CONTRACT).signAndSendTransaction({ receiverId: CONTRACT, actions: acts });
    log(`deployed ${code.length} bytes to ${CONTRACT}${v2 ? `` : ` and migrated the v1 state`}`);
    return;
  }
  await ensureRoot();
  log(`root balance ${near(await balance(ROOT))} NEAR`);
  await ensureSub(CONTRACT, `4.5`);
  // local chain NEAR costs nothing: give the relayer plenty, so bots and cheat testing never run it dry
  await ensureSub(RELAY, LOCAL ? `500` : `2`);
  const merchants: Record<string, string> = {};
  for (const m of MERCHANTS) {
    merchants[m.id] = `${m.id}.${ROOT}`;
    await ensureSub(merchants[m.id], `0`);
  }

  const code = readFileSync(WASM);
  // storage: 1 byte = 10^19 yoctoNEAR (0.00001 NEAR). Keep the code's cost plus 2 NEAR for state (gear, trips,
  // boards) on the contract, topped up from the root account before a deploy.
  const need = BigInt(code.length) * 10n ** 19n + nearToYocto(`2`);
  const have = await balance(CONTRACT);
  if (have < need) {
    const add = need - have;
    log(`topping up ${CONTRACT} with ${near(add)} NEAR from ${ROOT} for storage`);
    await account(ROOT).signAndSendTransaction({ receiverId: CONTRACT, actions: [actions.transfer(add)] });
  }
  const config = chainConfig();
  if (!(await deployed())) {
    log(`deploying ${code.length} bytes to ${CONTRACT} and calling new()`);
    await account(CONTRACT).signAndSendTransaction({
      receiverId: CONTRACT,
      actions: [actions.deployContract(new Uint8Array(code)), call(`new`, { owner: ROOT, config }, 30)],
    });
  } else if (args.includes(`--redeploy`)) {
    const v2 = await view(CONTRACT, `forge_config`).then(() => true, () => false);
    log(v2 ? `redeploying code only (state kept)` : `redeploying v2 code and migrating the v1 state (one transaction)`);
    const acts: Action[] = [actions.deployContract(new Uint8Array(code))];
    if (!v2) acts.push(call(`migrate`, {}, 100));
    await account(CONTRACT).signAndSendTransaction({ receiverId: CONTRACT, actions: acts });
  }

  const list: Action[] = [call(`set_config`, { config })];
  for (const t of TOKENS)
    list.push(
      call(`set_material`, {
        material: { token_id: t.id, name: t.name, kind: t.kind, tier: t.tier, base_price: String(t.base), cap_per_hour: t.capPerHour },
      }),
    );
  for (const m of MERCHANTS)
    list.push(
      call(`set_merchant`, {
        merchant: {
          account_id: merchants[m.id],
          name: `${m.name} the ${m.title}`,
          public_key: KeyPair.fromString(loadKey(merchants[m.id])).getPublicKey().toString(),
          tokens: Object.keys(m.target),
          floor: String(m.floor),
          reopen: String(m.reopen),
          closed: false,
        },
      }),
    );
  for (const m of MERCHANTS)
    for (const t of Object.keys(m.target)) {
      const c = caravan(m, t);
      list.push(call(`set_export`, { merchant: merchants[m.id], token_id: t, above: String(c.above), per_day: c.perDay, price_bps: c.priceBps }));
    }
  for (const r of RECIPES)
    list.push(
      call(`set_recipe`, {
        recipe: {
          id: r.id,
          name: r.name,
          inputs: r.inputs.map(([t, n]) => [t, String(n)]),
          fee: String(r.fee),
          outputs: r.outputs.map(([t, n]) => [t, String(n)]),
        },
      }),
    );
  list.push(call(`set_forge`, { forge: forgeChainConfig() }));
  if (args.includes(`--clear-flows`)) list.push(call(`clear_flows`, { token_ids: [...TOKENS.map((t) => t.id), COIN] }));
  await ownerCalls(list);

  const board = await view<Board>(CONTRACT, `market_board`);
  const mints: Action[] = [];
  for (const m of MERCHANTS) {
    const s = board.merchants.find((x) => x.account_id === merchants[m.id]);
    if (s && Number(s.coins) > 0) continue;
    const items = [...Object.entries(m.target).map(([t, n]) => [t, String(n)]), [COIN, String(m.capital)]];
    mints.push(call(`owner_mint`, { account_id: merchants[m.id], items, memo: `capital` }, 30));
  }
  if (mints.length) await ownerCalls(mints);
  else log(`merchants already have capital`);

  const d: Deployment = { network: NETWORK, rpc: RPC, root: ROOT, contract: CONTRACT, relayer: RELAY, merchants };
  saveDeploy(d);
  log(`wrote ${DEPLOY_FILE}`);
  for (const id of [ROOT, CONTRACT, RELAY]) log(`${id}: ${near(await balance(id))} NEAR`);
}

main().catch((e) => {
  console.error(`[setup] failed:`, e instanceof Error ? e.message : e);
  process.exit(1);
});

// MINEAR: the account as the tutorial's after steps see it (folder: minear-r3f/src/tutorial). Signed in or not,
// whether the wallet has NEAR for its own gas, and the gas-free actions left today (the items contract's
// daily_free, read by the vault in minear-r3f/src/economy/vault.ts).
// The gas check is one NEAR RPC read per signed-in player, made the first time a step asks (no timer).
import { session } from '../near/session';
import { vault } from '../economy/vault';
import type { TutorialAccount } from './coach';

let gas: { who: unknown; zero: boolean } | null = null;
let asking: unknown = null;

/** Starts the one gas read for the signed-in player (once per player). */
function checkGas(): void {
  const p = session.player;
  if (!p || gas?.who === p || asking === p) return;
  asking = p;
  void p
    .hasGas()
    .then((has) => {
      if (session.player === p) gas = { who: p, zero: !has };
    })
    .catch(() => undefined)
    .finally(() => {
      if (asking === p) asking = null;
    });
}

export function tutorialAccount(): TutorialAccount {
  const p = session.player;
  if (p) checkGas();
  const v = p ? vault.view : null;
  return {
    signedIn: !!p,
    zeroGas: p && gas?.who === p ? gas.zero : null,
    freeLeft: v ? v.free_left : null,
    freeLimit: v ? v.free_limit : null,
  };
}

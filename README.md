# MINEAR

A mining game on NEAR. You burrow down as a mole, mine ores and gems, and keep what you mine on chain.

> **Status: demo-level prototype on NEAR testnet.**
> Testnet NEAR and the game's items have no money value. Balances, boards and accounts can be reset.
> Features in development are not shown in this repository.

## Live on NEAR testnet

The game runs on the real NEAR testnet. All game accounts are under `minear.testnet`.

| Account | Role | Explorer |
| - | - | - |
| `items.minear.testnet` | The game contract (one contract for everything below) | [view](https://testnet.nearblocks.io/address/items.minear.testnet) |
| `minear.testnet` | Owner of the contract. Creates player accounts and tops up storage and gas. | [view](https://testnet.nearblocks.io/address/minear.testnet) |
| `relay.minear.testnet` | Gas relayer: pays the gas of players who hold no NEAR | [view](https://testnet.nearblocks.io/address/relay.minear.testnet) |
| `smelter`, `gemcutter`, `jeweler`, `wanderer`, `quartermaster`, `relics` `.minear.testnet` | Merchants. They sign price quotes. | |
| `<name>.minear.testnet` | Players who sign in with Google | |

The public account ids are also in `src/economy/deploy.testnet.json`.

### What the contract holds

- **Materials and the game coin:** NEP-245 multi-tokens (ores, gems, boss souls, coin).
- **Gear:** NEP-171 NFTs (with NEP-177 metadata and NEP-181 enumeration) in the same contract. The Forge burns
  materials and mints the gear in one call. The rarity comes from the block's random seed. Each piece keeps a seed,
  and the game turns the seed into stats with the same rules for every player.
- **Trips and boards:** each finished mining trip, each player's record, the last 30 trips of the world, the
  Depth board and the Mined board.
- **Market:** merchants with stock and coins. A trade uses a price that the merchant signed.

## How the live system works

### Ways in

1. **Continue with Google:** NEAR Auth (Google, Apple, email or passkey). The game creates
   `<name>.minear.testnet` for the player. Its full key stays in NEAR's MPC network. No seed phrase.
2. **Connect a NEAR wallet:** the player's own testnet account, through NEAR Connect (Meteor, Intear, Nightly
   and other wallets).
3. **Play demo:** no account. Mining works, but nothing is kept.

### No popups while you play

Each way in ends with a **game key** in the browser: a function-call key for `items.minear.testnet` only, with no
deposit. It can make game moves. It cannot move NEAR or gear. With a wallet, the wallet approves this key one time
per browser.

### Who pays the gas

- The relayer pays the gas for accounts that hold less than 0.15 NEAR. The player needs no NEAR.
- An account with 0.15 NEAR or more pays its own gas. Its game key signs, so the player still sees no popup.
- Limits on free gas: 240 actions per account per UTC day, and 24,000 actions per UTC day for all players together.
  When a limit is used up, free gas comes back at 00:00 UTC.
- The relayer refuses repeated and too-fast requests (bot speed).

### A mining trip

When a signed-in player finishes a trip, the game calls `save_trip` at once. There is no claim step. In one call the
contract:

1. mints the materials of the trip to the player (with an hourly cap per material and a 30 s cooldown),
2. records the trip in the player's record,
3. puts the player on the Depth and Mined boards when the trip is good enough.

The lobby shows the live data: the latest trips, the Depth board, the supply of each material and the market.

The game reports the trip depth for now. The contract checks only that the depth is inside the world.

### Storage

On NEAR each stored byte locks 0.00001 NEAR in the contract. The server checks the balances after relayed calls (at
most once every 10 minutes, with no timer) and tops up the contract and the relayer from `minear.testnet`.

## Run it on your computer

You need Node.js and [bun](https://bun.sh). To build the contract you also need Rust and `cargo-near`.

```bash
npm install
```

The game on the real NEAR testnet (the MINEAR server on 127.0.0.1:8787 and the page on http://localhost:3000):

```bash
npm run dev:testnet
```

Open the page as `http://localhost:3000`, not `http://127.0.0.1:3000`. NEAR Auth's shared testnet login allows only
that address, so Google sign-in does not work on any other address. A NEAR wallet works on any address.

The server needs the keys of the game accounts in `server/.keys/testnet/`. They are not in this repository. To make
your own deployment under a new root account (created from the testnet faucet):

```bash
bun server/tools/setup.ts --root <your-name>.testnet
```

A full local NEAR chain on this computer (chain 127.0.0.1:3030, server 127.0.0.1:8788, page
http://127.0.0.1:5187/?mode=cheat, bot players for 10 minutes). It needs the `near-sandbox` binary in
`server/.sandbox/bin/`; the tool tells you the download command when the binary is missing.

```bash
npm run dev:local
```

The contract tests and the contract build:

```bash
npm run contract:test
```

```bash
npm run contract:build
```

The end-to-end check against a running server (it creates a test player and plays one trip):

```bash
npm run near:smoke
```

Settings: every value has a default. To change one, copy `.env.example` to `.env.local`.

## Folders

| Folder | What it has |
| - | - |
| `src/` | The game (Three.js, TypeScript, Vite) and its NEAR client (`src/near/`) |
| `server/src/` | The MINEAR server: gas relayer, account setup, merchant quotes |
| `server/tools/` | Setup, smoke test, bots, the local chain and the testnet dev run |
| `contracts/items/` | The game contract (Rust, near-sdk) |
| `public/` | 3D models and images |

## License

The code is under the MIT License (see `LICENSE`).

Third-party art keeps its own license:

- "Mole in a Jacket" by ghostmachinesing, https://sketchfab.com/3d-models/mole-in-a-jacket-db0517ffd3544c7e85e976c4ca9af8a5, CC-BY-4.0. Changes: scaled to 2.0 units tall, KayKit Rig_Medium skeleton fitted, skin weights added. File: `public/minear/mole_jacket.glb`.
- "Hard hat" by naira001, https://sketchfab.com/3d-models/hard-hat-a1328e74b0f44b4284af05eb2aa5cfb6, CC-BY-4.0. Changes: made 1 unit wide with its origin at the crown, textures reduced to 512 px JPEG. File: `public/minear/hats/hard_hat.glb`.
- KayKit Character Animations 1.1 by Kay Lousberg (www.kaylousberg.com), CC0. File: `public/minear/anims/crawl.glb`.

CC-BY-4.0 requires this credit wherever the game shows its credits.

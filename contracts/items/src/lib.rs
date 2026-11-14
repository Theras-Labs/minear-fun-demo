//! MINEAR items contract (folder: minear-r3f/contracts/items).
//!
//! One NEP-245 multi-token contract holds every item type: ores, gems, boss souls and the game coin.
//! On top of the standard it runs the game economy, so every move is one atomic step in one contract:
//!
//! - `save_trip`: a miner brings a haul home. Mints it, with an hourly cap per token and a cooldown.
//! - `burn`: a miner uses items up (for example gems shattered at the Wellspring).
//! - `craft`: burns a recipe's inputs and mints its outputs (Refinery, Forge).
//! - `trade`: swaps items and coins with a merchant at a price the merchant agent signed.
//! - `invest`: coins into a merchant; a closed (broke) merchant opens again. Paid back from later sales.
//! - `buy_actions`: burns coins for more gas-free actions today.
//!
//! v2 (2026-11-14):
//! - Gear is NEP-171 NFTs in this same contract (gear.rs): `forge` burns a grade's materials and mints the
//!   pieces in one step, with the rarity rolled here from the block's random seed; `reroll` and `salvage` too.
//!   Each piece stores a seed; the client expands it into stats with the same rules for everyone.
//! - `save_trip` can carry the trip report (depth). It keeps each player's record, the last trips of the world,
//!   and the Depth and Mined boards (trips.rs). The depth comes from the client for now: the contract checks
//!   only that it is within the world. A realtime server will confirm it later (mainnet).
//! - `migrate` turns v1 state into v2 (admin.rs).
//!
//! Gas-free play: a relayer pays gas for players (NEP-366 meta transactions). Those calls arrive with
//! `signer_account_id == config.relayer`, and each one uses one of the player's free actions for the
//! day. A player who pays their own gas uses no free actions. Mint caps and cooldowns apply to both.
//!
//! Merchant prices are not set here. Each merchant agent computes them off-chain from the rules in
//! minear-r3f/src/economy/pricing.ts and signs a quote; this contract checks the signature, the
//! expiry, the nonce and the balances. The contract records the raw facts the rules read: stock,
//! coins, 24 h buy and sell counts per merchant, and 24 h mint and burn counts per token.

use near_sdk::borsh::BorshSerialize;
use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault, PublicKey};

mod admin;
mod events;
mod game;
mod gear;
mod mt;
mod trips;
mod views;

#[cfg(test)]
mod tests;

pub use game::Quote;
pub use gear::{ForgeConfig, ForgeGrade, ForgeKind, Gear};
pub use trips::{Leader, PlayerStats, TripIn, TripRow};
pub use views::*;

pub type TokenId = String;

/// The game coin. It is a token in this contract, not NEAR.
pub const COIN: &str = "coin";
pub const HOUR_MS: u64 = 3_600_000;
pub const DAY_MS: u64 = 86_400_000;
/// Flow counters use 4 buckets of 6 hours: the last 24 hours.
pub const BUCKET_MS: u64 = 6 * HOUR_MS;
pub const BUCKETS: usize = 4;
/// Most token lines in one save_trip, burn or owner mint.
pub const MAX_LINES: usize = 24;
/// Most open loans one merchant can carry.
pub const MAX_LOANS: usize = 24;

#[derive(BorshStorageKey, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    Balances,
    Supply,
    Materials,
    Merchants,
    Recipes,
    Players,
    Nonces,
    Flows,
    TokenFlows,
    Exports,
    Loans,
    // v2: append only (each variant's index is its storage prefix)
    Gear,
    GearOf,
    Stats,
}

/// An item type the game knows.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Material {
    pub token_id: TokenId,
    pub name: String,
    /// "ore", "gem", "soul" or "coin".
    pub kind: String,
    pub tier: u8,
    /// The reference price in coins (pricing.ts scales it; caravans pay a share of it).
    pub base_price: U128,
    /// Most a player can save from trips in one hour. 0: cannot be saved (the coin).
    pub cap_per_hour: u32,
}

/// An NPC merchant: its own NEAR account and key. Its stock and coins are balances in this contract.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Merchant {
    pub account_id: AccountId,
    pub name: String,
    /// The ed25519 key the merchant agent signs quotes with.
    pub public_key: PublicKey,
    pub tokens: Vec<TokenId>,
    /// The shop closes when its coins drop below this.
    pub floor: U128,
    /// A closed shop opens again when investors bring its coins up to this.
    pub reopen: U128,
    pub closed: bool,
}

/// The caravan: the outside world buys a merchant's surplus. It settles at the next trade, from the
/// time that passed, so nothing runs on a timer.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Export {
    /// Stock above this is surplus.
    pub above: U128,
    /// Most surplus units that leave per day.
    pub per_day: u32,
    /// What the caravan pays, in basis points of the base price (6000 = 60%).
    pub price_bps: u32,
    /// Last settlement (ms). 0: not started.
    pub last_ms: u64,
}

/// Counts over the last 24 hours in 4 buckets of 6 hours.
/// Merchant flows: `a` = units players bought, `b` = units players sold.
/// Token flows: `a` = units minted, `b` = units burned.
#[near(serializers = [borsh, json])]
#[derive(Clone, Default)]
pub struct Flow {
    /// Index (time / BUCKET_MS) of the bucket written last.
    pub bucket: u64,
    pub a: [u64; BUCKETS],
    pub b: [u64; BUCKETS],
}

impl Flow {
    fn roll(&mut self, now_ms: u64) {
        let cur = now_ms / BUCKET_MS;
        if cur <= self.bucket {
            return;
        }
        let gap = (cur - self.bucket).min(BUCKETS as u64);
        for i in 1..=gap {
            let s = ((self.bucket + i) % BUCKETS as u64) as usize;
            self.a[s] = 0;
            self.b[s] = 0;
        }
        self.bucket = cur;
    }
    pub(crate) fn add_a(&mut self, now_ms: u64, n: u128) {
        self.roll(now_ms);
        let s = (self.bucket % BUCKETS as u64) as usize;
        self.a[s] = self.a[s].saturating_add(n.min(u64::MAX as u128) as u64);
    }
    pub(crate) fn add_b(&mut self, now_ms: u64, n: u128) {
        self.roll(now_ms);
        let s = (self.bucket % BUCKETS as u64) as usize;
        self.b[s] = self.b[s].saturating_add(n.min(u64::MAX as u128) as u64);
    }
}

/// What the contract keeps per player.
#[near(serializers = [borsh, json])]
#[derive(Clone, Default)]
pub struct Player {
    pub since_ms: u64,
    pub last_save_ms: u64,
    /// Day index (time / DAY_MS, UTC) of `used` and `bonus`.
    pub day: u64,
    /// Gas-free actions used that day.
    pub used: u32,
    /// Extra gas-free actions bought that day.
    pub bonus: u32,
    /// Hour index (time / HOUR_MS) of `minted`.
    pub hour: u64,
    /// Units saved per token that hour.
    pub minted: Vec<(TokenId, u32)>,
}

/// Coins an investor gets back from a merchant's later sales.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Loan {
    pub investor: AccountId,
    pub owed: U128,
}

/// Burns `inputs` and the coin `fee`, mints `outputs`.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Recipe {
    pub id: String,
    pub name: String,
    pub inputs: Vec<(TokenId, U128)>,
    pub fee: U128,
    pub outputs: Vec<(TokenId, U128)>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Config {
    /// The account that pays gas for players (NEP-366 relayer).
    pub relayer: AccountId,
    /// Gas-free actions per player per UTC day.
    pub daily_free: u32,
    /// Extra actions one pack adds (for the rest of the day).
    pub pack_size: u32,
    /// Coins one pack costs (burned).
    pub pack_price: U128,
    /// Shortest time between two saves of one player.
    pub save_cooldown_ms: u64,
    /// Coins a new player gets once.
    pub starter_coins: U128,
    /// Investor return in basis points (2500: an investor gets back 125%).
    pub return_bps: u32,
    /// Share of each merchant sale that goes to its open loans, in basis points.
    pub repay_bps: u32,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    config: Config,
    balances: LookupMap<(AccountId, TokenId), u128>,
    supply: LookupMap<TokenId, u128>,
    materials: IterableMap<TokenId, Material>,
    merchants: IterableMap<AccountId, Merchant>,
    recipes: IterableMap<String, Recipe>,
    players: LookupMap<AccountId, Player>,
    /// Next quote nonce per (merchant, player).
    nonces: LookupMap<(AccountId, AccountId), u64>,
    /// Per (merchant, token): what players bought and sold.
    flows: LookupMap<(AccountId, TokenId), Flow>,
    /// Per token: what was minted and burned.
    token_flows: LookupMap<TokenId, Flow>,
    exports: LookupMap<(AccountId, TokenId), Export>,
    loans: LookupMap<AccountId, Vec<Loan>>,
    // ---- v2 ----
    /// Gear NFTs by token id ("g1", "g2"...).
    gear: LookupMap<String, Gear>,
    /// Token ids each account owns.
    gear_of: LookupMap<AccountId, Vec<String>>,
    /// The number in the next token id.
    gear_next: u64,
    /// Gear that exists now (minted minus burned).
    gear_total: u64,
    forge: ForgeConfig,
    /// Each player's trip record (a separate map, so v1 Player records stay as they are).
    stats: LookupMap<AccountId, PlayerStats>,
    /// The world's last trips, newest first (trips::TRIPS_KEPT).
    trips: Vec<TripRow>,
    /// The Depth board: deepest trip per player, deepest first (trips::TOP_N).
    top_depth: Vec<Leader>,
    /// The Mined board: units saved per player, most first.
    top_mined: Vec<Leader>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, config: Config) -> Self {
        let mut c = Self {
            owner,
            config,
            balances: LookupMap::new(StorageKey::Balances),
            supply: LookupMap::new(StorageKey::Supply),
            materials: IterableMap::new(StorageKey::Materials),
            merchants: IterableMap::new(StorageKey::Merchants),
            recipes: IterableMap::new(StorageKey::Recipes),
            players: LookupMap::new(StorageKey::Players),
            nonces: LookupMap::new(StorageKey::Nonces),
            flows: LookupMap::new(StorageKey::Flows),
            token_flows: LookupMap::new(StorageKey::TokenFlows),
            exports: LookupMap::new(StorageKey::Exports),
            loans: LookupMap::new(StorageKey::Loans),
            gear: LookupMap::new(StorageKey::Gear),
            gear_of: LookupMap::new(StorageKey::GearOf),
            gear_next: 1,
            gear_total: 0,
            forge: ForgeConfig::default(),
            stats: LookupMap::new(StorageKey::Stats),
            trips: Vec::new(),
            top_depth: Vec::new(),
            top_mined: Vec::new(),
        };
        c.materials.insert(
            COIN.to_string(),
            Material {
                token_id: COIN.to_string(),
                name: "Coin".to_string(),
                kind: "coin".to_string(),
                tier: 0,
                base_price: U128(1),
                cap_per_hour: 0,
            },
        );
        c
    }
}

// ---- internal helpers ----

pub(crate) fn now_ms() -> u64 {
    env::block_timestamp_ms()
}

impl Contract {
    pub(crate) fn bal(&self, a: &AccountId, t: &str) -> u128 {
        self.balances.get(&(a.clone(), t.to_string())).copied().unwrap_or(0)
    }

    fn set_bal(&mut self, a: &AccountId, t: &str, v: u128) {
        let k = (a.clone(), t.to_string());
        if v == 0 {
            self.balances.remove(&k);
        } else {
            self.balances.insert(k, v);
        }
    }

    pub(crate) fn add(&mut self, a: &AccountId, t: &str, n: u128) {
        let v = self.bal(a, t).checked_add(n).unwrap_or_else(|| env::panic_str("balance overflow"));
        self.set_bal(a, t, v);
    }

    pub(crate) fn sub(&mut self, a: &AccountId, t: &str, n: u128) {
        let v = self.bal(a, t);
        if v < n {
            env::panic_str(&format!("not enough {t}: {a} has {v}, needs {n}"));
        }
        self.set_bal(a, t, v - n);
    }

    pub(crate) fn mint(&mut self, a: &AccountId, t: &str, n: u128) {
        if n == 0 {
            return;
        }
        self.add(a, t, n);
        let s = self.supply.get(t).copied().unwrap_or(0) + n;
        self.supply.insert(t.to_string(), s);
        let now = now_ms();
        self.token_flows.entry(t.to_string()).or_default().add_a(now, n);
    }

    /// Mints without counting it as mined (merchant capital and starting stock at setup).
    pub(crate) fn mint_quiet(&mut self, a: &AccountId, t: &str, n: u128) {
        if n == 0 {
            return;
        }
        self.add(a, t, n);
        let s = self.supply.get(t).copied().unwrap_or(0) + n;
        self.supply.insert(t.to_string(), s);
    }

    pub(crate) fn burn_from(&mut self, a: &AccountId, t: &str, n: u128) {
        if n == 0 {
            return;
        }
        self.sub(a, t, n);
        let s = self.supply.get(t).copied().unwrap_or(0).saturating_sub(n);
        self.supply.insert(t.to_string(), s);
        let now = now_ms();
        self.token_flows.entry(t.to_string()).or_default().add_b(now, n);
    }

    pub(crate) fn move_tokens(&mut self, from: &AccountId, to: &AccountId, t: &str, n: u128) {
        require!(n > 0, "amount must be above 0");
        require!(from != to, "sender and receiver are the same");
        self.sub(from, t, n);
        self.add(to, t, n);
    }

    pub(crate) fn material(&self, t: &str) -> &Material {
        self.materials.get(t).unwrap_or_else(|| env::panic_str(&format!("unknown token {t}")))
    }

    pub(crate) fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }
}

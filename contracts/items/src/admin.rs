//! Owner methods: config, item types, merchants, caravans, recipes, and minting starting stock.
//! minear-r3f/server/tools/setup.ts calls these from the catalog and pricing files.

use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{env, near, require, AccountId};

use crate::{
    events, Config, Contract, ContractExt, Export, Flow, ForgeConfig, Loan, Material, Merchant, Player, Recipe, StorageKey,
    TokenId, COIN, MAX_LINES,
};

/// The v1 state layout (deployed 2026-11-13), read once by `migrate`.
#[near(serializers = [borsh])]
pub(crate) struct ContractV1 {
    pub(crate) owner: AccountId,
    pub(crate) config: Config,
    pub(crate) balances: LookupMap<(AccountId, TokenId), u128>,
    pub(crate) supply: LookupMap<TokenId, u128>,
    pub(crate) materials: IterableMap<TokenId, Material>,
    pub(crate) merchants: IterableMap<AccountId, Merchant>,
    pub(crate) recipes: IterableMap<String, Recipe>,
    pub(crate) players: LookupMap<AccountId, Player>,
    pub(crate) nonces: LookupMap<(AccountId, AccountId), u64>,
    pub(crate) flows: LookupMap<(AccountId, TokenId), Flow>,
    pub(crate) token_flows: LookupMap<TokenId, Flow>,
    pub(crate) exports: LookupMap<(AccountId, TokenId), Export>,
    pub(crate) loans: LookupMap<AccountId, Vec<Loan>>,
}

#[near]
impl Contract {
    /// v1 -> v2: keeps every v1 collection and adds the empty gear, trip and board state. Only the contract
    /// account can call it (setup.ts --redeploy sends it with the new code in one transaction). It fails on
    /// state that is already v2, so it cannot run twice.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let old: ContractV1 = env::state_read().unwrap_or_else(|| env::panic_str("no v1 state to migrate"));
        Self {
            owner: old.owner,
            config: old.config,
            balances: old.balances,
            supply: old.supply,
            materials: old.materials,
            merchants: old.merchants,
            recipes: old.recipes,
            players: old.players,
            nonces: old.nonces,
            flows: old.flows,
            token_flows: old.token_flows,
            exports: old.exports,
            loans: old.loans,
            gear: LookupMap::new(StorageKey::Gear),
            gear_of: LookupMap::new(StorageKey::GearOf),
            gear_next: 1,
            gear_total: 0,
            forge: ForgeConfig::default(),
            stats: LookupMap::new(StorageKey::Stats),
            trips: Vec::new(),
            top_depth: Vec::new(),
            top_mined: Vec::new(),
        }
    }

    /// The Forge: grades, kinds, salvage and reroll tables, limits (minear-r3f/src/base/workshop.ts via setup.ts).
    pub fn set_forge(&mut self, forge: ForgeConfig) {
        self.assert_owner();
        require!(forge.grades.iter().all(|g| g.weights.len() == 5), "each grade needs 5 rarity weights");
        require!(forge.salvage.len() <= 5 && forge.reroll.len() <= 5, "salvage and reroll go by tier 0..4");
        for g in &forge.grades {
            for (t, _) in &g.inputs {
                self.material(t);
            }
        }
        self.forge = forge;
    }

    pub fn set_config(&mut self, config: Config) {
        self.assert_owner();
        self.config = config;
    }

    pub fn set_owner(&mut self, owner: AccountId) {
        self.assert_owner();
        self.owner = owner;
    }

    pub fn set_material(&mut self, material: Material) {
        self.assert_owner();
        require!(material.token_id != COIN || material.cap_per_hour == 0, "the coin cannot be saved");
        self.materials.insert(material.token_id.clone(), material);
    }

    /// Adds or updates a merchant. Updating keeps its open or closed state.
    pub fn set_merchant(&mut self, merchant: Merchant) {
        self.assert_owner();
        for t in &merchant.tokens {
            require!(t != COIN, "merchants trade items for coins, not coins");
            self.material(t);
        }
        let mut m = merchant;
        if let Some(old) = self.merchants.get(&m.account_id) {
            m.closed = old.closed;
        }
        self.merchants.insert(m.account_id.clone(), m);
    }

    pub fn set_export(&mut self, merchant: AccountId, token_id: TokenId, above: U128, per_day: u32, price_bps: u32) {
        self.assert_owner();
        require!(self.merchants.get(&merchant).is_some(), "unknown merchant");
        self.material(&token_id);
        let key = (merchant, token_id);
        let last_ms = self.exports.get(&key).map(|e| e.last_ms).unwrap_or(0);
        self.exports.insert(key, Export { above, per_day, price_bps, last_ms });
    }

    pub fn set_recipe(&mut self, recipe: Recipe) {
        self.assert_owner();
        for (t, _) in recipe.inputs.iter().chain(recipe.outputs.iter()) {
            self.material(t);
        }
        require!(!recipe.outputs.is_empty(), "a recipe needs an output");
        self.recipes.insert(recipe.id.clone(), recipe);
    }

    pub fn remove_recipe(&mut self, id: String) {
        self.assert_owner();
        self.recipes.remove(&id);
    }

    /// Mints starting stock and coins (merchant capital at setup, test grants). It does not count as
    /// mined in the 24 h token flows the pricing rules read.
    pub fn owner_mint(&mut self, account_id: AccountId, items: Vec<(TokenId, U128)>, memo: Option<String>) {
        self.assert_owner();
        require!(!items.is_empty() && items.len() <= MAX_LINES, "1 to 24 token lines");
        let mut out = Vec::new();
        for (t, n) in items {
            self.material(&t);
            self.mint_quiet(&account_id, &t, n.0);
            out.push((t, n.0));
        }
        events::mint(&account_id, &out, memo.as_deref().unwrap_or("owner"));
    }

    /// Forgets the 24 h mint and burn counts of these tokens (after setup or a test run).
    pub fn clear_flows(&mut self, token_ids: Vec<TokenId>) {
        self.assert_owner();
        for t in token_ids {
            self.token_flows.remove(&t);
        }
    }

    /// Opens or closes a shop by hand (setup and demos).
    pub fn set_closed(&mut self, merchant: AccountId, closed: bool) {
        self.assert_owner();
        let mut m = self.merchants.get(&merchant).cloned().unwrap_or_else(|| near_sdk::env::panic_str("unknown merchant"));
        m.closed = closed;
        self.merchants.insert(merchant, m);
    }
}

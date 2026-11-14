//! Views for the game client, the merchant agents and the relayer. `market_board` returns everything
//! the pricing rules read for every merchant in one call, so a client needs one RPC round trip.

use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId};

use crate::{now_ms, Config, Contract, ContractExt, Export, Flow, Loan, Material, Merchant, Player, PlayerStats, Recipe, TokenId, COIN};

#[near(serializers = [json])]
pub struct CatalogView {
    pub owner: AccountId,
    pub config: Config,
    pub materials: Vec<Material>,
    pub merchants: Vec<Merchant>,
    pub recipes: Vec<Recipe>,
}

/// One merchant as the pricing rules see it. When the shop is open, `stock` and `coins` already
/// include the caravan that the next trade will settle.
#[near(serializers = [json])]
pub struct MerchantState {
    pub account_id: AccountId,
    pub name: String,
    pub closed: bool,
    pub floor: U128,
    pub reopen: U128,
    pub coins: U128,
    pub stock: Vec<(TokenId, U128)>,
    pub flows: Vec<(TokenId, Flow)>,
    pub exports: Vec<(TokenId, Export)>,
    pub loans: Vec<Loan>,
}

#[near(serializers = [json])]
pub struct TokenState {
    pub token_id: TokenId,
    pub supply: U128,
    /// a = minted, b = burned (last 24 h).
    pub flow: Flow,
}

#[near(serializers = [json])]
pub struct Board {
    pub now_ms: u64,
    pub merchants: Vec<MerchantState>,
    pub tokens: Vec<TokenState>,
}

#[near(serializers = [json])]
pub struct PlayerView {
    pub account_id: AccountId,
    /// False until the first game call (register, save_trip, trade...).
    pub known: bool,
    pub balances: Vec<(TokenId, U128)>,
    pub player: Player,
    pub free_left: u32,
    pub free_limit: u32,
    /// The earliest time the next save can go through.
    pub next_save_ms: u64,
    pub now_ms: u64,
    /// v2: the trip record (trips.rs) and how many gear NFTs the player owns (gear.rs).
    pub stats: PlayerStats,
    pub gear: u32,
}

#[near]
impl Contract {
    pub fn catalog(&self) -> CatalogView {
        CatalogView {
            owner: self.owner.clone(),
            config: self.config.clone(),
            materials: self.materials.values().cloned().collect(),
            merchants: self.merchants.values().cloned().collect(),
            recipes: self.recipes.values().cloned().collect(),
        }
    }

    pub fn market_board(&self) -> Board {
        let now = now_ms();
        let merchants = self
            .merchants
            .values()
            .map(|m| {
                let mut coins = self.bal(&m.account_id, COIN);
                let mut stock = Vec::new();
                let mut flows = Vec::new();
                let mut exports = Vec::new();
                for t in &m.tokens {
                    let key = (m.account_id.clone(), t.clone());
                    let mut s = self.bal(&m.account_id, t);
                    if let Some(e) = self.exports.get(&key) {
                        if !m.closed {
                            let (units, c, _) = self.export_amounts(e, &m.account_id, t, now);
                            s -= units;
                            coins += c;
                        }
                        exports.push((t.clone(), e.clone()));
                    }
                    stock.push((t.clone(), U128(s)));
                    flows.push((t.clone(), self.flows.get(&key).cloned().unwrap_or_default()));
                }
                MerchantState {
                    account_id: m.account_id.clone(),
                    name: m.name.clone(),
                    closed: m.closed,
                    floor: m.floor,
                    reopen: m.reopen,
                    coins: U128(coins),
                    stock,
                    flows,
                    exports,
                    loans: self.loans.get(&m.account_id).cloned().unwrap_or_default(),
                }
            })
            .collect();
        let tokens = self
            .materials
            .keys()
            .map(|t| TokenState {
                token_id: t.clone(),
                supply: U128(self.supply.get(t).copied().unwrap_or(0)),
                flow: self.token_flows.get(t).cloned().unwrap_or_default(),
            })
            .collect();
        Board { now_ms: now, merchants, tokens }
    }

    pub fn merchant_nonce(&self, merchant: AccountId, player: AccountId) -> U64 {
        U64(self.nonces.get(&(merchant, player)).copied().unwrap_or(0))
    }

    pub fn player_view(&self, account_id: AccountId) -> PlayerView {
        let now = now_ms();
        let known = self.players.get(&account_id).is_some();
        let mut player = self.players.get(&account_id).cloned().unwrap_or_default();
        Self::roll_day(&mut player, now);
        if player.hour != now / crate::HOUR_MS {
            player.minted.clear();
        }
        let balances = self
            .materials
            .keys()
            .map(|t| (t.clone(), U128(self.bal(&account_id, t))))
            .filter(|(_, n)| n.0 > 0)
            .collect();
        let free_limit = self.config.daily_free + player.bonus;
        let next_save_ms =
            if player.last_save_ms == 0 { 0 } else { player.last_save_ms + self.config.save_cooldown_ms };
        PlayerView {
            known,
            balances,
            free_left: free_limit.saturating_sub(player.used),
            free_limit,
            next_save_ms,
            now_ms: now,
            stats: self.stats.get(&account_id).cloned().unwrap_or_default(),
            gear: self.gear_of_owner(&account_id).len() as u32,
            account_id,
            player,
        }
    }
}

//! The game methods: register, save_trip, burn, craft, trade, invest, buy_actions.
//! Each one takes one gas-free action when the relayer pays (see `charge`), except register and
//! buy_actions.

use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, AccountId};

use crate::events::{self, u};
use crate::{
    now_ms, Contract, ContractExt, Export, Loan, Player, TokenId, TripIn, COIN, DAY_MS, HOUR_MS, MAX_LINES, MAX_LOANS,
};

/// A price a merchant agent signed. `side` is from the player's view: "sell" = the player sells
/// `amount` of `token_id` to the merchant for `coins`; "buy" = the player buys them for `coins`.
#[near(serializers = [json])]
#[derive(Clone)]
pub struct Quote {
    pub merchant: AccountId,
    pub player: AccountId,
    pub token_id: TokenId,
    pub side: String,
    pub amount: U128,
    pub coins: U128,
    pub expires_ms: U64,
    pub nonce: U64,
}

/// The exact bytes a merchant signs (ed25519). minear-r3f/server/src/merchants.ts builds the same string.
pub fn quote_message(contract: &AccountId, q: &Quote) -> String {
    format!(
        "minear-quote-v1|{}|{}|{}|{}|{}|{}|{}|{}|{}",
        contract, q.merchant, q.player, q.token_id, q.side, q.amount.0, q.coins.0, q.expires_ms.0, q.nonce.0
    )
}

/// Adds up repeated token lines; every amount must be above 0.
fn merge(items: Vec<(TokenId, U128)>) -> Vec<(TokenId, u128)> {
    require!(!items.is_empty(), "no items");
    require!(items.len() <= MAX_LINES, "too many token lines");
    let mut out: Vec<(TokenId, u128)> = Vec::new();
    for (t, n) in items {
        require!(n.0 > 0, "amount must be above 0");
        match out.iter_mut().find(|(k, _)| *k == t) {
            Some(e) => e.1 += n.0,
            None => out.push((t, n.0)),
        }
    }
    out
}

impl Contract {
    /// The player's record. A new player gets the starter coins once.
    pub(crate) fn touch(&mut self, who: &AccountId) -> Player {
        if let Some(p) = self.players.get(who) {
            return p.clone();
        }
        let p = Player { since_ms: now_ms(), ..Default::default() };
        let starter = self.config.starter_coins.0;
        if starter > 0 {
            self.mint(who, COIN, starter);
            events::mint(who, &[(COIN.to_string(), starter)], "starter");
        }
        self.players.insert(who.clone(), p.clone());
        p
    }

    pub(crate) fn roll_day(p: &mut Player, now: u64) {
        let day = now / DAY_MS;
        if p.day != day {
            p.day = day;
            p.used = 0;
            p.bonus = 0;
        }
    }

    /// True when the relayer pays the gas for this call (NEP-366 meta transaction).
    pub(crate) fn sponsored(&self, who: &AccountId) -> bool {
        env::signer_account_id() == self.config.relayer && *who != self.config.relayer
    }

    /// Takes one gas-free action when the relayer pays. Self-paid calls take none.
    pub(crate) fn charge(&self, who: &AccountId, p: &mut Player) {
        if !self.sponsored(who) {
            return;
        }
        Self::roll_day(p, now_ms());
        let limit = self.config.daily_free + p.bonus;
        require!(p.used < limit, "no gas-free actions left today: buy a pack, or pay your own gas");
        p.used += 1;
    }

    /// Caravan units and coins due for (merchant, token) at `now`, and how many units time allows.
    pub(crate) fn export_amounts(&self, e: &Export, merchant: &AccountId, token: &str, now: u64) -> (u128, u128, u128) {
        if e.last_ms == 0 {
            return (0, 0, 0);
        }
        let elapsed = now.saturating_sub(e.last_ms) as u128;
        let allowed = elapsed * e.per_day as u128 / DAY_MS as u128;
        let surplus = self.bal(merchant, token).saturating_sub(e.above.0);
        let units = allowed.min(surplus);
        let base = self.materials.get(token).map(|m| m.base_price.0).unwrap_or(0);
        (units, units * base * e.price_bps as u128 / 10_000, allowed)
    }

    /// Settles the caravan for (merchant, token): surplus leaves the world, coins come in.
    pub(crate) fn settle_export(&mut self, merchant: &AccountId, token: &TokenId) {
        let key = (merchant.clone(), token.clone());
        let Some(mut e) = self.exports.get(&key).cloned() else { return };
        let now = now_ms();
        if e.last_ms == 0 {
            e.last_ms = now;
            self.exports.insert(key, e);
            return;
        }
        let (units, coins, allowed) = self.export_amounts(&e, merchant, token, now);
        if allowed == 0 {
            return; // less than one unit of time: keep it adding up
        }
        e.last_ms = now;
        self.exports.insert(key, e);
        if units == 0 {
            return;
        }
        self.burn_from(merchant, token, units);
        self.mint(merchant, COIN, coins);
        events::burn(merchant, &[(token.clone(), units)], "caravan");
        events::mint(merchant, &[(COIN.to_string(), coins)], "caravan");
        events::game("caravan", json!({ "merchant": merchant, "token_id": token, "units": u(units), "coins": u(coins) }));
    }

    /// Pays open loans from `coins_in` the merchant just got (a share of `repay_bps`).
    fn repay(&mut self, merchant: &AccountId, coins_in: u128) {
        let Some(list) = self.loans.get(merchant) else { return };
        if list.is_empty() {
            return;
        }
        let mut loans = list.clone();
        let mut budget = coins_in * self.config.repay_bps as u128 / 10_000;
        while budget > 0 && !loans.is_empty() {
            let pay = budget.min(loans[0].owed.0);
            let investor = loans[0].investor.clone();
            self.move_tokens(merchant, &investor, COIN, pay);
            loans[0].owed = U128(loans[0].owed.0 - pay);
            budget -= pay;
            events::game("repaid", json!({ "merchant": merchant, "investor": investor, "coins": u(pay), "owed": loans[0].owed }));
            if loans[0].owed.0 == 0 {
                loans.remove(0);
            }
        }
        if loans.is_empty() {
            self.loans.remove(merchant);
        } else {
            self.loans.insert(merchant.clone(), loans);
        }
    }
}

#[near]
impl Contract {
    /// Makes the player's record (and pays the starter coins) without using a gas-free action.
    pub fn register(&mut self) {
        let who = env::predecessor_account_id();
        self.touch(&who);
    }

    /// Brings a haul home: mints it to the caller. Hourly cap per token, cooldown between saves.
    /// `trip`: the trip report (v2). It records the trip and the boards (trips.rs); with a trip, `items` may be
    /// empty (a trip that found nothing still counts its depth).
    pub fn save_trip(&mut self, items: Vec<(TokenId, U128)>, trip: Option<TripIn>) {
        let who = env::predecessor_account_id();
        require!(!items.is_empty() || trip.is_some(), "no items");
        let items = if items.is_empty() { Vec::new() } else { merge(items) };
        let mut p = self.touch(&who);
        self.charge(&who, &mut p);
        let now = now_ms();
        let ready = p.last_save_ms + self.config.save_cooldown_ms;
        if p.last_save_ms > 0 && now < ready {
            env::panic_str(&format!("save cooldown: wait {} s", (ready - now).div_ceil(1000)));
        }
        let hour = now / HOUR_MS;
        if p.hour != hour {
            p.hour = hour;
            p.minted.clear();
        }
        for (t, n) in &items {
            let cap = self.material(t).cap_per_hour;
            require!(cap > 0, format!("{t} cannot be saved"));
            let i = match p.minted.iter().position(|(k, _)| k == t) {
                Some(i) => i,
                None => {
                    p.minted.push((t.clone(), 0));
                    p.minted.len() - 1
                }
            };
            let done = p.minted[i].1 as u128;
            if done + n > cap as u128 {
                env::panic_str(&format!("hourly cap for {t} is {cap}; {done} saved this hour"));
            }
            p.minted[i].1 = (done + n) as u32;
            self.mint(&who, t, *n);
        }
        p.last_save_ms = now;
        self.players.insert(who.clone(), p);
        events::mint(&who, &items, "save_trip");
        self.record(&who, &items, trip);
    }

    /// Uses items up (for example gems shattered at the Wellspring). The coin cannot be burned here.
    pub fn burn(&mut self, items: Vec<(TokenId, U128)>, memo: Option<String>) {
        let who = env::predecessor_account_id();
        let items = merge(items);
        let mut p = self.touch(&who);
        self.charge(&who, &mut p);
        self.players.insert(who.clone(), p);
        for (t, n) in &items {
            require!(t != COIN, "use buy_actions to spend coins");
            self.material(t);
            self.burn_from(&who, t, *n);
        }
        events::burn(&who, &items, memo.as_deref().unwrap_or("use"));
    }

    /// Burns a recipe's inputs and fee `times` times, mints its outputs `times` times.
    pub fn craft(&mut self, recipe_id: String, times: Option<u32>) {
        let who = env::predecessor_account_id();
        let times = times.unwrap_or(1);
        require!((1..=100).contains(&times), "times must be 1 to 100");
        let r = self.recipes.get(&recipe_id).cloned().unwrap_or_else(|| env::panic_str("unknown recipe"));
        let mut p = self.touch(&who);
        self.charge(&who, &mut p);
        self.players.insert(who.clone(), p);
        let k = times as u128;
        let mut burned = Vec::new();
        for (t, n) in &r.inputs {
            self.burn_from(&who, t, n.0 * k);
            burned.push((t.clone(), n.0 * k));
        }
        if r.fee.0 > 0 {
            self.burn_from(&who, COIN, r.fee.0 * k);
            burned.push((COIN.to_string(), r.fee.0 * k));
        }
        let mut made = Vec::new();
        for (t, n) in &r.outputs {
            self.material(t);
            self.mint(&who, t, n.0 * k);
            made.push((t.clone(), n.0 * k));
        }
        let memo = format!("craft:{recipe_id}");
        events::burn(&who, &burned, &memo);
        events::mint(&who, &made, &memo);
    }

    /// Swaps with a merchant at the price its agent signed.
    pub fn trade(&mut self, quote: Quote, signature: Base64VecU8) {
        let who = env::predecessor_account_id();
        require!(who == quote.player, "this quote is for another player");
        require!(now_ms() <= quote.expires_ms.0, "quote expired: ask the merchant again");
        let amount = quote.amount.0;
        let coins = quote.coins.0;
        require!(amount > 0, "amount must be above 0");
        let mut m = self.merchants.get(&quote.merchant).cloned().unwrap_or_else(|| env::panic_str("unknown merchant"));
        require!(!m.closed, "this shop is closed until someone invests in it");
        require!(m.tokens.contains(&quote.token_id), "this merchant does not trade that item");

        let sig: [u8; 64] =
            signature.0.as_slice().try_into().unwrap_or_else(|_| env::panic_str("signature must be 64 bytes"));
        let pk = m.public_key.as_bytes();
        require!(pk.len() == 33 && pk[0] == 0, "merchant key must be ed25519");
        let pk: [u8; 32] = pk[1..].try_into().unwrap();
        let msg = quote_message(&env::current_account_id(), &quote);
        require!(env::ed25519_verify(&sig, msg.as_bytes(), &pk), "bad merchant signature");

        let nk = (quote.merchant.clone(), who.clone());
        let next = self.nonces.get(&nk).copied().unwrap_or(0);
        require!(quote.nonce.0 == next, "quote already used: ask the merchant again");
        self.nonces.insert(nk, next + 1);

        let mut p = self.touch(&who);
        self.charge(&who, &mut p);
        self.players.insert(who.clone(), p);
        self.settle_export(&m.account_id, &quote.token_id);

        let now = now_ms();
        let flow_key = (m.account_id.clone(), quote.token_id.clone());
        match quote.side.as_str() {
            "sell" => {
                self.move_tokens(&who, &m.account_id, &quote.token_id, amount);
                if coins > 0 {
                    self.move_tokens(&m.account_id, &who, COIN, coins);
                }
                events::transfer(&who, &m.account_id, &[(quote.token_id.clone(), amount)], Some("sell"));
                if coins > 0 {
                    events::transfer(&m.account_id, &who, &[(COIN.to_string(), coins)], Some("sell"));
                }
                self.flows.entry(flow_key).or_default().add_b(now, amount);
            }
            "buy" => {
                self.move_tokens(&m.account_id, &who, &quote.token_id, amount);
                if coins > 0 {
                    self.move_tokens(&who, &m.account_id, COIN, coins);
                }
                events::transfer(&m.account_id, &who, &[(quote.token_id.clone(), amount)], Some("buy"));
                if coins > 0 {
                    events::transfer(&who, &m.account_id, &[(COIN.to_string(), coins)], Some("buy"));
                    self.repay(&m.account_id, coins);
                }
                self.flows.entry(flow_key).or_default().add_a(now, amount);
            }
            _ => env::panic_str("side must be sell or buy"),
        }
        events::game(
            "trade",
            json!({ "merchant": m.account_id, "player": who, "token_id": quote.token_id, "side": quote.side,
                    "amount": quote.amount, "coins": quote.coins }),
        );
        if self.bal(&m.account_id, COIN) < m.floor.0 {
            m.closed = true;
            events::game("closed", json!({ "merchant": m.account_id, "coins": u(self.bal(&m.account_id, COIN)) }));
            self.merchants.insert(m.account_id.clone(), m);
        }
    }

    /// Puts coins into a merchant. The investor gets back (1 + return_bps) times the amount from the
    /// merchant's later sales. A closed shop opens again when its coins reach `reopen`.
    pub fn invest(&mut self, merchant: AccountId, amount: U128) {
        let who = env::predecessor_account_id();
        require!(amount.0 > 0, "amount must be above 0");
        require!(who != merchant, "a merchant cannot invest in itself");
        let mut m = self.merchants.get(&merchant).cloned().unwrap_or_else(|| env::panic_str("unknown merchant"));
        let mut p = self.touch(&who);
        self.charge(&who, &mut p);
        self.players.insert(who.clone(), p);
        self.move_tokens(&who, &merchant, COIN, amount.0);
        events::transfer(&who, &merchant, &[(COIN.to_string(), amount.0)], Some("invest"));
        let owed = amount.0 * (10_000 + self.config.return_bps as u128) / 10_000;
        let mut loans = self.loans.get(&merchant).cloned().unwrap_or_default();
        match loans.iter_mut().find(|l| l.investor == who) {
            Some(l) => l.owed = U128(l.owed.0 + owed),
            None => {
                require!(loans.len() < MAX_LOANS, "this shop has too many investors");
                loans.push(Loan { investor: who.clone(), owed: U128(owed) });
            }
        }
        self.loans.insert(merchant.clone(), loans);
        events::game("invest", json!({ "merchant": merchant, "investor": who, "coins": amount, "owed": u(owed) }));
        if m.closed && self.bal(&merchant, COIN) >= m.reopen.0 {
            m.closed = false;
            self.merchants.insert(merchant.clone(), m);
            events::game("reopened", json!({ "merchant": merchant }));
        }
    }

    /// Burns `pack_price` coins for `pack_size` more gas-free actions today.
    pub fn buy_actions(&mut self) {
        let who = env::predecessor_account_id();
        let mut p = self.touch(&who);
        Self::roll_day(&mut p, now_ms());
        let price = self.config.pack_price.0;
        self.burn_from(&who, COIN, price);
        p.bonus += self.config.pack_size;
        self.players.insert(who.clone(), p);
        events::burn(&who, &[(COIN.to_string(), price)], "actions");
        events::game("actions", json!({ "player": who, "added": self.config.pack_size }));
    }
}

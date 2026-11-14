//! Gear: NEP-171 NFTs (with NEP-177 metadata and NEP-181 enumeration) in the items contract (v2, 2026-11-14).
//!
//! The Forge runs here, so a piece of gear exists only when the chain made it:
//! - `forge`: burns a grade's materials `times` times and mints `times` pieces in one step. The rarity is rolled
//!   here from the block's random seed (`env::random_seed`), mixed with the player and the token number, with the
//!   grade's weights. One call makes one Legendary at most; after it, a Legendary roll comes out Epic.
//! - `reroll`: burns the tier's cost and gives the piece a new enchant seed.
//! - `salvage`: burns the piece and mints its tier's ore back.
//! Each piece stores its kind, metal, tier, level and a stat seed. The client expands the seed into stats with
//! rollGear (minear-r3f/src/state/gear.ts) and a seeded random generator, so every client shows the same stats
//! and anyone can check them. The stat level is the owner's best trip depth (trips.rs), within lvl_min..lvl_max.
//!
//! A transfer needs exactly 1 yoctoNEAR, so a game session key (no deposit) can never move gear away; only the
//! player's full key can. Approvals are not supported.

use std::collections::HashMap;

use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{assert_one_yocto, env, ext_contract, near, require, AccountId, Gas, PromiseError, PromiseOrValue};

use crate::{events, now_ms, Contract, ContractExt, TokenId};

const GAS_FOR_RESOLVE: Gas = Gas::from_tgas(15);
const GAS_FOR_TRANSFER_CALL: Gas = Gas::from_tgas(40);
/// Rarity names by tier, for the token title.
const TIER_NAMES: [&str; 5] = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];

/// One Forge grade: the metal, what one make burns, and the rarity weights of tiers 0..4.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct ForgeGrade {
    /// The metal and the grade id: "iron", "gold" or "mythril".
    pub id: String,
    /// The metal word in titles: "Iron".
    pub name: String,
    pub inputs: Vec<(TokenId, U128)>,
    pub weights: Vec<u32>,
}

/// One thing the Forge makes: a gear base id of minear-r3f/src/state/gear.ts and its name.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct ForgeKind {
    pub base: String,
    pub name: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Default)]
pub struct ForgeConfig {
    pub grades: Vec<ForgeGrade>,
    pub kinds: Vec<ForgeKind>,
    /// What salvage gives back, by tier (index 0..4).
    pub salvage: Vec<Vec<(TokenId, U128)>>,
    /// What a reroll burns, by tier (index 0..4).
    pub reroll: Vec<Vec<(TokenId, U128)>>,
    /// Most pieces one forge call makes.
    pub max_make: u32,
    /// The stat level is the owner's best trip depth, kept within these.
    pub lvl_min: u32,
    pub lvl_max: u32,
    /// The deepest a trip report may say (the world's bottom), checked in `save_trip` (trips.rs).
    pub max_depth_m: u32,
}

/// One piece of gear.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Gear {
    pub owner_id: AccountId,
    /// The gear base id (minear-r3f/src/state/gear.ts GEAR_BASES), for example "knighthelm".
    pub base: String,
    /// The metal: the Forge grade id.
    pub ore: String,
    /// 0..4: Common, Uncommon, Rare, Epic, Legendary.
    pub tier: u8,
    /// The stat level.
    pub lvl: u32,
    /// The stat seed (64 hex characters).
    pub seed: String,
    /// The enchant seed of the last reroll (64 hex characters), if any.
    pub reroll: Option<String>,
    pub rerolls: u32,
    pub made_ms: u64,
}

/// A piece with its token id (what forge, reroll and the gear views return).
#[near(serializers = [json])]
pub struct GearToken {
    pub token_id: String,
    pub gear: Gear,
}

/// NEP-177 token metadata.
#[near(serializers = [json])]
pub struct TokenMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub media: Option<String>,
    pub media_hash: Option<String>,
    pub copies: Option<u64>,
    pub issued_at: Option<String>,
    pub expires_at: Option<String>,
    pub starts_at: Option<String>,
    pub updated_at: Option<String>,
    /// JSON: base, ore, tier, lvl, seed, reroll (what the client needs to show the stats).
    pub extra: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

/// A NEP-171 token.
#[near(serializers = [json])]
pub struct NftToken {
    pub token_id: String,
    pub owner_id: AccountId,
    pub metadata: Option<TokenMetadata>,
    pub approved_account_ids: Option<HashMap<AccountId, u64>>,
}

/// NEP-177 contract metadata.
#[near(serializers = [json])]
pub struct NftContractMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub base_uri: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

#[ext_contract(ext_nft_receiver)]
#[allow(dead_code)]
trait NftReceiver {
    fn nft_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_id: AccountId,
        token_id: String,
        msg: String,
    ) -> PromiseOrValue<bool>;
}

fn hex(b: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(b.len() * 2);
    for x in b {
        s.push(H[(x >> 4) as usize] as char);
        s.push(H[(x & 15) as usize] as char);
    }
    s
}

/// A weighted pick of tiers 0..weights.len() from the first 8 bytes of `r`.
fn pick(weights: &[u32], r: &[u8; 32]) -> u8 {
    let total: u64 = weights.iter().map(|w| *w as u64).sum();
    let mut x = u64::from_le_bytes(r[..8].try_into().unwrap()) % total.max(1);
    for (i, w) in weights.iter().enumerate() {
        if x < *w as u64 {
            return i as u8;
        }
        x -= *w as u64;
    }
    0
}

impl Contract {
    /// 32 random bytes for (player, number, salt) from the block's random seed.
    fn roll(&self, who: &AccountId, n: u64, salt: &str) -> [u8; 32] {
        let mut b = env::random_seed();
        b.extend_from_slice(who.as_bytes());
        b.extend_from_slice(&n.to_le_bytes());
        b.extend_from_slice(salt.as_bytes());
        env::sha256_array(&b)
    }

    pub(crate) fn gear_of_owner(&self, who: &AccountId) -> Vec<String> {
        self.gear_of.get(who).cloned().unwrap_or_default()
    }

    fn own(&mut self, who: &AccountId, ids: &[String]) {
        let mut list = self.gear_of_owner(who);
        list.extend(ids.iter().cloned());
        self.gear_of.insert(who.clone(), list);
    }

    fn disown(&mut self, who: &AccountId, id: &str) {
        let mut list = self.gear_of_owner(who);
        list.retain(|x| x != id);
        if list.is_empty() {
            self.gear_of.remove(who);
        } else {
            self.gear_of.insert(who.clone(), list);
        }
    }

    fn gear_get(&self, token_id: &str) -> Gear {
        self.gear.get(token_id).cloned().unwrap_or_else(|| env::panic_str("no such gear"))
    }

    /// The piece's gear, checked to belong to the caller.
    fn my_gear(&self, who: &AccountId, token_id: &str) -> Gear {
        let g = self.gear_get(token_id);
        require!(&g.owner_id == who, "this gear is not yours");
        g
    }

    fn metadata(&self, token_id: &str, g: &Gear) -> TokenMetadata {
        let kind = self.forge.kinds.iter().find(|k| k.base == g.base).map(|k| k.name.clone()).unwrap_or_else(|| g.base.clone());
        let metal = self.forge.grades.iter().find(|x| x.id == g.ore).map(|x| x.name.clone()).unwrap_or_else(|| g.ore.clone());
        let tier = TIER_NAMES.get(g.tier as usize).copied().unwrap_or("Common");
        TokenMetadata {
            title: Some(format!("{tier} {metal} {kind}")),
            description: Some(format!(
                "MINEAR gear {token_id}, forged on NEAR. Level {}. Its stats come from its seed (rollGear in the game client).",
                g.lvl
            )),
            media: None,
            media_hash: None,
            copies: Some(1),
            issued_at: Some(g.made_ms.to_string()),
            expires_at: None,
            starts_at: None,
            updated_at: None,
            extra: Some(
                json!({ "base": g.base, "ore": g.ore, "tier": g.tier, "lvl": g.lvl, "seed": g.seed, "reroll": g.reroll, "rerolls": g.rerolls })
                    .to_string(),
            ),
            reference: None,
            reference_hash: None,
        }
    }

    fn nft(&self, token_id: &str, g: &Gear) -> NftToken {
        NftToken {
            token_id: token_id.to_string(),
            owner_id: g.owner_id.clone(),
            metadata: Some(self.metadata(token_id, g)),
            approved_account_ids: Some(HashMap::new()),
        }
    }

    fn nft_move(&mut self, from: &AccountId, to: &AccountId, token_id: &str, memo: Option<&str>) {
        require!(from != to, "sender and receiver are the same");
        let mut g = self.my_gear(from, token_id);
        self.disown(from, token_id);
        self.own(to, &[token_id.to_string()]);
        g.owner_id = to.clone();
        self.gear.insert(token_id.to_string(), g);
        events::nft_transfer(from, to, token_id, memo);
    }
}

#[near]
impl Contract {
    /// Makes `times` pieces of kind `kind` (a gear base id) in grade `grade`: burns the materials, rolls the
    /// rarity on chain and mints the pieces to the caller. Uses one gas-free action when the relayer pays.
    pub fn forge(&mut self, kind: String, grade: String, times: Option<u32>) -> Vec<GearToken> {
        let who = env::predecessor_account_id();
        let times = times.unwrap_or(1);
        let f = self.forge.clone();
        require!(!f.grades.is_empty(), "the Forge is not set up");
        require!(times >= 1 && times <= f.max_make.max(1), format!("make 1 to {} at a time", f.max_make.max(1)));
        let g = f.grades.iter().find(|x| x.id == grade).cloned().unwrap_or_else(|| env::panic_str("unknown forge grade"));
        let k = f.kinds.iter().find(|x| x.base == kind).cloned().unwrap_or_else(|| env::panic_str("the Forge does not make that"));
        require!(g.weights.len() == TIER_NAMES.len() && g.weights.iter().any(|w| *w > 0), "bad forge weights");

        let mut p = self.touch(&who);
        self.charge(&who, &mut p);
        self.players.insert(who.clone(), p);

        let n = times as u128;
        let mut burned = Vec::with_capacity(g.inputs.len());
        for (t, k) in &g.inputs {
            self.burn_from(&who, t, k.0 * n);
            burned.push((t.clone(), k.0 * n));
        }
        events::burn(&who, &burned, "forge");

        let best = self.stats.get(&who).map(|s| s.best_depth).unwrap_or(0);
        let lvl = best.clamp(f.lvl_min, f.lvl_max.max(f.lvl_min));
        let now = now_ms();
        let mut out = Vec::with_capacity(times as usize);
        let mut legend = false;
        for _ in 0..times {
            let num = self.gear_next;
            self.gear_next += 1;
            let r = self.roll(&who, num, "forge");
            let mut tier = pick(&g.weights, &r);
            if tier >= 4 {
                if legend {
                    tier = 3;
                } else {
                    legend = true;
                }
            }
            let seed = hex(&env::sha256_array(&[&r[..], b"stats"].concat()));
            let gear = Gear { owner_id: who.clone(), base: k.base.clone(), ore: g.id.clone(), tier, lvl, seed, reroll: None, rerolls: 0, made_ms: now };
            let token_id = format!("g{num}");
            self.gear.insert(token_id.clone(), gear.clone());
            out.push(GearToken { token_id, gear });
        }
        let ids: Vec<String> = out.iter().map(|t| t.token_id.clone()).collect();
        self.own(&who, &ids);
        self.gear_total += times as u64;
        events::nft_mint(&who, &ids, "forge");
        events::game(
            "forge",
            json!({ "player": who, "kind": k.base, "grade": g.id, "tiers": out.iter().map(|t| t.gear.tier).collect::<Vec<_>>(), "token_ids": ids }),
        );
        out
    }

    /// Gives a piece (tier 1 or more) a new enchant seed; its first, built-in stat stays. Burns the tier's cost.
    pub fn reroll(&mut self, token_id: String) -> GearToken {
        let who = env::predecessor_account_id();
        let mut g = self.my_gear(&who, &token_id);
        require!(g.tier >= 1, "this piece has no enchants to reroll");
        let cost = self.forge.reroll.get(g.tier as usize).cloned().unwrap_or_default();
        require!(!cost.is_empty(), "rerolls are not set up");
        let mut p = self.touch(&who);
        self.charge(&who, &mut p);
        self.players.insert(who.clone(), p);
        let mut burned = Vec::with_capacity(cost.len());
        for (t, n) in &cost {
            self.burn_from(&who, t, n.0);
            burned.push((t.clone(), n.0));
        }
        events::burn(&who, &burned, "reroll");
        g.rerolls += 1;
        let r = self.roll(&who, g.rerolls as u64, &format!("reroll:{token_id}"));
        g.reroll = Some(hex(&r));
        self.gear.insert(token_id.clone(), g.clone());
        events::game("reroll", json!({ "player": who, "token_id": token_id, "rerolls": g.rerolls }));
        GearToken { token_id, gear: g }
    }

    /// Breaks a piece into its tier's ore: burns the NFT and mints the ore to the caller.
    pub fn salvage(&mut self, token_id: String) -> Vec<(TokenId, U128)> {
        let who = env::predecessor_account_id();
        let g = self.my_gear(&who, &token_id);
        let out = self.forge.salvage.get(g.tier as usize).cloned().unwrap_or_default();
        let mut p = self.touch(&who);
        self.charge(&who, &mut p);
        self.players.insert(who.clone(), p);
        self.gear.remove(&token_id);
        self.disown(&who, &token_id);
        self.gear_total = self.gear_total.saturating_sub(1);
        events::nft_burn(&who, &[token_id.clone()], "salvage");
        let mut made = Vec::with_capacity(out.len());
        for (t, n) in &out {
            self.material(t);
            self.mint(&who, t, n.0);
            made.push((t.clone(), n.0));
        }
        events::mint(&who, &made, "salvage");
        out
    }

    // ---- NEP-171 core ----

    #[payable]
    pub fn nft_transfer(&mut self, receiver_id: AccountId, token_id: String, approval_id: Option<u64>, memo: Option<String>) {
        assert_one_yocto();
        require!(approval_id.is_none(), "approvals are not supported");
        let sender = env::predecessor_account_id();
        self.nft_move(&sender, &receiver_id, &token_id, memo.as_deref());
    }

    #[payable]
    pub fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        assert_one_yocto();
        require!(approval_id.is_none(), "approvals are not supported");
        require!(env::prepaid_gas() >= GAS_FOR_TRANSFER_CALL, "attach at least 40 Tgas");
        let sender = env::predecessor_account_id();
        self.nft_move(&sender, &receiver_id, &token_id, memo.as_deref());
        ext_nft_receiver::ext(receiver_id.clone())
            .nft_on_transfer(sender.clone(), sender.clone(), token_id.clone(), msg)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_RESOLVE)
                    .with_unused_gas_weight(0)
                    .nft_resolve_transfer(sender, receiver_id, token_id, None),
            )
            .into()
    }

    /// True when the receiver kept the piece. When it asked to return it (or failed), the piece goes back.
    #[private]
    pub fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: String,
        #[allow(unused_variables)] approved_account_ids: Option<HashMap<AccountId, u64>>,
        #[callback_result] result: Result<bool, PromiseError>,
    ) -> bool {
        let give_back = !matches!(result, Ok(false));
        if !give_back {
            return true;
        }
        match self.gear.get(&token_id).cloned() {
            Some(g) if g.owner_id == receiver_id => {
                self.nft_move(&receiver_id, &previous_owner_id, &token_id, Some("refund"));
                false
            }
            // the receiver already moved or salvaged it: it keeps the outcome
            _ => true,
        }
    }

    pub fn nft_token(&self, token_id: String) -> Option<NftToken> {
        self.gear.get(&token_id).map(|g| self.nft(&token_id, g))
    }

    // ---- NEP-177 and NEP-181 ----

    pub fn nft_metadata(&self) -> NftContractMetadata {
        NftContractMetadata {
            spec: "nft-1.0.0".to_string(),
            name: "MINEAR Gear".to_string(),
            symbol: "MGEAR".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }

    pub fn nft_total_supply(&self) -> U128 {
        U128(self.gear_total as u128)
    }

    /// Tokens in id order. `from_index` counts token numbers (burned numbers are skipped).
    pub fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<NftToken> {
        let start = from_index.map(|x| x.0 as u64).unwrap_or(0).max(1);
        let limit = limit.unwrap_or(50).min(100) as usize;
        let mut out = Vec::new();
        let mut n = start;
        while n < self.gear_next && out.len() < limit {
            let id = format!("g{n}");
            if let Some(g) = self.gear.get(&id) {
                out.push(self.nft(&id, g));
            }
            n += 1;
        }
        out
    }

    pub fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        U128(self.gear_of_owner(&account_id).len() as u128)
    }

    pub fn nft_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u64>) -> Vec<NftToken> {
        let from = from_index.map(|x| x.0 as usize).unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100) as usize;
        self.gear_of_owner(&account_id)
            .iter()
            .skip(from)
            .take(limit)
            .filter_map(|id| self.gear.get(id).map(|g| self.nft(id, g)))
            .collect()
    }

    // ---- game views ----

    /// Every piece the account owns, with the raw fields (for the game client).
    pub fn gear_of(&self, account_id: AccountId) -> Vec<GearToken> {
        self.gear_of_owner(&account_id)
            .into_iter()
            .filter_map(|id| self.gear.get(&id).cloned().map(|gear| GearToken { token_id: id, gear }))
            .collect()
    }

    pub fn forge_config(&self) -> ForgeConfig {
        self.forge.clone()
    }
}

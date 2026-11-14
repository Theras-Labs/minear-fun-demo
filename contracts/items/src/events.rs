//! NEP-297 event logs: the NEP-245 events (mt_mint, mt_burn, mt_transfer), the NEP-171 gear events (nft_mint,
//! nft_burn, nft_transfer) and the game events (standard "minear": trade, invest, closed, reopened, caravan,
//! actions, forge, reroll, trip, leader).

use near_sdk::json_types::U128;
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, AccountId};

use crate::TokenId;

fn log(standard: &str, event: &str, data: Value) {
    let e = json!({ "standard": standard, "version": "1.0.0", "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{e}"));
}

fn split(items: &[(TokenId, u128)]) -> (Vec<&str>, Vec<String>) {
    (items.iter().map(|(t, _)| t.as_str()).collect(), items.iter().map(|(_, n)| n.to_string()).collect())
}

pub fn mint(owner: &AccountId, items: &[(TokenId, u128)], memo: &str) {
    if items.is_empty() {
        return;
    }
    let (ids, amounts) = split(items);
    log("nep245", "mt_mint", json!({ "owner_id": owner, "token_ids": ids, "amounts": amounts, "memo": memo }));
}

pub fn burn(owner: &AccountId, items: &[(TokenId, u128)], memo: &str) {
    if items.is_empty() {
        return;
    }
    let (ids, amounts) = split(items);
    log("nep245", "mt_burn", json!({ "owner_id": owner, "token_ids": ids, "amounts": amounts, "memo": memo }));
}

pub fn transfer(from: &AccountId, to: &AccountId, items: &[(TokenId, u128)], memo: Option<&str>) {
    let (ids, amounts) = split(items);
    let mut d = json!({ "old_owner_id": from, "new_owner_id": to, "token_ids": ids, "amounts": amounts });
    if let Some(m) = memo {
        d["memo"] = json!(m);
    }
    log("nep245", "mt_transfer", d);
}

/// NEP-171 events for gear (gear.rs).
pub fn nft_mint(owner: &AccountId, token_ids: &[String], memo: &str) {
    log("nep171", "nft_mint", json!({ "owner_id": owner, "token_ids": token_ids, "memo": memo }));
}

pub fn nft_burn(owner: &AccountId, token_ids: &[String], memo: &str) {
    log("nep171", "nft_burn", json!({ "owner_id": owner, "token_ids": token_ids, "memo": memo }));
}

pub fn nft_transfer(from: &AccountId, to: &AccountId, token_id: &str, memo: Option<&str>) {
    let mut d = json!({ "old_owner_id": from, "new_owner_id": to, "token_ids": [token_id] });
    if let Some(m) = memo {
        d["memo"] = json!(m);
    }
    log("nep171", "nft_transfer", d);
}

pub fn game(event: &str, data: Value) {
    log("minear", event, data);
}

pub fn u(n: u128) -> U128 {
    U128(n)
}

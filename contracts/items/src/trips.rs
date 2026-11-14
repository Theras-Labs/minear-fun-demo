//! Trip records and the boards (v2, 2026-11-14). `save_trip` (game.rs) calls `record` when the client sends the trip
//! report with the haul. It keeps:
//! - each player's record: trips, best depth, units saved, the last PLAYER_TRIPS trips;
//! - the world's last TRIPS_KEPT trips (the lobby's live Trips feed);
//! - the Depth board (deepest trip per player) and the Mined board (units saved per player), TOP_N each.
//! The depth comes from the client for now. The contract checks only that it is within the world
//! (ForgeConfig::max_depth_m). A realtime server will confirm depths later (mainnet).
//! Nothing runs on a timer: everything updates inside the save_trip call.

use near_sdk::serde_json::json;
use near_sdk::{env, near, require, AccountId};

use crate::{events, now_ms, Contract, ContractExt, TokenId};

pub const TRIPS_KEPT: usize = 30;
pub const TOP_N: usize = 20;
pub const PLAYER_TRIPS: usize = 10;

/// What the client reports with a trip's haul.
#[near(serializers = [json])]
#[derive(Clone)]
pub struct TripIn {
    /// The deepest point of the trip, in metres.
    pub depth_m: u32,
}

/// One finished trip.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct TripRow {
    pub account_id: AccountId,
    pub depth_m: u32,
    /// Units saved with it.
    pub items: u64,
    /// The most valuable material in the haul (highest base price), if any.
    pub best: Option<TokenId>,
    pub at_ms: u64,
    /// The new place on the Depth board, when this trip moved the player up.
    pub depth_rank: Option<u8>,
}

/// One row of a board.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Leader {
    pub account_id: AccountId,
    pub value: u64,
    pub at_ms: u64,
}

/// A player's record.
#[near(serializers = [borsh, json])]
#[derive(Clone, Default)]
pub struct PlayerStats {
    pub trips: u32,
    pub best_depth: u32,
    /// Units saved in all (trips and plain saves).
    pub mined: u64,
    /// The player's last trips, newest first.
    pub last: Vec<TripRow>,
}

/// Puts `who` on a board with `value` when it is higher than their row (or a new row that makes the cut).
/// Returns the new place (1 = first) when the player's place changed or they entered the board.
fn place(board: &mut Vec<Leader>, who: &AccountId, value: u64, now: u64) -> Option<u8> {
    let before = board.iter().position(|l| &l.account_id == who);
    if let Some(i) = before {
        if board[i].value >= value {
            return None;
        }
        board.remove(i);
    } else if board.len() >= TOP_N && board.last().map(|l| l.value >= value).unwrap_or(false) {
        return None;
    }
    let at = board.iter().position(|l| l.value < value).unwrap_or(board.len());
    board.insert(at, Leader { account_id: who.clone(), value, at_ms: now });
    board.truncate(TOP_N);
    match before {
        Some(i) if i == at => None,
        _ => Some((at + 1) as u8),
    }
}

impl Contract {
    /// Records a save: units on the Mined board, and with a trip report the trip, the record and the Depth board.
    pub(crate) fn record(&mut self, who: &AccountId, items: &[(TokenId, u128)], trip: Option<TripIn>) {
        let now = now_ms();
        let units: u64 = items.iter().map(|(_, n)| (*n).min(u64::MAX as u128) as u64).sum();
        let mut st = self.stats.get(who).cloned().unwrap_or_default();
        st.mined = st.mined.saturating_add(units);
        if let Some(r) = place(&mut self.top_mined, who, st.mined, now) {
            events::game("leader", json!({ "board": "mined", "account_id": who, "rank": r, "value": st.mined.to_string() }));
        }
        if let Some(t) = trip {
            let max = self.forge.max_depth_m;
            require!(max == 0 || t.depth_m <= max, format!("a trip cannot go deeper than {max} m"));
            st.trips += 1;
            st.best_depth = st.best_depth.max(t.depth_m);
            let rank = place(&mut self.top_depth, who, st.best_depth as u64, now);
            let best = items
                .iter()
                .max_by_key(|(tk, _)| self.materials.get(tk).map(|m| m.base_price.0).unwrap_or(0))
                .map(|(tk, _)| tk.clone());
            let row = TripRow { account_id: who.clone(), depth_m: t.depth_m, items: units, best, at_ms: now, depth_rank: rank };
            st.last.insert(0, row.clone());
            st.last.truncate(PLAYER_TRIPS);
            self.trips.insert(0, row);
            self.trips.truncate(TRIPS_KEPT);
            events::game("trip", json!({ "player": who, "depth_m": t.depth_m, "items": units.to_string(), "depth_rank": rank }));
            if let Some(r) = rank {
                events::game("leader", json!({ "board": "depth", "account_id": who, "rank": r, "value": st.best_depth.to_string() }));
            }
        }
        self.stats.insert(who.clone(), st);
    }
}

/// The lobby's live board in one view call.
#[near(serializers = [json])]
pub struct LobbyFeed {
    pub now_ms: u64,
    pub trips: Vec<TripRow>,
    pub top_depth: Vec<Leader>,
    pub top_mined: Vec<Leader>,
}

#[near]
impl Contract {
    pub fn lobby_feed(&self) -> LobbyFeed {
        LobbyFeed { now_ms: env::block_timestamp_ms(), trips: self.trips.clone(), top_depth: self.top_depth.clone(), top_mined: self.top_mined.clone() }
    }

    pub fn player_stats(&self, account_id: AccountId) -> PlayerStats {
        self.stats.get(&account_id).cloned().unwrap_or_default()
    }
}

#[cfg(test)]
mod place_tests {
    use super::*;

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    #[test]
    fn board_keeps_the_best_and_reports_moves() {
        let mut b = Vec::new();
        assert_eq!(place(&mut b, &acc("a.near"), 100, 1), Some(1));
        assert_eq!(place(&mut b, &acc("b.near"), 300, 2), Some(1));
        assert_eq!(place(&mut b, &acc("a.near"), 50, 3), None); // lower than a's row
        assert_eq!(place(&mut b, &acc("a.near"), 400, 4), Some(1)); // a moves to first
        assert_eq!(b.iter().map(|l| l.value).collect::<Vec<_>>(), vec![400, 300]);
        for i in 0..TOP_N {
            place(&mut b, &acc(&format!("p{i}.near")), 1000 + i as u64, 5);
        }
        assert_eq!(b.len(), TOP_N);
        assert_eq!(place(&mut b, &acc("late.near"), 1, 6), None); // does not make the cut
    }
}

//! Unit tests (cargo test, in minear-r3f/contracts/items). They run the contract in near-sdk's mocked
//! blockchain, including the ed25519 host function the merchant signature check uses.

use ed25519_dalek::{Signer, SigningKey};
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, CurveType, NearToken, PublicKey};

use crate::game::quote_message;
use crate::*;

const T0: u64 = 1_800_000_000_000 - (1_800_000_000_000 % HOUR_MS); // start of an hour, in ms
const IRON: &str = "ore.iron";
const GOLD: &str = "ore.gold";
const RUBY: &str = "gem.ruby";

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn at(pred: &str, signer: &str, ms: u64, yocto: u128) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("items.test"))
        .predecessor_account_id(acc(pred))
        .signer_account_id(acc(signer))
        .block_timestamp(ms * 1_000_000)
        .attached_deposit(NearToken::from_yoctonear(yocto));
    testing_env!(b.build());
}

/// The player pays their own gas.
fn as_self(who: &str, ms: u64) {
    at(who, who, ms, 0);
}

/// The relayer pays the gas (meta transaction: predecessor = player, signer = relayer).
fn via_relay(who: &str, ms: u64) {
    at(who, "relay.test", ms, 0);
}

fn key() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}

fn near_pk(k: &SigningKey) -> PublicKey {
    PublicKey::from_parts(CurveType::ED25519, k.verifying_key().to_bytes().to_vec()).unwrap()
}

fn mat(id: &str, base: u128, cap: u32) -> Material {
    Material { token_id: id.into(), name: id.into(), kind: "ore".into(), tier: 1, base_price: U128(base), cap_per_hour: cap }
}

fn setup() -> Contract {
    as_self("owner.test", T0);
    let mut c = Contract::new(
        acc("owner.test"),
        Config {
            relayer: acc("relay.test"),
            daily_free: 3,
            pack_size: 5,
            pack_price: U128(50),
            save_cooldown_ms: 30_000,
            starter_coins: U128(100),
            return_bps: 2500,
            repay_bps: 5000,
        },
    );
    c.set_material(mat(IRON, 5, 100));
    c.set_material(mat(GOLD, 14, 50));
    c.set_material(mat(RUBY, 900, 5));
    c.set_merchant(Merchant {
        account_id: acc("smelter.test"),
        name: "Smelter".into(),
        public_key: near_pk(&key()),
        tokens: vec![IRON.into(), GOLD.into()],
        floor: U128(100),
        reopen: U128(300),
        closed: false,
    });
    c.owner_mint(acc("smelter.test"), vec![(IRON.into(), U128(50)), (COIN.into(), U128(1000))], None);
    c
}

fn quote(side: &str, token: &str, amount: u128, coins: u128, nonce: u64, expires_ms: u64) -> Quote {
    Quote {
        merchant: acc("smelter.test"),
        player: acc("alice.test"),
        token_id: token.into(),
        side: side.into(),
        amount: U128(amount),
        coins: U128(coins),
        expires_ms: U64(expires_ms),
        nonce: U64(nonce),
    }
}

fn sign(q: &Quote) -> Base64VecU8 {
    Base64VecU8(key().sign(quote_message(&acc("items.test"), q).as_bytes()).to_bytes().to_vec())
}

fn bal(c: &Contract, who: &str, t: &str) -> u128 {
    c.mt_balance_of(acc(who), t.into()).0
}

fn merchant(c: &Contract) -> MerchantState {
    c.market_board().merchants.into_iter().next().unwrap()
}

#[test]
fn save_trip_mints_the_haul_and_pays_starter_coins_once() {
    let mut c = setup();
    as_self("alice.test", T0);
    c.save_trip(vec![(IRON.into(), U128(10)), (IRON.into(), U128(5)), (RUBY.into(), U128(1))], None);
    assert_eq!(bal(&c, "alice.test", IRON), 15);
    assert_eq!(bal(&c, "alice.test", RUBY), 1);
    assert_eq!(bal(&c, "alice.test", COIN), 100);
    as_self("alice.test", T0 + 31_000);
    c.save_trip(vec![(IRON.into(), U128(1))], None);
    assert_eq!(bal(&c, "alice.test", COIN), 100, "starter coins only once");
    assert_eq!(c.mt_supply(IRON.into()).unwrap().0, 50 + 16);
}

#[test]
#[should_panic(expected = "save cooldown")]
fn save_trip_has_a_cooldown() {
    let mut c = setup();
    as_self("alice.test", T0);
    c.save_trip(vec![(IRON.into(), U128(1))], None);
    as_self("alice.test", T0 + 2_000);
    c.save_trip(vec![(IRON.into(), U128(1))], None);
}

#[test]
#[should_panic(expected = "hourly cap for gem.ruby")]
fn save_trip_has_an_hourly_cap() {
    let mut c = setup();
    as_self("alice.test", T0);
    c.save_trip(vec![(RUBY.into(), U128(4))], None);
    as_self("alice.test", T0 + 31_000);
    c.save_trip(vec![(RUBY.into(), U128(2))], None);
}

#[test]
fn hourly_cap_resets_the_next_hour() {
    let mut c = setup();
    as_self("alice.test", T0);
    c.save_trip(vec![(RUBY.into(), U128(5))], None);
    as_self("alice.test", T0 + HOUR_MS);
    c.save_trip(vec![(RUBY.into(), U128(5))], None);
    assert_eq!(bal(&c, "alice.test", RUBY), 10);
}

#[test]
#[should_panic(expected = "coin cannot be saved")]
fn coins_cannot_be_saved() {
    let mut c = setup();
    as_self("alice.test", T0);
    c.save_trip(vec![(COIN.into(), U128(10))], None);
}

#[test]
#[should_panic(expected = "no gas-free actions left today")]
fn relayer_paid_actions_have_a_daily_limit() {
    let mut c = setup();
    for i in 0..4 {
        via_relay("alice.test", T0 + i * 31_000);
        c.save_trip(vec![(IRON.into(), U128(1))], None);
    }
}

#[test]
fn self_paid_actions_use_no_free_actions() {
    let mut c = setup();
    for i in 0..3 {
        via_relay("alice.test", T0 + i * 31_000);
        c.save_trip(vec![(IRON.into(), U128(1))], None);
    }
    assert_eq!(c.player_view(acc("alice.test")).free_left, 0);
    as_self("alice.test", T0 + 4 * 31_000);
    c.save_trip(vec![(IRON.into(), U128(1))], None);
    assert_eq!(bal(&c, "alice.test", IRON), 4);
}

#[test]
fn free_actions_reset_the_next_day_and_packs_add_more() {
    let mut c = setup();
    for i in 0..3 {
        via_relay("alice.test", T0 + i * 31_000);
        c.save_trip(vec![(IRON.into(), U128(1))], None);
    }
    via_relay("alice.test", T0 + 100_000);
    c.buy_actions();
    assert_eq!(bal(&c, "alice.test", COIN), 50);
    assert_eq!(c.player_view(acc("alice.test")).free_left, 5);
    via_relay("alice.test", T0 + 130_000);
    c.save_trip(vec![(IRON.into(), U128(1))], None);
    assert_eq!(c.player_view(acc("alice.test")).free_left, 4);
    let next_day = (T0 / DAY_MS + 1) * DAY_MS;
    as_self("bob.test", next_day);
    assert_eq!(c.player_view(acc("alice.test")).free_left, 3);
}

#[test]
fn trade_sell_then_buy() {
    let mut c = setup();
    as_self("alice.test", T0);
    c.save_trip(vec![(IRON.into(), U128(10))], None);

    let q = quote("sell", IRON, 10, 40, 0, T0 + 15_000);
    as_self("alice.test", T0 + 1_000);
    c.trade(q.clone(), sign(&q));
    assert_eq!(bal(&c, "alice.test", IRON), 0);
    assert_eq!(bal(&c, "alice.test", COIN), 140);
    assert_eq!(bal(&c, "smelter.test", IRON), 60);
    assert_eq!(bal(&c, "smelter.test", COIN), 960);

    let q = quote("buy", IRON, 5, 30, 1, T0 + 20_000);
    as_self("alice.test", T0 + 2_000);
    c.trade(q.clone(), sign(&q));
    assert_eq!(bal(&c, "alice.test", IRON), 5);
    assert_eq!(bal(&c, "alice.test", COIN), 110);

    let m = merchant(&c);
    let (_, f) = m.flows.iter().find(|(t, _)| t == IRON).unwrap();
    assert_eq!(f.b.iter().sum::<u64>(), 10, "players sold 10");
    assert_eq!(f.a.iter().sum::<u64>(), 5, "players bought 5");
    assert_eq!(c.merchant_nonce(acc("smelter.test"), acc("alice.test")).0, 2);
}

#[test]
#[should_panic(expected = "bad merchant signature")]
fn trade_rejects_a_changed_price() {
    let mut c = setup();
    as_self("alice.test", T0);
    c.save_trip(vec![(IRON.into(), U128(10))], None);
    let q = quote("sell", IRON, 10, 40, 0, T0 + 15_000);
    let sig = sign(&q);
    let mut greedy = q;
    greedy.coins = U128(400);
    c.trade(greedy, sig);
}

#[test]
#[should_panic(expected = "quote already used")]
fn trade_rejects_a_replay() {
    let mut c = setup();
    as_self("alice.test", T0);
    c.save_trip(vec![(IRON.into(), U128(10))], None);
    let q = quote("sell", IRON, 5, 20, 0, T0 + 15_000);
    c.trade(q.clone(), sign(&q));
    c.trade(q.clone(), sign(&q));
}

#[test]
#[should_panic(expected = "quote expired")]
fn trade_rejects_an_old_quote() {
    let mut c = setup();
    as_self("alice.test", T0);
    c.save_trip(vec![(IRON.into(), U128(10))], None);
    let q = quote("sell", IRON, 5, 20, 0, T0 + 15_000);
    as_self("alice.test", T0 + 16_000);
    c.trade(q.clone(), sign(&q));
}

#[test]
#[should_panic(expected = "this quote is for another player")]
fn trade_rejects_another_players_quote() {
    let mut c = setup();
    let q = quote("sell", IRON, 5, 20, 0, T0 + 15_000);
    as_self("mallory.test", T0);
    c.trade(q.clone(), sign(&q));
}

fn break_the_smelter(c: &mut Contract) {
    as_self("owner.test", T0);
    c.owner_mint(acc("alice.test"), vec![(IRON.into(), U128(300))], None);
    let q = quote("sell", IRON, 300, 950, 0, T0 + 15_000);
    as_self("alice.test", T0 + 1_000);
    c.trade(q.clone(), sign(&q));
}

#[test]
fn a_broke_merchant_closes_and_investors_open_it_again() {
    let mut c = setup();
    break_the_smelter(&mut c);
    assert!(merchant(&c).closed, "50 coins is below the floor of 100");

    as_self("owner.test", T0 + 2_000);
    c.owner_mint(acc("bob.test"), vec![(COIN.into(), U128(300))], None);
    as_self("bob.test", T0 + 3_000);
    c.invest(acc("smelter.test"), U128(300));
    let m = merchant(&c);
    assert!(!m.closed, "350 coins reaches the reopen level of 300");
    assert_eq!(m.loans[0].owed.0, 375, "bob gets back 125%");

    let q = quote("buy", IRON, 10, 100, 1, T0 + 20_000);
    as_self("alice.test", T0 + 4_000);
    c.trade(q.clone(), sign(&q));
    assert_eq!(bal(&c, "bob.test", COIN), 100 + 50, "starter coins plus half of the sale");
    assert_eq!(merchant(&c).loans[0].owed.0, 325);
}

#[test]
#[should_panic(expected = "this shop is closed")]
fn a_closed_shop_does_not_trade() {
    let mut c = setup();
    break_the_smelter(&mut c);
    let q = quote("buy", IRON, 1, 10, 1, T0 + 20_000);
    as_self("alice.test", T0 + 2_000);
    c.trade(q.clone(), sign(&q));
}

#[test]
fn the_caravan_takes_surplus_for_coins_at_the_next_trade() {
    let mut c = setup();
    as_self("owner.test", T0);
    c.set_export(acc("smelter.test"), IRON.into(), U128(20), 24, 6000);
    as_self("alice.test", T0);
    c.save_trip(vec![(IRON.into(), U128(2))], None);
    let q = quote("sell", IRON, 1, 4, 0, T0 + 15_000);
    c.trade(q.clone(), sign(&q)); // starts the caravan clock

    let later = T0 + 2 * HOUR_MS;
    as_self("alice.test", later);
    let m = merchant(&c);
    let stock = m.stock.iter().find(|(t, _)| t == IRON).unwrap().1 .0;
    assert_eq!(stock, 51 - 2, "24 a day is 1 an hour: 2 left with the caravan");
    assert_eq!(m.coins.0, 996 + 6, "2 units at 60% of 5");

    let q = quote("sell", IRON, 1, 4, 1, later + 15_000);
    c.trade(q.clone(), sign(&q));
    assert_eq!(bal(&c, "smelter.test", IRON), 50);
    assert_eq!(bal(&c, "smelter.test", COIN), 1002 - 4);
}

#[test]
fn craft_burns_inputs_and_mints_outputs() {
    let mut c = setup();
    as_self("owner.test", T0);
    c.set_recipe(Recipe {
        id: "smelt.iron".into(),
        name: "Smelt iron into gold".into(),
        inputs: vec![(IRON.into(), U128(4))],
        fee: U128(2),
        outputs: vec![(GOLD.into(), U128(1))],
    });
    as_self("alice.test", T0);
    c.save_trip(vec![(IRON.into(), U128(8))], None);
    c.craft("smelt.iron".into(), Some(2));
    assert_eq!(bal(&c, "alice.test", IRON), 0);
    assert_eq!(bal(&c, "alice.test", GOLD), 2);
    assert_eq!(bal(&c, "alice.test", COIN), 96);
    let iron = c.market_board().tokens.into_iter().find(|t| t.token_id == IRON).unwrap();
    assert_eq!(iron.flow.b.iter().sum::<u64>(), 8, "8 iron burned");
    assert_eq!(iron.flow.a.iter().sum::<u64>(), 8, "8 iron mined; the owner's 50 do not count");
    assert_eq!(iron.supply.0, 50);
}

#[test]
#[should_panic(expected = "1 yoctoNEAR")]
fn transfers_need_one_yocto() {
    let mut c = setup();
    as_self("alice.test", T0);
    c.save_trip(vec![(IRON.into(), U128(3))], None);
    c.mt_transfer(acc("bob.test"), IRON.into(), U128(1), None, None);
}

#[test]
fn transfers_move_items() {
    let mut c = setup();
    as_self("alice.test", T0);
    c.save_trip(vec![(IRON.into(), U128(3))], None);
    at("alice.test", "alice.test", T0, 1);
    c.mt_batch_transfer(acc("bob.test"), vec![IRON.into(), COIN.into()], vec![U128(2), U128(10)], None, None);
    assert_eq!(bal(&c, "bob.test", IRON), 2);
    assert_eq!(bal(&c, "bob.test", COIN), 10);
    assert_eq!(c.mt_batch_balance_of(acc("alice.test"), vec![IRON.into(), COIN.into()]), vec![U128(1), U128(90)]);
}

#[test]
fn flows_forget_after_a_day() {
    let mut f = Flow::default();
    f.add_a(T0, 5);
    f.add_a(T0 + BUCKET_MS, 3);
    assert_eq!(f.a.iter().sum::<u64>(), 8);
    f.add_a(T0 + 4 * BUCKET_MS, 1);
    assert_eq!(f.a.iter().sum::<u64>(), 3 + 1, "the T0 bucket is now older than 24 h; T0+6h is not");
}


// ---- v2: gear NFTs, trip records, boards, migration ----

fn forge_setup(c: &mut Contract) {
    as_self("owner.test", T0);
    c.set_forge(ForgeConfig {
        grades: vec![
            ForgeGrade { id: "iron".into(), name: "Iron".into(), inputs: vec![(IRON.into(), U128(20))], weights: vec![55, 35, 9, 1, 0] },
            ForgeGrade { id: "star".into(), name: "Star".into(), inputs: vec![(IRON.into(), U128(1))], weights: vec![0, 0, 0, 0, 1] },
        ],
        kinds: vec![ForgeKind { base: "knighthelm".into(), name: "Knight Helm".into() }],
        salvage: vec![vec![(IRON.into(), U128(6))]; 5],
        reroll: vec![vec![], vec![(GOLD.into(), U128(4))], vec![(GOLD.into(), U128(6))], vec![(GOLD.into(), U128(2))], vec![(GOLD.into(), U128(4))]],
        max_make: 10,
        lvl_min: 10,
        lvl_max: 900,
        max_depth_m: 1200,
    });
}

#[test]
fn forge_burns_materials_and_mints_gear_nfts() {
    let mut c = setup();
    forge_setup(&mut c);
    as_self("alice.test", T0);
    c.save_trip(vec![(IRON.into(), U128(60))], Some(TripIn { depth_m: 320 }));
    let made = c.forge("knighthelm".into(), "iron".into(), Some(3));
    assert_eq!(made.len(), 3);
    assert_eq!(bal(&c, "alice.test", IRON), 0);
    assert_eq!(c.nft_supply_for_owner(acc("alice.test")).0, 3);
    assert_eq!(c.nft_total_supply().0, 3);
    assert_eq!(made[0].gear.lvl, 320, "the stat level is the best trip depth");
    assert_eq!(made[0].gear.seed.len(), 64);
    assert_ne!(made[0].gear.seed, made[1].gear.seed);
    let t = c.nft_token(made[0].token_id.clone()).unwrap();
    assert_eq!(t.owner_id, acc("alice.test"));
    assert!(t.metadata.unwrap().title.unwrap().ends_with("Iron Knight Helm"));
    assert_eq!(c.gear_of(acc("alice.test")).len(), 3);
    assert_eq!(c.nft_tokens(None, None).len(), 3);
}

#[test]
fn one_forge_call_makes_one_legendary_at_most() {
    let mut c = setup();
    forge_setup(&mut c);
    as_self("alice.test", T0);
    c.save_trip(vec![(IRON.into(), U128(3))], None);
    let tiers: Vec<u8> = c.forge("knighthelm".into(), "star".into(), Some(3)).iter().map(|t| t.gear.tier).collect();
    assert_eq!(tiers, vec![4, 3, 3]);
}

#[test]
#[should_panic(expected = "not enough ore.iron")]
fn forge_needs_the_materials() {
    let mut c = setup();
    forge_setup(&mut c);
    as_self("alice.test", T0);
    c.save_trip(vec![(IRON.into(), U128(10))], None);
    c.forge("knighthelm".into(), "iron".into(), None);
}

#[test]
fn reroll_then_salvage() {
    let mut c = setup();
    forge_setup(&mut c);
    via_relay("alice.test", T0);
    c.save_trip(vec![(IRON.into(), U128(2)), (GOLD.into(), U128(10))], None);
    let id = c.forge("knighthelm".into(), "star".into(), None)[0].token_id.clone();
    let r = c.reroll(id.clone());
    assert_eq!(bal(&c, "alice.test", GOLD), 6, "a Legendary reroll burns 4 gold");
    assert_eq!(r.gear.rerolls, 1);
    assert_eq!(r.gear.reroll.as_ref().map(|x| x.len()), Some(64));
    assert_eq!(c.player_view(acc("alice.test")).free_left, 0, "save_trip, forge, reroll: 3 gas-free actions used");
    as_self("alice.test", T0); // the 4th action of the day: alice pays her own gas
    let out = c.salvage(id.clone());
    assert_eq!(out[0].1 .0, 6);
    assert_eq!(bal(&c, "alice.test", IRON), 1 + 6);
    assert!(c.nft_token(id).is_none());
    assert_eq!(c.nft_total_supply().0, 0);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn a_session_key_cannot_move_gear() {
    let mut c = setup();
    forge_setup(&mut c);
    as_self("alice.test", T0);
    c.save_trip(vec![(IRON.into(), U128(1))], None);
    let id = c.forge("knighthelm".into(), "star".into(), None)[0].token_id.clone();
    c.nft_transfer(acc("bob.test"), id, None, None);
}

#[test]
fn the_full_key_moves_gear_and_only_the_owner_salvages() {
    let mut c = setup();
    forge_setup(&mut c);
    as_self("alice.test", T0);
    c.save_trip(vec![(IRON.into(), U128(1))], None);
    let id = c.forge("knighthelm".into(), "star".into(), None)[0].token_id.clone();
    at("alice.test", "alice.test", T0, 1);
    c.nft_transfer(acc("bob.test"), id.clone(), None, None);
    assert_eq!(c.nft_token(id.clone()).unwrap().owner_id, acc("bob.test"));
    assert_eq!(c.nft_supply_for_owner(acc("alice.test")).0, 0);
    assert_eq!(c.nft_tokens_for_owner(acc("bob.test"), None, None).len(), 1);
    as_self("alice.test", T0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.salvage(id.clone())));
    assert!(r.is_err(), "alice no longer owns it");
}

#[test]
fn trips_fill_the_feed_and_the_boards() {
    let mut c = setup();
    forge_setup(&mut c);
    as_self("alice.test", T0);
    c.save_trip(vec![(IRON.into(), U128(5))], Some(TripIn { depth_m: 300 }));
    as_self("bob.test", T0);
    c.save_trip(vec![(RUBY.into(), U128(1)), (IRON.into(), U128(2))], Some(TripIn { depth_m: 500 }));
    as_self("alice.test", T0 + 31_000);
    c.save_trip(vec![], Some(TripIn { depth_m: 250 })); // found nothing: the depth still counts
    let f = c.lobby_feed();
    assert_eq!(f.trips.len(), 3);
    assert_eq!(f.trips[0].account_id, acc("alice.test"));
    assert_eq!(f.trips[0].depth_rank, None, "250 m is below alice's record");
    assert_eq!(f.trips[1].best.as_deref(), Some(RUBY), "the best find is the highest base price");
    assert_eq!(f.trips[1].depth_rank, Some(1));
    assert_eq!(f.top_depth.iter().map(|l| (l.account_id.to_string(), l.value)).collect::<Vec<_>>(), vec![
        ("bob.test".to_string(), 500),
        ("alice.test".to_string(), 300)
    ]);
    assert_eq!(f.top_mined[0].account_id, acc("alice.test"));
    let st = c.player_stats(acc("alice.test"));
    assert_eq!((st.trips, st.best_depth, st.mined, st.last.len()), (2, 300, 5, 2));
}

#[test]
#[should_panic(expected = "a trip cannot go deeper than 1200 m")]
fn trip_depth_must_be_inside_the_world() {
    let mut c = setup();
    forge_setup(&mut c);
    as_self("alice.test", T0);
    c.save_trip(vec![(IRON.into(), U128(1))], Some(TripIn { depth_m: 99_999 }));
}

#[test]
#[should_panic(expected = "no items")]
fn save_trip_needs_items_or_a_trip() {
    let mut c = setup();
    as_self("alice.test", T0);
    c.save_trip(vec![], None);
}

#[test]
fn migrate_keeps_the_v1_state() {
    use near_sdk::store::{IterableMap, LookupMap};
    as_self("items.test", T0);
    let mut v1 = crate::admin::ContractV1 {
        owner: acc("owner.test"),
        config: setup_config(),
        balances: LookupMap::new(crate::StorageKey::Balances),
        supply: LookupMap::new(crate::StorageKey::Supply),
        materials: IterableMap::new(crate::StorageKey::Materials),
        merchants: IterableMap::new(crate::StorageKey::Merchants),
        recipes: IterableMap::new(crate::StorageKey::Recipes),
        players: LookupMap::new(crate::StorageKey::Players),
        nonces: LookupMap::new(crate::StorageKey::Nonces),
        flows: LookupMap::new(crate::StorageKey::Flows),
        token_flows: LookupMap::new(crate::StorageKey::TokenFlows),
        exports: LookupMap::new(crate::StorageKey::Exports),
        loans: LookupMap::new(crate::StorageKey::Loans),
    };
    v1.materials.insert(IRON.into(), mat(IRON, 5, 100));
    v1.balances.insert((acc("alice.test"), IRON.into()), 7);
    v1.materials.flush();
    v1.balances.flush();
    near_sdk::env::state_write(&v1);
    let c = Contract::migrate();
    assert_eq!(bal(&c, "alice.test", IRON), 7);
    assert_eq!(c.catalog().materials.len(), 1);
    assert_eq!(c.nft_total_supply().0, 0);
    assert!(c.lobby_feed().trips.is_empty());
}

fn setup_config() -> Config {
    Config {
        relayer: acc("relay.test"),
        daily_free: 3,
        pack_size: 5,
        pack_price: U128(50),
        save_cooldown_ms: 30_000,
        starter_coins: U128(100),
        return_bps: 2500,
        repay_bps: 5000,
    }
}

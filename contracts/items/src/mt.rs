//! NEP-245 core: transfers, transfer-and-call with refunds, balances, supply, tokens.
//! Approvals are not supported: each approval argument must be null.
//! Every transfer needs exactly 1 yoctoNEAR attached, so a function-call session key (which cannot
//! attach a deposit) can never move items to another account. Only the player's full key can.

use near_sdk::json_types::U128;
use near_sdk::{
    assert_one_yocto, env, ext_contract, near, require, AccountId, Gas, PromiseError, PromiseOrValue,
};

use crate::{events, Contract, ContractExt, TokenId, MAX_LINES};

const GAS_FOR_RESOLVE: Gas = Gas::from_tgas(15);
const GAS_FOR_TRANSFER_CALL: Gas = Gas::from_tgas(40);

pub type Approval = Option<(AccountId, u64)>;

#[near(serializers = [json])]
pub struct Token {
    pub token_id: TokenId,
    pub owner_id: Option<AccountId>,
}

#[near(serializers = [json])]
pub struct ContractMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub base_uri: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

#[ext_contract(ext_mt_receiver)]
#[allow(dead_code)]
trait MtReceiver {
    fn mt_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>>;
}

impl Contract {
    fn batch_move(
        &mut self,
        sender: &AccountId,
        receiver: &AccountId,
        token_ids: &[TokenId],
        amounts: &[U128],
        approvals: Option<Vec<Approval>>,
        memo: Option<&str>,
    ) {
        require!(!token_ids.is_empty(), "no tokens");
        require!(token_ids.len() == amounts.len(), "token_ids and amounts differ in length");
        require!(token_ids.len() <= MAX_LINES, "too many tokens in one call");
        if let Some(a) = approvals {
            require!(a.len() == token_ids.len(), "approvals and token_ids differ in length");
            require!(a.iter().all(|x| x.is_none()), "approvals are not supported");
        }
        let mut items = Vec::with_capacity(token_ids.len());
        for (t, n) in token_ids.iter().zip(amounts) {
            self.move_tokens(sender, receiver, t, n.0);
            items.push((t.clone(), n.0));
        }
        events::transfer(sender, receiver, &items, memo);
    }

    fn transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Approval>>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        assert_one_yocto();
        require!(env::prepaid_gas() >= GAS_FOR_TRANSFER_CALL, "attach at least 40 Tgas");
        let sender = env::predecessor_account_id();
        self.batch_move(&sender, &receiver_id, &token_ids, &amounts, approvals, memo.as_deref());
        let owners = vec![sender.clone(); token_ids.len()];
        ext_mt_receiver::ext(receiver_id.clone())
            .mt_on_transfer(sender, owners.clone(), token_ids.clone(), amounts.clone(), msg)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_RESOLVE)
                    .with_unused_gas_weight(0)
                    .mt_resolve_transfer(owners, receiver_id, token_ids, amounts, None),
            )
            .into()
    }
}

#[near]
impl Contract {
    #[payable]
    pub fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        amount: U128,
        approval: Approval,
        memo: Option<String>,
    ) {
        assert_one_yocto();
        let sender = env::predecessor_account_id();
        self.batch_move(&sender, &receiver_id, &[token_id], &[amount], Some(vec![approval]), memo.as_deref());
    }

    #[payable]
    pub fn mt_batch_transfer(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Approval>>,
        memo: Option<String>,
    ) {
        assert_one_yocto();
        let sender = env::predecessor_account_id();
        self.batch_move(&sender, &receiver_id, &token_ids, &amounts, approvals, memo.as_deref());
    }

    #[payable]
    pub fn mt_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        amount: U128,
        approval: Approval,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        self.transfer_call(receiver_id, vec![token_id], vec![amount], Some(vec![approval]), memo, msg)
    }

    #[payable]
    pub fn mt_batch_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Approval>>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        self.transfer_call(receiver_id, token_ids, amounts, approvals, memo, msg)
    }

    /// Returns the amounts the receiver kept. Unused amounts go back to their previous owners.
    #[private]
    pub fn mt_resolve_transfer(
        &mut self,
        previous_owner_ids: Vec<AccountId>,
        receiver_id: AccountId,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
        #[allow(unused_variables)] approvals: Option<Vec<Option<Vec<(AccountId, u64, U128)>>>>,
        #[callback_result] result: Result<Vec<U128>, PromiseError>,
    ) -> Vec<U128> {
        let unused: Vec<u128> = match result {
            Ok(v) if v.len() == amounts.len() => v.iter().zip(&amounts).map(|(u, a)| u.0.min(a.0)).collect(),
            _ => amounts.iter().map(|a| a.0).collect(),
        };
        let mut used = Vec::with_capacity(amounts.len());
        for i in 0..token_ids.len() {
            let t = &token_ids[i];
            let refund = unused[i].min(self.bal(&receiver_id, t));
            if refund > 0 {
                let owner = &previous_owner_ids[i];
                self.sub(&receiver_id, t, refund);
                self.add(owner, t, refund);
                events::transfer(&receiver_id, owner, &[(t.clone(), refund)], Some("refund"));
            }
            used.push(U128(amounts[i].0 - refund));
        }
        used
    }

    pub fn mt_balance_of(&self, account_id: AccountId, token_id: TokenId) -> U128 {
        U128(self.bal(&account_id, &token_id))
    }

    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<TokenId>) -> Vec<U128> {
        token_ids.iter().map(|t| U128(self.bal(&account_id, t))).collect()
    }

    pub fn mt_supply(&self, token_id: TokenId) -> Option<U128> {
        self.supply.get(&token_id).map(|s| U128(*s))
    }

    pub fn mt_batch_supply(&self, token_ids: Vec<TokenId>) -> Vec<Option<U128>> {
        token_ids.iter().map(|t| self.supply.get(t).map(|s| U128(*s))).collect()
    }

    /// Every item type here is fungible, so no token has a single owner.
    pub fn mt_token(&self, token_ids: Vec<TokenId>) -> Vec<Option<Token>> {
        token_ids
            .into_iter()
            .map(|t| self.materials.get(&t).map(|_| Token { token_id: t.clone(), owner_id: None }))
            .collect()
    }

    pub fn mt_metadata_contract(&self) -> ContractMetadata {
        ContractMetadata {
            spec: "mt-1.0.0".to_string(),
            name: "MINEAR Items".to_string(),
            symbol: "MINEAR".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }
}

# User-controlled STRK20 keys

The filename is retained for stable links; the architecture is no longer custodial.

## Derivation contract

The connected Robinhood EVM wallet signs one fixed message that explicitly authorizes no transfer.
Domain-separated hashes derive:

- S1: the user's root-linked Starknet account and private/viewing keys;
- S2(index): a fresh Starknet transport account for one public exit; and
- R2(index): a fresh Robinhood execution owner for one Pons position.

The signature and derived secrets live only in a browser-memory ref. They are cleared on account
change/disconnect and are never sent to the application backend, stored in local/session storage,
or placed in analytics. Changing the signed message or derivation labels would derive different
accounts and can orphan funds; treat them as a permanent versioned protocol.

## Outbound invariant

```text
S1 private notes
  → persist LayerSwap order with source/refund S2 and destination R2
  → hosted prover builds a withdrawal to S2
  → AVNU private paymaster submits the pool proof (S1 is not the sender)
  → S2 atomically deploys and transfers exact USDC to LayerSwap via SNIP-29
  → LayerSwap sends USDG to fresh R2 and refunds only to S2
```

The implementation rejects S2 equal to S1, stops on `USER_LINKAGE`, and has no direct S1 execution
fallback. S2 and R2 are public at the exit edge; amount/timing and provider correlation remain.

## Required configuration and blockers

Public pool/service pins live in `deployments/strk20-mainnet.json`. The Starknet RPC provider key,
LayerSwap key, and AVNU paymaster key stay server-side. The mainnet OpenZeppelin account class hash
is required public configuration and must be verified as declared before any funded test.

Before real value: perform a minimum-size round trip, test expiry/refunds/restarts, persist an
idempotent operation journal, add rate limits, independently audit derivation and paymaster code,
and review all logs for signature, key, viewing-key, witness, proof, and exact private-payload leaks.

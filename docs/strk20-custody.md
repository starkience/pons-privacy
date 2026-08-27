# User-controlled STRK20 keys

The filename is retained for stable links; the architecture is no longer custodial.

## Derivation contract

The connected Robinhood EVM wallet signs one fixed message that explicitly authorizes no transfer.
Domain-separated hashes derive:

- S1: the user's root-linked Starknet account and private/viewing keys;
- S2(index): a fresh Starknet transport account for one public exit;
- O2(index): a fresh, memory-only Robinhood owner EOA; and
- R2(index): the factory-predicted `PonsPrivacyAccount` controlled by O2.

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

## Inbound shielding

```text
R1 LayerSwap output → counterfactual S1 → sponsored S1 deploy
  → settled proof base → screened STRK20 register/deposit proof
  → guarded approve + invoke_and_apply_action → private USDC note
```

S1 signs the AVNU outside-execution typed data in browser memory. The client compares every typed
call against its one intended USDC approval before signing. AVNU is the public submitter, the
proving service supplies the mandatory screening attestation, and the deposited amount is the
actual LayerSwap output rather than the requested source amount.

## Required configuration and blockers

Public pool/service pins live in `deployments/strk20-mainnet.json`. The Starknet RPC provider key,
LayerSwap key, and AVNU paymaster key stay server-side. The browser reaches Starknet through an
allowlisted read-only same-origin proxy; it cannot submit a normal Starknet transaction through
that endpoint. The mainnet OpenZeppelin account class hash is required public configuration and
must be verified as declared before any funded test.

The pinned class is OpenZeppelin 3.x `AccountUpgradeable` at
`0x01d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381`; its Stark-curve constructor
and SRC9 ABI were verified against the declared Starknet mainnet class on 2026-08-27.

The privacy-pool mismatch was traced through mainnet history rather than bypassed. At block
`11632886`, the pool proxy registered and replaced its V1 implementation with current class
`0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d`. It reports version `2.0`,
the screening ABI and pinned screener key. The preflight verifies those views, the proof-validity
window, actual encrypted prover/discovery requests, AVNU's atomic deposit shape, sponsored S1
deployment, and `sponsored_private` fees beneath the configured 0.50 USDC ceiling. Compatibility
now passes; the minimum-value funded round trip and independent review still block production.

Before real value: perform a minimum-size round trip, test expiry/refunds/restarts, add rate limits,
independently audit derivation, encrypted-journal and paymaster code, and review all logs for
signature, key, viewing-key, witness, proof, and exact private-payload leaks.

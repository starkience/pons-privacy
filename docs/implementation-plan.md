# Phased implementation plan

## Phase 1 — Pons execution proof: complete

- Robinhood configuration and versioned Pons manifest;
- renamed execution account/factory with isolated EIP-712 and CREATE2 domains;
- launch, curve buy, and curve sell adapter;
- Pons-only semantic relayer;
- malicious-input and quote tests; and
- live-state Robinhood fork proof.

## Phase 2 — transport proof

Execute minimum-size bidirectional Layerswap orders and the same Rhino matrix when credentials are
available. Prove recipients, contract sources, transformations, expiry, retries, and refunds.

Exit gate: choose the provider from executed evidence and freeze validated deposit-action schemas.

## Phase 3 — private funding MVP

Connect an official STRK20 withdrawal to the validated transport action, deliver USDG to a fresh
counterfactual account, and enable private launch/buy. Persist every state transition and separate
provider delivery from Pons execution.

## Phase 4 — sell and return

Create a return order from the execution account, deliver USDC to a fresh Starknet recovery account,
then open a new STRK20 note in a separate resumable step.

## Phase 5 — stronger helper integration

Only if provider primitives support it, build and independently review a purpose-specific Cairo
helper accepting exactly the validated USDC transport action. Do not create a generic arbitrary-call
anonymizer and do not alter STRK20 cryptography.

## Phase 6 — production hardening

Audits, relayer redundancy, spend/prefund limits, versioned bytecode monitoring, provider outage and
refund runbooks, privacy-copy review, telemetry audit, and phase-aware graduated-market support.

# Phased implementation plan

## Phase 1 — Pons execution proof: complete

- Robinhood configuration and versioned Pons manifest;
- renamed execution account/factory with isolated EIP-712 and CREATE2 domains;
- launch, curve buy, and curve sell adapter;
- Pons-only semantic relayer;
- malicious-input and quote tests; and
- live-state Robinhood fork proof.

## Phase 2 — transport proof

LayerSwap is selected and its live bidirectional quote routes are pinned in the SDK. Execute
minimum-size bidirectional LayerSwap orders when partner credentials are available. Prove
recipients, contract sources, transformations, expiry, retries, and refunds.

Exit gate: freeze validated deposit-action schemas from executed evidence.

The project-held RC.4 SDK client and mainnet preflight are implemented, but they do not satisfy this
gate: no provider route has yet been funded and reconciled.

## Phase 3 — private funding MVP

Connect the project-held STRK20 withdrawal to the validated transport action, add authenticated
per-user custodial accounting, deliver USDG to a fresh counterfactual account, and enable private
launch/buy. Persist every state transition and separate proof construction, Starknet submission,
provider delivery, and Pons execution.

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

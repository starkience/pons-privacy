# Phased implementation plan

## Complete in code

- deployed Robinhood `PonsPrivacyAccountFactory` and fork-tested Pons launch/buy/sell path;
- deterministic user-controlled S1, S2, viewing-key, and O2 derivation plus live factory resolution
  of counterfactual R2;
- live LayerSwap quotes and strictly pinned bidirectional swap schemas;
- STRK20 mature-note selection and hosted proving client;
- private-paymaster proof submission with a hard S1 outbound prohibition;
- S2 atomic deploy-and-transfer through standard SNIP-29;
- server-only LayerSwap/AVNU credentials and independent mainnet kill switches; and
- frontend wallet connection plus local privacy-account creation;
- encrypted browser recovery journal and durable UUID-keyed LayerSwap creation/reconciliation; and
- funded-R2 preview plus exact browser-held O2 signing, backend validation, and launch idempotency.

## Phase 2 — funded transport proof

The mainnet OZ account class, STRK20 V2 compatibility set, encrypted service transport, and AVNU
private-pool support are verified. Execute minimum-size inbound and outbound orders. Record exact
calls, source/destination transactions, fees, expiry, refunds,
under/overpayment, duplicates, arbitrary recipients, and restart recovery. Keep both swap gates
false until reconciled evidence passes review.

## Phase 3 — funded private-balance activation

The operation journal and frontend wiring for quote, S1/S2/R2 indices, LayerSwap status, recovery,
withdrawal, and R2 funding are implemented without persisting keys. Complete the minimum funded
shield/withdraw round trip and independently reconcile balances and transaction hashes before
enabling it.

## Phase 4 — launch, trade, sell, return

The user-signed R2 launch path is implemented but disabled until the funded privacy route passes.
Add browser-held buy/sell requests and a fresh return account, with delivery and re-shielding as
separate resumable steps.

## Phase 5 — production hardening

Independent audits, derivation compatibility fixtures, rate/spend limits, provider outage and
refund runbooks, relayer redundancy, telemetry review, and graduated-market policy support.

A purpose-specific Cairo helper is optional future hardening, not required for the current S2
design. Do not deploy a generic anonymizer.

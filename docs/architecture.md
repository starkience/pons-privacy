# Architecture

## Objective

Pons Privacy layers STRK20-backed root-wallet unlinkability in front of the existing Pons launchpad.
It does not deploy a launchpad, bonding curve, AMM, privacy pool, or replacement Pons interface.

## Components and ownership

| Component                      | Responsibility                                                 | Must not do                            |
| ------------------------------ | -------------------------------------------------------------- | -------------------------------------- |
| STRK20                         | private USDC notes, proofs, screening, selective disclosure    | encode Pons semantics                  |
| Project-held STRK20 service    | custody signer/viewing keys, discover notes, request proofs    | expose keys or generic spend endpoints |
| Hosted STRK20 prover/discovery | generate proofs and return encrypted discovery results         | authorize a user withdrawal            |
| Stable transport               | swap/route USDC ↔ USDG and expose durable order state          | claim to be the privacy layer          |
| `PonsPrivacyAccountFactory`    | predict and counterfactually deploy execution accounts         | allow provider-controlled ownership    |
| `PonsPrivacyAccount`           | execute owner-signed, relayed call batches                     | decide which Pons calls are safe       |
| Pons adapter                   | construct exact launch/curve calls from live state             | contain bridge-provider details        |
| Pons relayer                   | decode and semantically constrain every call before simulation | provide an unrestricted target mode    |
| Pons                           | create tokens, run curve markets, graduate liquidity           | learn the connected/root wallet        |

## Key and observer boundary

The backend owns the Starknet account signer and viewing key, constructs actions, discovers notes,
requests a proof from the pinned hosted prover, and submits the Starknet transaction. The user does
not need Ready, Xverse, or any other Starknet wallet and does not confirm Starknet transactions.
The hosted service performs the cryptographic proof computation; “project-held” means the project
orchestrates it and controls the account. Running proof computation itself would require a
self-hosted proving service.

This route is custodial. The project can inspect and spend the account's private notes and must
maintain authenticated per-user accounting if one account serves multiple users. Signer and viewing
keys are persistent only in a production secret manager and are never placed in browser bundles,
logs, analytics, provider metadata, or order records. Derived EVM owner keys and raw identity
signatures remain memory-only.

Observers include the STRK20 prover/screening infrastructure, Starknet and Robinhood RPC operators,
the transport operator/solver, the Pons relayer, sequencers, and public chain observers. Each sees
the requests normal for its role. No architecture claim assumes those operators cannot correlate
network metadata.

## Execution-account lifecycle

1. Derive a domain-separated EVM owner from the authenticated Pons session; this does not require a
   Starknet interaction.
2. Ask the factory for the CREATE2 account at `(owner, accountIndex)`.
3. Create and persist the transport order before moving funds.
4. Deliver USDG to the predicted address before it has code.
5. Sign a call batch binding chain, account, calls, nonce, deadline, relayer fee, and native prefund.
6. The relayer validates owner/index derivation and Pons semantics.
7. The factory deploys the account and executes atomically.
8. Assets and Pons creator attribution remain at the execution account.

Never transfer launch tokens to the connected wallet. A fresh account index should represent one
position or intentionally linkable activity cluster.

## Launch

The adapter reads `canLaunch(account)`, the exact native launch fee, config state, maximum creator
tax, USDG approval, and `previewLaunchEconomics`. It then calls the current Pons factory with:

- USDG as pair token;
- explicit execution-account creator-fee recipient;
- nonzero live economics digest;
- caller-provided 32-byte salt;
- bounded UTF-8 metadata and creator tax; and
- exact native value supplied as a signed relayer prefund.

Pons records the execution account as deployer. Token, curve, metadata, amount, and time are public.

## Buy and sell

Pre-graduation trades are exactly two calls:

1. exact ERC-20 approval to the factory-recorded curve; and
2. curve `buy` or `sell` with a nonzero minimum and the execution account as recipient.

The adapter and relayer verify the curve's token, pair, factory, Pons launch record, and phase. Buy
uses USDG; sell uses the launch token. The current phase-`0` adapter rejects swept, V4, or rescued
records. Graduated Pons V4 markets require a separate adapter and policy.

## Funding and return

Initial private-balance deposit is also a resumable workflow:

```text
connected Robinhood wallet approves one USDG transfer
  → LayerSwap order accepts Robinhood USDG
  → USDC delivered to a fresh Starknet deposit account
  → delivery independently verified
  → project-held STRK20 service opens a private note
```

The connected wallet is public at this deposit edge and LayerSwap can map the order to the Starknet
delivery. It must never fund a Pons execution account directly.

Funding is a durable state machine, not one transaction:

```text
private note spent
  → provider deposit accepted
  → provider source confirmation
  → USDG delivered to predicted Robinhood account
  → independently verified balance
  → Pons execution enabled
```

Return is likewise separate:

```text
Pons sell
  → USDG held by execution account
  → provider return order
  → USDC delivered to fresh Starknet recovery account
  → delivery independently verified
  → new STRK20 note opened
```

Provider delivery and private-note completion are distinct statuses. If note opening fails, the
USDC remains recoverable at the Starknet recovery account; the system resumes note opening rather
than creating a second bridge order.

## Non-goals

- confidential Robinhood calls or amounts;
- hiding transport edges from the selected provider;
- forking Pons or STRK20 cryptography;
- generic arbitrary-call anonymizers or relayer policies;
- claiming a fresh account is sufficient privacy; or
- treating a quoted route as production support.

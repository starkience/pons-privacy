# Architecture

## Objective

Pons Privacy layers STRK20-backed root-wallet unlinkability in front of the existing Pons launchpad.
It does not deploy a launchpad, bonding curve, AMM, privacy pool, or replacement Pons interface.

## Components and ownership

| Component                   | Responsibility                                                 | Must not do                                                |
| --------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------- |
| STRK20                      | private USDC notes, proofs, screening, selective disclosure    | encode Pons semantics                                      |
| Official STRK20 integration | key derivation, note discovery, proof construction             | expose viewing keys to the dapp or persist derived secrets |
| Stable transport            | swap/route USDC ↔ USDG and expose durable order state          | claim to be the privacy layer                              |
| `PonsPrivacyAccountFactory` | predict and counterfactually deploy execution accounts         | allow provider-controlled ownership                        |
| `PonsPrivacyAccount`        | execute owner-signed, relayed call batches                     | decide which Pons calls are safe                           |
| Pons adapter                | construct exact launch/curve calls from live state             | contain bridge-provider details                            |
| Pons relayer                | decode and semantically constrain every call before simulation | provide an unrestricted target mode                        |
| Pons                        | create tokens, run curve markets, graduate liquidity           | learn the connected/root wallet                            |

## Key and observer boundary

The official STRK20 route owns note discovery, viewing-key handling, action construction, and proof
generation. The dapp supplies intent and receives narrowly scoped results. Derived EVM owner keys
and raw identity signatures are memory-only and never enter logs, analytics, provider metadata, or
durable order records.

Observers include the STRK20 prover/screening infrastructure, Starknet and Robinhood RPC operators,
the transport operator/solver, the Pons relayer, sequencers, and public chain observers. Each sees
the requests normal for its role. No architecture claim assumes those operators cannot correlate
network metadata.

## Execution-account lifecycle

1. Derive a domain-separated EVM owner through the official STRK20/privacy route.
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

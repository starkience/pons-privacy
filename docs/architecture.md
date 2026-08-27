# Architecture

## Objective

Pons Privacy adds STRK20-backed root-wallet unlinkability in front of the existing Pons launchpad.
It does not deploy a new bonding curve, AMM, privacy pool, or Pons factory.

## Identity model

The user's connected Robinhood EVM wallet signs one fixed, non-transaction message. In browser
memory, domain-separated derivation creates:

- S1: root-linked Starknet account plus its viewing key;
- S2(index): fresh Starknet transport account for a single public exit;
- O2(index): fresh, memory-only Robinhood owner EOA; and
- R2(index): the counterfactual `PonsPrivacyAccount` controlled by O2 and funded by LayerSwap.

The application server never receives the signature, private keys, or viewing key. Users need no
Ready/Xverse wallet and press no Starknet wallet buttons. The hosted STRK20 prover performs proof
computation; AVNU submits the proved action and pays Starknet gas.

## Components

| Component                   | Responsibility                                                         |
| --------------------------- | ---------------------------------------------------------------------- |
| STRK20 V2 / SDK RC.4        | private USDC notes, screening, proofs, selective disclosure            |
| Browser Privacy SDK client  | derive user keys, discover notes, build proof intents                  |
| Hosted prover/discovery     | compute proofs and return encrypted discovery data                     |
| AVNU private paymaster      | submit pool proof without making S1 the onchain sender                 |
| Fresh S2                    | receive the private withdrawal and execute one public transport action |
| LayerSwap                   | convert Starknet USDC ↔ Robinhood USDG with durable order state        |
| `PonsPrivacyAccountFactory` | predict/deploy fresh R2 execution accounts                             |
| Pons adapter/relayer        | build and enforce exact Pons launch/buy/sell semantics                 |
| Existing Pons contracts     | create tokens and run public curve markets                             |

## Deposit: R1 → S1 → STRK20

```text
connected Robinhood wallet R1
  → LayerSwap USDG order
  → user-derived Starknet account S1 receives USDC
  → AVNU sponsors S1 deployment when counterfactual
  → Privacy SDK obtains screening and proves register + deposit
  → AVNU atomically relays S1 approve + STRK20 apply_action
  → private USDC note (matures after 10 blocks)
```

R1 and S1 are intentionally linked at this entry edge. LayerSwap and public observers can see the
deposit amount and timing. The privacy gain begins after notes rest/mix inside STRK20.

The runner deposits LayerSwap's actual output-transaction amount, not the requested input or all
USDC at S1. It verifies the public balance, immutable registered viewing key, USDC fee token and
fee ceiling, exact paymaster typed-data approval call, and a proof base at least ten blocks after
both funding and deployment. The prover supplies the protocol-required screening attestation;
missing or rejected screening fails closed.

## Private exit: STRK20 → S2 → R2

```text
S1 private notes
  → persist LayerSwap order with source/refund S2 and destination fresh R2
  → proof withdraws USDC to fresh S2
  → AVNU private paymaster submits the pool proof
  → AVNU SNIP-29 atomically deploys S2 and executes exact USDC transfer
  → LayerSwap delivers USDG to R2
```

S1 never invokes the public outbound bridge. The implementation rejects S2 equal to S1, rejects a
`USER_LINKAGE` warning, accepts exactly one USDC transfer for the order amount, fails closed on
ambiguous S2 deployment reads, and has no direct account-execution fallback.

S2 is public and linked to R2 through the LayerSwap order. The intended unlinkability comes from
the private S1→S2 pool withdrawal plus fresh accounts, not from LayerSwap. Amount/timing analysis
and provider correlation remain possible.

## Pons execution

R2 is the counterfactual `PonsPrivacyAccount`; O2 controls it. The existing factory deploys R2 on
first relayed execution. O2 signatures bind chain, account, exact calls, nonce, deadline, relayer
fee, and native prefund. The policy relayer permits only validated Pons launch/buy/sell batches.

Pons sees R2 as creator/trader. Token metadata, curve, trades, balances, and times remain public.
Launch tokens must never be swept to R1.

## Sell and return

A sell leaves USDG at R2. A new operation reverses the stablecoin route to a fresh Starknet entry
account, then shields it into STRK20. Provider delivery and note creation are separate resumable
states; a failed shield must resume from the recoverable Starknet account rather than create a
second bridge order.

## Non-goals

- confidential Robinhood execution or amounts;
- hiding both bridge edges from LayerSwap;
- a shared project wallet or custodial user ledger;
- a generic arbitrary-call anonymizer; or
- treating a quoted route as production support.

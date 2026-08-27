# USDC ↔ USDG transport

Research snapshot: 2026-08-27. Provider routes, fees, limits, and assets can change.

## Required routes

```text
Robinhood USDG → Starknet USDC (entry to S1)
Starknet USDC → Robinhood USDG (fresh S2 to fresh R2)
```

Pons-approved USDG is `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`. Starknet native USDC is
`0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb`.

## Decision

LayerSwap is the MVP transport. The server-side V2 adapter pins networks, assets, token addresses,
decimals, amount, source, destination, refund, status, and transaction schemas. Partner credentials
never enter the browser. Rhino.fi is not an active integration target.

The live Starknet-USDC→Robinhood-USDG route rejected `use_deposit_address=true` with
`QUOTE_REQUIRES_NO_DEPOSIT_ADDRESS`; it requires a connected-wallet action. Therefore STRK20 cannot
safely withdraw directly to a LayerSwap managed deposit address.

The safe composition is:

1. create and persist the LayerSwap order with source/refund S2 and destination fresh R2;
2. privately withdraw from S1 notes to fresh S2 through AVNU's private paymaster; and
3. atomically deploy S2 and execute only the returned USDC transfer through SNIP-29.

This prevents S1 from initiating the public outbound bridge and keeps refunds user-recoverable. It
does not hide S2↔R2 from LayerSwap or eliminate amount/timing correlation.

## Validation boundary

Outbound deposit actions are treated as hostile input. Code requires exactly one action, Starknet
mainnet USDC, `transfer`, one recipient, one Cairo `u256`, and the exact requested base-unit amount.
Extra calls, token substitution, amount changes, managed deposit addresses, or route changes fail
closed. There is no direct execution fallback.

Provider delivery and STRK20 note completion are different durable states. Persist an operation
before funds move, independently reconcile both chains, and resume refunds/shielding without
creating duplicate orders.

## Mainnet release gate

Before setting either LayerSwap kill switch to true:

1. verify minimum/maximum, fee, expiry, and slippage units;
2. execute both directions at minimum value;
3. test counterfactual R2, undeployed S2, and arbitrary S1 recipients;
4. test under/overpayment, duplicate transfer, cancellation, and refund to S2;
5. restart each step and recover from persisted state;
6. reconcile source/destination transaction hashes and balances; and
7. obtain provider confirmation and independent security review.

References: [LayerSwap quickstart](https://learn.layerswap.io/api/api-integration/quickstart),
[create swap](https://docs.layerswap.io/api-reference/swaps/create-swap), and
[deposit actions](https://docs.layerswap.io/api-reference/swaps/get-deposit-actions).

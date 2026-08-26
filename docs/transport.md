# USDC ↔ USDG transport

Research snapshot: 2026-08-26. Provider routes, fees, limits, and supported assets are mutable.

## Required route

```text
Starknet USDC → Robinhood USDG
Robinhood USDG → Starknet USDC
```

Pons V2 currently approves USDG at `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`.
The destination must be an arbitrary counterfactual Robinhood account on funding and a fresh
Starknet recovery account on return.

## Decision

Layerswap is the first transport-proof target. Its live API exposed both directions at the research
snapshot and its order/deposit-action model is automatable. Rhino.fi remains the fallback: the
user-provided UI flow confirmed Robinhood USDG → Starknet USDC, but credentialed forward-route and
contract-sender tests are still required.

Neither provider reproduces a cryptographically bound, atomic “deliver USDC and open a private
note” operation. Both maintain an order mapping source and destination. Therefore:

- provider delivery is not private-note completion;
- the operator can correlate the two edges;
- deposit actions are untrusted data and require narrow schema/address/value validation;
- order state must persist before funds move; and
- recovery must be resumable and independently reconciled against both chains.

Sources: [Layerswap API](https://docs.layerswap.io/api-reference/swaps/create-swap),
[Layerswap deposit actions](https://docs.layerswap.io/api-reference/swaps/get-deposit-actions),
[Layerswap depository](https://github.com/layerswap/layerswap-depository),
[Rhino smart deposit addresses](https://docs.rhino.fi/api-reference/sda/depositaddresses/create-new-deposit-address),
and [Rhino public contracts](https://github.com/rhinofi/contracts_public).

## Proof gates

Before implementing the transport adapter against real funds, execute both directions and record:

1. exact token address and decimals;
2. counterfactual Robinhood and fresh Starknet recipient behavior;
3. smart-contract source behavior, not only EOA UI transfers;
4. minimum/maximum, fee, expiry, and slippage units;
5. underpayment, overpayment, duplicate deposit, cancellation, and refund behavior;
6. process restart and order restoration;
7. source and destination transaction reconciliation; and
8. operator confirmation for production volume and credentials.

Until those pass, the transport is `researched`, not `live` or `production-ready`.

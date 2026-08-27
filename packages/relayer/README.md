# @pons-privacy/relayer

Pons-only Robinhood relayer plus server boundaries for LayerSwap and AVNU. The Pons relayer decodes
and constrains every call against live factory, curve, token, USDG, recipient, economics, approval,
prefund, and slippage state before simulation and broadcast.

`POST /v1/relay` requires `Authorization: Bearer <RELAYER_API_KEY>`. Bind to loopback unless a TLS,
authenticated application backend fronts it.

## LayerSwap and paymaster API

`pnpm dev:deposit-api` starts the backend adapter on `127.0.0.1:8788`. It keeps both partner keys
server-side and exposes:

- inbound quotes and S1-targeted swap creation under `LAYERSWAP_SWAP_CREATION_ENABLED`;
- outbound S2→fresh Robinhood R2 swap creation under
  `LAYERSWAP_OUTBOUND_SWAP_CREATION_ENABLED`; and
- the four allowlisted AVNU JSON-RPC methods at `POST /v1/paymaster` when configured; and
- allowlisted read-only Starknet JSON-RPC at `POST /v1/starknet`. Transaction-submission methods are
  rejected and the upstream provider credential stays server-side; and
- an idempotent `POST /v1/deposits/swaps/:id/relay` boundary for the exact O2-signed R2 USDG return.

Both mainnet swap gates default to false. Outbound LayerSwap actions are accepted only when they
contain one exact Starknet-mainnet USDC transfer for the requested amount. Request/response bodies
at the paymaster boundary contain proofs and signatures and must never be logged. Creation is
reserved in `LAYERSWAP_OPERATION_STORE_PATH` before calling LayerSwap; an ambiguous retry recovers
the provider order by the same UUID reference instead of blindly creating another order.

## Launch application API

`pnpm dev:app-api` starts the user-facing application boundary on `127.0.0.1:8789`. Preview verifies
that R2 is factory-derived and funded, pins live Pons economics, and persists the reviewed draft.
Submission accepts only a user-signed R2 execution request, rechecks its O2 signature and exact Pons
launch semantics, and forwards it to the authenticated loopback relayer. Durable idempotency in
`LAUNCH_OPERATION_STORE_PATH` prevents the same reviewed request from being relayed twice.

`LAUNCH_SUBMISSION_ENABLED` defaults to false and is independent of the relayer broadcast gate.

The same application service exposes `/v1/trades/position`, `/v1/trades/preview`, `/v1/trades`, and
`/v1/trades/status`. It accepts only active Pons USDG curves at the factory-derived R2, caps reviewed
slippage at 10%, requires an exact O2 signature and reviewed approval/trade calldata, revalidates
the live Pons policy, and persists idempotent submissions. `TRADE_SUBMISSION_ENABLED` defaults to
false and is independent from launch submission.

The file stores support a single service instance. A multi-instance deployment must replace them
with transactional shared storage and add user-session, rate/spend-limit, monitoring, and pending
transaction reconciliation at the production edge.

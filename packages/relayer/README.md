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
- the four allowlisted AVNU JSON-RPC methods at `POST /v1/paymaster` when configured.

Both mainnet swap gates default to false. Outbound LayerSwap actions are accepted only when they
contain one exact Starknet-mainnet USDC transfer for the requested amount. Request/response bodies
at the paymaster boundary contain proofs and signatures and must never be logged.

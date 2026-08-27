# @pons-privacy/relayer

Pons-only Robinhood relayer. Every call is decoded and checked against the current Pons factory,
factory-recorded curve/token relationship, USDG, execution-account recipient, live economics,
exact approvals, exact launch prefund, and bounded slippage before simulation and broadcast.

`POST /v1/relay` requires `Authorization: Bearer <RELAYER_API_KEY>`. The server binds to
`127.0.0.1` unless `HOST` is explicitly configured; expose it only behind the authenticated Pons
backend or a TLS reverse proxy. `GET /healthz` does not require authentication.

`pnpm launch:mainnet` is the controlled backend launch client. It defaults to a dry run, requires
an explicit 32-byte token salt, and only broadcasts when `BROADCAST=true`. Its owner key and relayer
API key must come from a server secret store, never a browser bundle.

## LayerSwap deposit API

`pnpm dev:deposit-api` starts the backend-only LayerSwap V2 adapter on `127.0.0.1:8788`.
It serves route limits and quotes without exposing `LAYERSWAP_API_KEY` to the browser. The service
also implements pinned Robinhood USDG → Starknet USDC swap creation, status, and deposit-action
endpoints. Creation returns HTTP 503 unless `LAYERSWAP_SWAP_CREATION_ENABLED=true` and the
project-held `STRK20_ACCOUNT_ADDRESS` is configured.

Deposit actions are parsed as untrusted provider data. Wallet execution remains disabled until a
funded minimum-value route test proves the exact transfer calldata or EIP-712 typed-data allowlist.

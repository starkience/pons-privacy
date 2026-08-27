# Pons Privacy web

Frontend-first private-balance and launch flow for Pons V2 on Robinhood Chain. Users connect an
injected EVM wallet such as MetaMask, Phantom, or Robinhood Wallet. No Starknet wallet is required.

## Local development

```sh
pnpm dev:web
```

The default `demo` mode returns a local launch preview and keeps mainnet deposit and launch controls
locked. The Vite development server proxies live quote reads to LayerSwap at
`/layerswap-api/api/v2`; a deployed application must provide the equivalent same-origin proxy.
Copy `.env.example` to an ignored `.env.local` only when connecting a deployed application backend.

## Private deposits

The browser discovers EVM wallets through EIP-6963 with an injected-provider fallback and switches
the selected wallet to Robinhood Chain. Quote review is live and pinned to:

```text
Robinhood USDG → Starknet USDC → STRK20
```

The browser does not call LayerSwap order creation and never receives the partner API key. The
application backend will create and persist orders, validate the exact deposit-action schema, and
return only narrowly typed wallet actions after the funded route proof is complete. Until then, the
deposit modal intentionally stops after quote review.

## Application API

The browser calls an authenticated application backend, never the policy relayer directly:

- `POST /v1/launches/preview` validates metadata, reads current Pons economics, derives the fresh
  execution account, and returns an expiring preview;
- `POST /v1/launches` accepts the reviewed draft, preview ID, and idempotency key, then queues the
  launch through the project-held service.

Both requests use same-origin credentials. The backend must enforce the user session, CSRF and
rate-limit policy, revalidate live Pons state, validate or proxy artwork, persist an operation
journal, and call the internal authenticated relayer. It must never return a signer, viewing key,
relayer API key, proof witness, or raw private note payload to the browser.

`VITE_MAINNET_LAUNCH_ENABLED=true` only unlocks the frontend control; it is not an authorization
boundary. Keep it `false` until the application API, operation journal, transport route, monitoring,
and release gates are deployed and reviewed.

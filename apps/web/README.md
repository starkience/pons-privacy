# Pons Privacy web

Frontend-first private-balance and launch flow for Pons V2 on Robinhood Chain. Users connect an
injected EVM wallet such as MetaMask, Phantom, or Robinhood Wallet. No Starknet wallet is required.
One fixed non-transaction signature derives the user's S1, viewing key, fresh S2 transport
accounts, and fresh Robinhood owners locally. A read-only factory call resolves the counterfactual
R2 `PonsPrivacyAccount`, which is the bridge destination; derived secrets remain in browser memory.

## Local development

```sh
pnpm dev:web
```

The default `demo` mode returns a local launch preview and keeps mainnet deposit and launch controls
locked. Start `pnpm dev:deposit-api` and `pnpm dev:app-api` in separate terminals; the Vite
development server proxies `/deposit-api` and `/api` to those loopback services. The backend holds
the LayerSwap and relayer credentials. Copy `apps/web/.env.example` to an ignored
`apps/web/.env.local` only when connecting the live application backend.

## Private deposits

The browser discovers EVM wallets through EIP-6963 with an injected-provider fallback and switches
the selected wallet to Robinhood Chain. Quote review is live and pinned to:

```text
Robinhood USDG → Starknet USDC → STRK20
```

The browser does not call LayerSwap or AVNU directly and never receives either partner key. The
backend implements pinned creation, status, strict action parsing, and a narrow paymaster proxy.
Inbound and outbound mainnet creation have separate disabled-by-default gates. The privacy rail has
two explicit tabs: “Make private” for Robinhood USDG → S1 → STRK20, and “Fund launcher” for private
USDC → fresh S2 → fresh R2. It persists a signature-keyed AES-GCM operation journal and can re-fetch
strictly validated actions for pending LayerSwap orders after a reload. Local storage never receives
the signature, derived keys, viewing key, proof, witness, or clear-text S1/S2/R2 route record.

The outbound runner is wired to the STRK20 withdrawal and sponsored S2 transfer primitives but
requires an explicit public USDC fee cap. The inbound value-movement button stays locked until the
AVNU `invoke_and_apply_action` shield allowlist is frozen; quoting and encrypted route preparation
are available now.

## Application API

The browser calls the application backend, never the policy relayer directly:

- `POST /v1/launches/preview` validates metadata, verifies the owner/index against the deployed
  account factory, requires R2 funding, reads current Pons economics, and returns an expiring
  preview;
- the browser creates the nonzero salt and signs the exact reviewed execution with memory-held O2;
- `POST /v1/launches` accepts that signed request, binds it to the preview and idempotency key,
  independently revalidates the signature and Pons semantics, and forwards it to the internal
  policy relayer.

Both requests use same-origin credentials and a non-simple application header. The API implements
strict body limits, exact-origin enforcement when configured, durable previews/submission
idempotency, live Pons revalidation, and the internal authenticated-relayer call. A production edge
must still enforce its user session, rate/spend limits, artwork policy, and abuse controls. The API
must never request or receive the identity signature, derived signer/viewing keys, relayer API key,
proof witness, or raw private-note payload.

`VITE_MAINNET_LAUNCH_ENABLED=true` only unlocks the frontend control; it is not an authorization
boundary. The independent `LAUNCH_SUBMISSION_ENABLED` backend switch also defaults to `false`.
Keep both false until the funded transport proof, monitoring, abuse controls, and release gates are
deployed and reviewed.

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
locked. Start `pnpm dev:deposit-api` in a second terminal; the Vite development server proxies
`/deposit-api` to that backend. The backend holds the LayerSwap partner key and makes authenticated
V2 requests. Copy `.env.example` to an ignored `.env.local` only when connecting a deployed
application backend.

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

The browser calls an authenticated application backend, never the policy relayer directly:

- `POST /v1/launches/preview` validates metadata, reads current Pons economics, derives the fresh
  execution account, and returns an expiring preview;
- `POST /v1/launches` accepts the reviewed draft, preview ID, and idempotency key, then queues the
  launch through the user-owned execution account and internal policy relayer.

Both requests use same-origin credentials. The backend must enforce the user session, CSRF and
rate-limit policy, revalidate live Pons state, validate or proxy artwork, persist an operation
journal, and call the internal authenticated relayer. It must never request or receive the identity
signature, derived signer/viewing keys, relayer API key, proof witness, or raw private-note payload.

`VITE_MAINNET_LAUNCH_ENABLED=true` only unlocks the frontend control; it is not an authorization
boundary. Keep it `false` until the application API, operation journal, transport route, monitoring,
and release gates are deployed and reviewed.

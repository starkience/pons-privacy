# Pons Privacy web

Walletless, frontend-first launch flow for Pons V2 on Robinhood Chain.

## Local development

```sh
pnpm dev:web
```

The default `demo` mode returns a local preview and keeps the mainnet confirmation button locked.
Copy `.env.example` to an ignored `.env.local` only when connecting a deployed application backend.

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

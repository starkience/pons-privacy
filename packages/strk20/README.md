# @pons-privacy/strk20

Node 24 service module for the project-held STRK20 mainnet account. It owns the Starknet signer and
viewing key, discovers private notes through the pinned discovery service, requests proofs through
the pinned prover, and submits withdrawals to public Starknet recipients such as validated bridge
deposit addresses.

This is a custodial integration. Users do not need Ready/Xverse or a Starknet confirmation, but the
service can spend and inspect the project-held account's notes. Put the account private key, viewing
key, and Alchemy RPC URL in a production secret manager. Never expose them through `VITE_*`, browser
bundles, logs, analytics, crash reports, or committed environment files.

The module pins `PRIVACY-0.14.3-RC.4`, the supplied mainnet pool/class hash, and the current OHTTP
key config for both provider services. A changed chain, pool class, service health state, discovery
lag, or OHTTP key fails preflight closed.

```sh
# Configure a trusted user-level npm credential or CI secret with read:packages.
pnpm build
STARKNET_RPC_URL='https://...redacted...' pnpm preflight:strk20
```

Withdrawals are serialized per process, select only notes mature at the proof base, preserve change
as a private note, and require the caller to opt into a `USER_LINKAGE` warning before submission.
Run a single service replica until a durable operation queue and distributed account-nonce lock are
implemented.

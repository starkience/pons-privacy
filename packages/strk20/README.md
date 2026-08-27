# @pons-privacy/strk20

User-controlled STRK20 mainnet integration. A fixed, non-transaction EVM signature derives each
user's Starknet signer, viewing key, root-linked account S1, and fresh per-operation transport
accounts S2 in browser memory. No Ready/Xverse wallet is required and the project does not store a
shared signer or viewing key.

The module pins `PRIVACY-0.14.3-RC.4`, the supplied mainnet pool/class hash, and OHTTP key config. It
discovers mature USDC notes, requests a proof from the hosted prover, and submits the withdrawal
through AVNU's private paymaster. A hard guard rejects S1 as the outbound recipient. S2 is
atomically deployed and executes only the strictly parsed LayerSwap USDC transfer through SNIP-29
sponsored submission; there is no direct `account.execute` fallback.

```sh
pnpm build
STARKNET_RPC_URL='https://...redacted...' pnpm preflight:strk20
```

Mainnet execution remains disabled until the OZ account class hash is independently verified, the
AVNU pool/paymaster configuration is confirmed, a funded minimum-value round trip is reconciled,
and the derivation/paymaster/transport path is audited.

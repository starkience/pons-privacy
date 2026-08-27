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

The pool preflight currently fails closed: on 2026-08-27 the live class hash was
`0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d`, while the supplied pin is
StarkWare's V1 mainnet class
`0x030b8c540cf04d8ef0f4db2a9098d9cc0e35e83af1cb3325f5a4f40144b4b30b`. Do not replace the pin or
enable funded execution until StarkWare supplies the matching live deployment manifest.

```sh
pnpm build
STARKNET_RPC_URL='https://...redacted...' pnpm preflight:strk20
```

The compatible OpenZeppelin 3.x Stark-curve SRC9 account class is verified as declared on mainnet at
`0x01d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381`. Mainnet execution remains
disabled until the AVNU pool-fee cap and invoke-and-apply-action configuration are confirmed, a
funded minimum-value round trip is reconciled, and the derivation/paymaster/transport path is
audited.

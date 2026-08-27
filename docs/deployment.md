# Deployment

## Current surfaces

| Surface                     | Network                         | Status                                    |
| --------------------------- | ------------------------------- | ----------------------------------------- |
| Pons V2 and USDG            | Robinhood mainnet, chain `4663` | existing external deployments             |
| `PonsPrivacyAccountFactory` | Robinhood mainnet               | deployed                                  |
| Pons policy relayer         | offchain                        | not deployed                              |
| Web/application backend     | offchain                        | local prototype                           |
| STRK20 privacy pool         | Starknet mainnet                | external; live class mismatch blocks use  |
| Hosted prover/discovery     | Starknet mainnet                | existing external services                |
| User S1/S2 accounts         | Starknet mainnet                | counterfactual; deploy per user/operation |
| Cairo transport helper      | Starknet                        | not required or deployed                  |

Robinhood testnet is not Starknet Sepolia. The real LayerSwap route exists on mainnet, so Sepolia
cannot prove the end-to-end transport.

## Existing Robinhood deployment

- factory: `0x2f04549436Aeb3693E849E6C8121CA901edF7Ce4`;
- transaction: `0x3beb8f6b6c52c21f9a14cef64391b7f21e2c8eb1fcb55f5b1a39f9c02dee0282`;
- block: `47293691`; and
- runtime code hash: `0x7f8a4214e70963f328cad322e81053af12f8965cdbeeb73dee7971bca8a116ec`.

Pons and USDG are used as deployed; this repository does not redeploy them. The account factory
deploys fresh user-owned R2 account instances counterfactually on first execution.

## Configuration

Server-only secrets:

- `LAYERSWAP_API_KEY`;
- `AVNU_PAYMASTER_API_KEY`;
- Starknet/RPC provider credential inside `STARKNET_RPC_URL`; and
- policy-relayer key and credential when that service is deployed.

Required public configuration includes the verified mainnet OpenZeppelin account class hash in
`OZ_ACCOUNT_CLASS_HASH_MAINNET` and `VITE_OZ_ACCOUNT_CLASS_HASH_MAINNET`:

```text
0x01d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381
```

This is OpenZeppelin Contracts for Cairo 3.x `AccountUpgradeable`: Stark-curve signatures, one
felt `public_key` constructor value, counterfactual deployment, and SRC9 outside execution. Its
class definition was independently retrieved from Starknet mainnet on 2026-08-27. The similarly
named `EthAccountUpgradeable` uses secp256k1 coordinates and is not compatible with this
derivation.

Run the pinned STRK20 preflight before a funded test:

```sh
pnpm build
STARKNET_RPC_URL='https://...redacted...' pnpm preflight:strk20
```

It verifies SN_MAIN, RPC head/spec, pool class, prover/discovery health, lag, and OHTTP pins.

### Current STRK20 activation blocker

The preflight intentionally fails as of 2026-08-27:

- configured pool: `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`;
- supplied/pinned class: `0x030b8c540cf04d8ef0f4db2a9098d9cc0e35e83af1cb3325f5a4f40144b4b30b`;
- live class returned independently by Starknet mainnet:
  `0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d`.

StarkWare's official `CONTRACT_V1_DEPLOYED_MAINNET_2026-04-20` tag identifies the supplied hash as
the V1 privacy pool. Its `CONTRACT_V2_DEPLOYED_MAINNET_2026-07-08` tag publishes yet another pool
class hash, `0x052107fadffab71bdcbb6b2ccb68ba3e1b5558d94036538053e159d3076ad633`.
The live value must not be copied into the manifest without an authoritative compatibility set for
the SDK, prover, discovery service, OHTTP key, and deployed pool. All funded STRK20 execution gates
remain false until that set is confirmed and the preflight passes unchanged.

## Local services

```sh
pnpm dev:deposit-api
pnpm dev:web
```

The LayerSwap server binds to loopback by default. Production must use TLS, authentication, and
rate-limits. The browser operation journal is encrypted under the deterministic wallet signature;
production still needs server-side reconciliation and monitoring. The AVNU proxy allowlists only
the four paymaster methods and must never log request/response bodies.

## Kill switches

Keep these false until the funded round-trip gate passes:

```text
LAYERSWAP_SWAP_CREATION_ENABLED=false
LAYERSWAP_OUTBOUND_SWAP_CREATION_ENABLED=false
VITE_MAINNET_PRIVACY_EXECUTION_ENABLED=false
VITE_MAINNET_LAUNCH_ENABLED=false
BROADCAST=false
```

Frontend flags are presentation gates, not authorization boundaries; the backend flags and policy
relayer remain authoritative.

## Mainnet release gate

1. freeze the EVM signature message/derivation fixture and verify the OZ class hash;
2. prove browser/server logs never contain derived secrets or private payloads;
3. execute and reconcile a minimum inbound R1→S1→STRK20 deposit;
4. let notes mature/rest, then execute a private S1→S2 withdrawal via AVNU;
5. execute the exact S2→LayerSwap→R2 funding action and refund test;
6. verify factory/SDK predict the same R2, then launch/buy/sell on a controlled position;
7. return and re-shield through fresh accounts; and
8. complete independent audits and incident/refund runbooks.

No real token should be launched from the terminal. The production launch is a user-reviewed,
frontend-driven flow after the privacy route and application backend are deployed.

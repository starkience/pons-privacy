# Deployment

## Current surfaces

| Surface                     | Network                         | Status                                    |
| --------------------------- | ------------------------------- | ----------------------------------------- |
| Pons V2 and USDG            | Robinhood mainnet, chain `4663` | existing external deployments             |
| `PonsPrivacyAccountFactory` | Robinhood mainnet               | deployed                                  |
| Pons policy relayer         | offchain                        | not deployed                              |
| Web/application backend     | offchain                        | local prototype                           |
| STRK20 RC.4 pool            | Starknet mainnet                | existing external deployment              |
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
`OZ_ACCOUNT_CLASS_HASH_MAINNET` and `VITE_OZ_ACCOUNT_CLASS_HASH_MAINNET`. The hash must identify a
declared mainnet class compatible with constructor calldata `[publicKey]`, salt `publicKey`, and
Cairo version 1.

Run the pinned STRK20 preflight before a funded test:

```sh
pnpm build
STARKNET_RPC_URL='https://...redacted...' pnpm preflight:strk20
```

It verifies SN_MAIN, RPC head/spec, pool class, prover/discovery health, lag, and OHTTP pins.

## Local services

```sh
pnpm dev:deposit-api
pnpm dev:web
```

The LayerSwap server binds to loopback by default. Production must use TLS, authentication,
rate-limits, and an operation journal. The AVNU proxy allowlists only the four paymaster methods and
must never log request/response bodies.

## Kill switches

Keep these false until the funded round-trip gate passes:

```text
LAYERSWAP_SWAP_CREATION_ENABLED=false
LAYERSWAP_OUTBOUND_SWAP_CREATION_ENABLED=false
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

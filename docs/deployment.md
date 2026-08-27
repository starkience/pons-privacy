# Deployment

## Current surfaces

| Surface                     | Network                         | Status                                    |
| --------------------------- | ------------------------------- | ----------------------------------------- |
| Pons V2 and USDG            | Robinhood mainnet, chain `4663` | existing external deployments             |
| `PonsPrivacyAccountFactory` | Robinhood mainnet               | deployed                                  |
| Pons policy relayer         | offchain                        | not deployed                              |
| Web/application backend     | offchain                        | local prototype                           |
| STRK20 privacy pool         | Starknet mainnet                | V2 compatibility preflight verified       |
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
pnpm preflight:strk20
```

It verifies SN_MAIN, the live V2 pool invariants, real pinned-OHTTP prover/discovery traffic,
AVNU's atomic approve/private-deposit build, sponsored counterfactual S1 deployment, and the
private fee under the configured USDC ceiling. `STRK20_PAYMASTER_PROBE_ACCOUNT` must name any
deployed mainnet SNIP-9 account; it is used only for the build-only atomic-deposit check.

### STRK20 compatibility resolution

The configured pool is an upgradeable proxy. Starknet mainnet history shows the complete transition:

- configured pool: `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`;
- V1 class through block `11632885`:
  `0x030b8c540cf04d8ef0f4db2a9098d9cc0e35e83af1cb3325f5a4f40144b4b30b`;
- upgrade block `11632886`, transaction
  `0x4be26fa7600175c400d0a552ef5b21d46f1e103790e1580ce7de1563342ad36`;
- current V2 class:
  `0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d`; and
- pool views: version `2.0`, proof validity `450`, and the pinned live screener key.

The transaction registers, adds, and replaces the implementation. The new ABI and pool-reported
version match StarkWare's screening-capable V2 contract surface. SDK RC.4 is after the screening-only
RC.3 change and uses the builder API exercised here. The live preflight additionally proves both
OHTTP pins by making encrypted requests: prover spec `0.10.3-rc.2` and discovery lag below 120
seconds. AVNU accepts the same pool and USDC token in `sponsored_private` mode, the guarded
`invoke_and_apply_action` deposit shape, and sponsored S1 deployment; on 2026-08-27 its live atomic
deposit fee was `188251` base units (0.188251 USDC), below the configured 0.50 USDC ceiling.

This resolves the compatibility, inbound-runner, and AVNU-support blockers. A minimum-value shield,
private withdrawal, LayerSwap delivery/refund, and re-shield must still be reconciled before real
launches.

## Local services

```sh
pnpm dev:deposit-api
pnpm dev:app-api
pnpm dev:web
```

The LayerSwap and launch application servers bind to loopback by default. The deposit backend also
proxies only allowlisted read-only Starknet JSON-RPC methods and rejects transaction-submission
methods, keeping the provider credential server-side. The browser operation
journal is encrypted under the deterministic wallet signature, while backend LayerSwap and launch
idempotency records are stored atomically under `.data/` by default. Those file stores are
single-instance only. Production must use TLS, authenticated user sessions, rate/spend limits,
transactional shared storage, and provider/onchain reconciliation. The AVNU proxy allowlists only
the four paymaster methods and must never log request/response bodies.

## Kill switches

Keep these false until the funded round-trip gate passes:

```text
LAYERSWAP_SWAP_CREATION_ENABLED=false
LAYERSWAP_OUTBOUND_SWAP_CREATION_ENABLED=false
LAUNCH_SUBMISSION_ENABLED=false
TRADE_SUBMISSION_ENABLED=false
VITE_MAINNET_PRIVACY_EXECUTION_ENABLED=false
VITE_MAINNET_LAUNCH_ENABLED=false
VITE_MAINNET_TRADE_ENABLED=false
BROADCAST=false
```

Frontend flags are presentation gates, not authorization boundaries; the backend flags and policy
relayer remain authoritative.

For the controlled local minimum-value test only, the two LayerSwap switches,
`VITE_MAINNET_PRIVACY_EXECUTION_ENABLED`, `TRADE_SUBMISSION_ENABLED`, and
`VITE_MAINNET_TRADE_ENABLED` may be enabled while launch stays locked. The user still starts every
value-moving operation in the frontend; no token or trade should be submitted from the terminal.

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

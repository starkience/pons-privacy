# STRK20 mainnet compatibility evidence

Verified 2026-08-27 without submitting a transaction.

## Pool upgrade

The configured address is an upgradeable proxy, so its original deployment class is not the
current implementation pin.

| Evidence              | Value                                                                |
| --------------------- | -------------------------------------------------------------------- |
| Pool                  | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| Last V1 block         | `11632885`                                                           |
| Upgrade block         | `11632886`                                                           |
| Upgrade transaction   | `0x4be26fa7600175c400d0a552ef5b21d46f1e103790e1580ce7de1563342ad36`  |
| Current class         | `0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d`  |
| Pool-reported version | `2.0`                                                                |
| Proof-validity window | `450` blocks                                                         |
| Screener key          | `0x501cc452e5a4370e2f0879c9a863b3efc915005817487460b23a8d6ef88fdb2`  |

The upgrade transaction calls `register_upgrade_governor`, `add_new_implementation`, and
`replace_to`; its events record the implementation addition and replacement. The current class
ABI exposes the V2 screening surface used by RC.3 and later SDK releases, including
`get_screener_public_key` and screened `apply_actions`. The pool's own `get_version` view returns
`2.0`.

Official upstream references:

- [V2 mainnet contract tag](https://github.com/starkware-libs/starknet-privacy/tree/CONTRACT_V2_DEPLOYED_MAINNET_2026-07-08)
- [Privacy SDK RC.4 release](https://github.com/starkware-libs/starknet-privacy/releases/tag/PRIVACY-0.14.3-RC.4)
- [Onchain upgrade transaction](https://voyager.online/tx/0x4be26fa7600175c400d0a552ef5b21d46f1e103790e1580ce7de1563342ad36)

## Service set

The preflight does not infer compatibility from HTTP health endpoints alone. It downloads both
live OHTTP configurations, compares their bytes and SHA-256 digest with the manifest, then uses the
pinned configuration to make real encrypted requests.

| Invariant                   | Verified value                                                     |
| --------------------------- | ------------------------------------------------------------------ |
| SDK                         | `0.14.3-rc.4`                                                      |
| Prover spec over OHTTP      | `0.10.3-rc.2`                                                      |
| Discovery health over OHTTP | `OK`, less than 120 seconds behind                                 |
| OHTTP config SHA-256        | `96986179ea23a05f65916ca667ef3c4875a6d49c80c062c505698412e4743379` |
| AVNU mode                   | `sponsored_private`                                                |
| AVNU pool fee token         | native Starknet USDC                                               |
| Application fee ceiling     | `500000` base units (0.50 USDC)                                    |

RC.4 is retained because it post-dates the SDK's screening-only pool transition and the application
uses the proof builder directly. RC.5's simple-withdrawal surplus fix and shadow-account naming
change do not affect this builder-based S1→S2 path.

## Repeatable gate

With server credentials in `.env`:

```sh
pnpm preflight:strk20
```

The command fails on class/version/screener drift, proof-window drift, either OHTTP pin changing,
an encrypted service request failing, discovery lag over 120 seconds, AVNU dropping private-pool
support, a non-USDC fee action, or the live fee exceeding the configured ceiling.

This evidence resolves compatibility, not production readiness. All mainnet write switches remain
false until a minimum-value shield → private withdrawal → LayerSwap delivery/refund → re-shield
round trip is reconciled and the route receives independent review.

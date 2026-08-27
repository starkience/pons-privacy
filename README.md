# Pons Privacy

An STRK20 sanitization layer for Pons on Robinhood Chain. Users withdraw USDC from a private
STRK20 balance, route it into USDG at a fresh counterfactual Robinhood account, and launch or trade
through the existing Pons contracts. Pons remains unchanged and sees the derived execution account
as creator and trader rather than the user's connected/root wallet.

```text
STRK20 private USDC
  → fresh user-derived Starknet transport account (S2)
  → validated USDC/USDG transport
  → fresh PonsPrivacyAccount on Robinhood
  → Pons launch / buy / sell
  → validated USDG/USDC return
  → fresh Starknet recovery account
  → new STRK20 note
```

## Privacy boundary

This design provides root-wallet unlinkability, not confidential Robinhood execution.

- Hidden inside STRK20: note ownership, internal sender/receiver, balances, and note-to-note
  transfers.
- Public on Robinhood: the execution account, Pons token/curve, calldata, amounts, prices, balances,
  approvals, metadata, and timing.
- Visible to the routing provider: source and destination networks, assets, addresses, amounts,
  transactions, order ID, and timing.

Fresh accounts and amount/timing discipline reduce public correlation. They do not prevent the
transport operator from linking an order's two edges.

## Status

Phase 1 is implemented:

- Robinhood/Pons deployment manifest;
- deterministic non-upgradeable execution account and factory;
- exact Pons launch, pre-graduation buy, and sell adapter;
- live-state economics, phase, pair, curve, recipient, approval, and slippage validation;
- Pons-only relayer policy; and
- Robinhood-mainnet fork proof: counterfactual deploy → Pons USDG launch → buy → sell.

The STRK20 mainnet client is implemented against Privacy SDK `0.14.3-rc.4` with user-controlled,
memory-only keys. One non-transaction signature from the connected Robinhood EVM wallet derives
the user's root-linked Starknet account (S1), viewing key, fresh per-operation Starknet transport
accounts (S2), and fresh Robinhood execution owners (O2). No Ready/Xverse wallet or Starknet prompt
is required, and the project does not receive the signature or derived private/viewing keys. The
deployed Robinhood factory resolves each owner's counterfactual `PonsPrivacyAccount` (R2);
LayerSwap funds R2 directly, never O2.

Mainnet STRK20 execution is currently fail-closed. On 2026-08-27 the configured pool address
reported class hash `0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d`,
not the supplied V1/RC pin
`0x030b8c540cf04d8ef0f4db2a9098d9cc0e35e83af1cb3325f5a4f40144b4b30b`. StarkWare's public
repository identifies the supplied hash as its 2026-04-20 V1 mainnet deployment, while its
2026-07-08 V2 tag documents a different class again. Do not enable funded execution until
StarkWare confirms the live pool, SDK, prover, and discovery compatibility set.

The outbound invariant is enforced in code: S1 cannot be the public bridge source. The hosted
prover builds a private withdrawal to S2, AVNU's private paymaster submits the proof, and S2 then
executes LayerSwap's exact one-call USDC action through the standard paymaster. LayerSwap refunds
to S2 and delivers USDG to fresh Robinhood account R2. The provider can still correlate the order's
amount, timing, and two public edges.

The launch frontend now includes injected EVM wallet discovery, Robinhood network switching, live
quotes in both directions, local route derivation, strict LayerSwap action execution, and separate
“Make private” and “Fund launcher” controls. A signature-derived AES-GCM journal persists only
encrypted operation state, so interrupted S2/R2 routes can be recovered without storing keys,
proofs, or route addresses in clear text. LayerSwap creation is also reserved durably by operation
UUID before the provider call and recovered by that provider reference after retries or restarts.

After R2 funding completes, the browser builds and signs the exact Pons launch with its memory-held
O2 key. The application backend independently checks the funded factory-derived R2, reviewed
metadata, live Pons economics, signature, nonce policy, and idempotency record before forwarding to
the internal Pons relayer. It never receives the identity signature, O2 private key, viewing key,
proof, or partner credentials. Mainnet deposit, outbound funding, and launch submission remain
disabled by separate kill switches. No token has been launched from this repository.

LayerSwap is the selected transport. The backend adapter pins both USDG/USDC directions, protects
the partner credential, and strictly parses limits, quotes, swap creation, status, transactions,
and deposit actions. Mainnet creation and transfer signing remain locked until bidirectional
small-value tests prove contract senders, arbitrary recipients, fees, expiry, refunds,
interruption recovery, and exact delivery.

## Repository

```text
apps/web/            EVM wallet, private-deposit quote, launch form, and locked mainnet review
evm/                 PonsPrivacyAccount, factory, deployment script, Foundry tests
packages/sdk/        Robinhood config, Pons adapter, execution signing, transport types
packages/relayer/    strict Pons semantic relayer and HTTP service
packages/strk20/     user-controlled proving, private paymaster, S2 execution, and preflight
docs/                architecture, privacy, transport, deployment, phased plan
```

## Develop

Requirements: Node 24+, pnpm 10+, Foundry.

The RC.4 Privacy SDK is published through GitHub Packages. Configure a trusted npm credential with
`read:packages`; never commit it to this repository.

```sh
pnpm install
pnpm dev:deposit-api
pnpm dev:app-api
pnpm dev:web
pnpm test
pnpm typecheck
pnpm build
pnpm test:fork
```

The ordinary Foundry suite is offline. `pnpm test:fork` reads live Pons state through a local
Robinhood mainnet fork; its state changes are ephemeral and do not submit mainnet transactions.
The web app starts in demo mode. Its review flow cannot submit a mainnet launch unless both a live
application backend and the explicit build-time mainnet switch are configured.

## Deployments

Pons V2 and USDG already exist on Robinhood mainnet. The project execution-account factory is
deployed at `0x2f04549436Aeb3693E849E6C8121CA901edF7Ce4`; account instances deploy
counterfactually on first execution. The policy relayer is not deployed yet. See
[deployment](docs/deployment.md).

Prototype, unaudited. Do not deploy with real value before independent review of the account,
relayer, derivation contract, STRK20 integration, paymaster boundary, and transport adapter.

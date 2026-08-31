# Pons Privacy

> [!WARNING]
> **Superseded implementation.** This repository is the earlier LayerSwap prototype and is not the
> current PrivatePons source of truth. The current implementation lives in the
> `crosschain-privatepump` project and uses Relay for Robinhood Chain ↔ Arbitrum routing plus Circle
> CCTP V2 for Arbitrum ↔ Starknet. Do not use this checkout to describe, configure, or deploy the
> current product.

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

The former STRK20 class-mismatch blocker is resolved. The configured proxy was upgraded at block
`11632886` by transaction `0x4be26fa7600175c400d0a552ef5b21d46f1e103790e1580ce7de1563342ad36`
from the supplied V1 class to its current screening-capable V2 implementation. The strict mainnet
preflight now checks the live class, pool-reported version `2.0`, screener key, 450-block proof
window, pinned OHTTP keys, real encrypted prover/discovery calls, and AVNU `sponsored_private`
support. Mainnet execution remains fail-closed only until a minimum-value funded round trip and
independent review pass; compatibility is no longer the blocker.

The inbound runner is also complete. After LayerSwap reports its actual Starknet output amount,
the browser reconciles that output transaction, deploys S1 through sponsored SNIP-29 when needed,
waits for a settled proving base, and asks the hosted prover for a screened deposit proof. AVNU
then relays one guarded `invoke_and_apply_action`: S1 signs only the exact USDC approval while the
proof atomically registers the immutable viewing key, opens the channel, deposits USDC, and pays
the capped private fee. Deployment, relay-start, and deposit hashes are written to the encrypted
journal before later waits, preventing blind duplicate submissions after reconnects.

The outbound invariant is enforced in code: S1 cannot be the public bridge source. The hosted
prover builds a private withdrawal to S2, AVNU's private paymaster submits the proof, and S2 then
executes LayerSwap's exact one-call USDC action through the standard paymaster. LayerSwap refunds
to S2 and delivers USDG to fresh Robinhood account R2. The provider can still correlate the order's
amount, timing, and two public edges.

The frontend now includes injected EVM wallet discovery, Robinhood network switching, live quotes
in both directions, local route derivation, strict LayerSwap action execution, private buy/sell
controls, and separate “Make private” and “Fund launcher” controls. A signature-derived AES-GCM
journal persists only encrypted operation state, so interrupted S2/R2/S3 routes can be recovered
without storing keys, proofs, or route addresses in clear text. LayerSwap creation is also reserved
durably by operation UUID before the provider call and recovered by that provider reference after
retries or restarts.

After R2 funding completes, the browser builds and signs the exact Pons launch with its memory-held
O2 key. The application backend independently checks the funded factory-derived R2, reviewed
metadata, live Pons economics, signature, nonce policy, and idempotency record before forwarding to
the internal Pons relayer. It never receives the identity signature, O2 private key, viewing key,
proof, or partner credentials. Mainnet deposit, outbound funding, and launch submission remain
disabled by separate production kill switches. The local privacy rails can be enabled for the
controlled minimum-value test without enabling launch broadcast. No token has been launched from
this repository.

Private trading is implemented with the same browser-held O2 authorization. A buy spends the exact
USDG delivered to fresh R2 and leaves the Pons position there. A sell spends the full selected R2
position, returns its resulting USDG through a server-validated, O2-signed LayerSwap action to fresh
S3, and shields LayerSwap's exact USDC output under an S3-specific viewing key. Trade previews,
minimum outputs, factory owner/index, Pons curve state, signatures, relay calls, and retry keys are
independently checked. The Pons transaction remains public from R2; “private” means the connected
wallet is absent from the Pons and outbound-return graph.

LayerSwap is the selected transport. The backend adapter pins both USDG/USDC directions, protects
the partner credential, and strictly parses limits, quotes, swap creation, status, transactions,
and deposit actions. A read-only same-origin Starknet proxy also keeps the Alchemy credential out
of the browser bundle. The next gate is a user-confirmed minimum-value round trip proving contract
senders, arbitrary recipients, fees, expiry, refunds, interruption recovery, and exact delivery.

## Repository

```text
apps/web/            EVM wallet, private deposit/funding, private trading, and launch form
evm/                 PonsPrivacyAccount, factory, deployment script, Foundry tests
packages/sdk/        Robinhood config, Pons adapter, execution signing, transport types
packages/relayer/    strict Pons/LayerSwap semantic relayer and application HTTP services
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

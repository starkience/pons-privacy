# Pons Privacy

An STRK20 sanitization layer for Pons on Robinhood Chain. Users withdraw USDC from a private
STRK20 balance, route it into USDG at a fresh counterfactual Robinhood account, and launch or trade
through the existing Pons contracts. Pons remains unchanged and sees the derived execution account
as creator and trader rather than the user's connected/root wallet.

```text
STRK20 private USDC
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

The project-held STRK20 mainnet client is also implemented against Privacy SDK
`0.14.3-rc.4`. The backend holds the Starknet signer and viewing key, discovers mature USDC notes,
requests proofs from the pinned hosted prover, and submits withdrawals. End users therefore do not
need a Starknet wallet or Starknet confirmation prompts. This is custodial: the project can inspect
and spend those notes.

The launch frontend now includes injected EVM wallet discovery, Robinhood network switching, a
private-balance surface, and live LayerSwap quote review for Robinhood USDG → Starknet USDC. It
never receives project custody keys, a LayerSwap partner key, or the relayer credential. Mainnet
deposit execution and launch submission remain disabled. No token has been launched from this
repository.

LayerSwap is the selected transport. A strict quote client pins both USDG/USDC directions and
rejects network, asset, amount, and minimum-output drift. Order creation and deposit-action signing
remain locked until bidirectional small-value tests prove contract senders, arbitrary recipients,
fees, expiry, refunds, interruption recovery, and exact delivery.

## Repository

```text
apps/web/            EVM wallet, private-deposit quote, launch form, and locked mainnet review
evm/                 PonsPrivacyAccount, factory, deployment script, Foundry tests
packages/sdk/        Robinhood config, Pons adapter, execution signing, transport types
packages/relayer/    strict Pons semantic relayer and HTTP service
packages/strk20/     project-held STRK20 discovery, proving, withdrawal, and preflight
docs/                architecture, privacy, transport, deployment, phased plan
```

## Develop

Requirements: Node 24+, pnpm 10+, Foundry.

The RC.4 Privacy SDK is published through GitHub Packages. Configure a trusted npm credential with
`read:packages`; never commit it to this repository.

```sh
pnpm install
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
relayer, custodial key handling, STRK20 integration, and transport adapter.

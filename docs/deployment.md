# Deployment

## Networks

| Surface                      | Network                          | Status                               |
| ---------------------------- | -------------------------------- | ------------------------------------ |
| Pons V2                      | Robinhood mainnet, chain `4663`  | existing external deployment         |
| USDG                         | Robinhood mainnet                | existing Pons-approved asset         |
| Pons Privacy account factory | Robinhood mainnet                | deployed                             |
| Pons relayer                 | offchain, Robinhood RPC          | not deployed                         |
| Pons V2 test stack           | Robinhood testnet, chain `46630` | no public addresses published        |
| STRK20 privacy pool          | Starknet mainnet                 | existing external RC.4 deployment    |
| Project-held STRK20 service  | offchain, Starknet mainnet RPC   | implemented, not deployed            |
| STRK20 transport helper      | Starknet                         | optional future hardening, no deploy |

Robinhood testnet is a distinct chain and is not Sepolia. Starknet Sepolia may be used later for
STRK20-side helper testing, but it cannot prove a provider route that exists only on mainnet.

## Run the project-held STRK20 service

`packages/strk20` pins the supplied RC.4 pool, prover, discovery service, and OHTTP key. Put the
Starknet account address, signer, viewing key, HTTPS RPC URL, and validated Starknet USDC address in
a secret manager. The Alchemy API key belongs inside `STARKNET_RPC_URL`; it must not be committed or
served to the browser.

Run `pnpm preflight:strk20` before enabling withdrawals. It verifies `SN_MAIN`, RPC spec/head, the
pool class hash, provider health, discovery lag, and both OHTTP keys. Run one withdrawal worker until
the operation journal and distributed nonce lock are implemented. See
[STRK20 custody](strk20-custody.md).

## Deploy the account factory

Mainnet deployment:

- factory: `0x2f04549436Aeb3693E849E6C8121CA901edF7Ce4`;
- transaction: `0x3beb8f6b6c52c21f9a14cef64391b7f21e2c8eb1fcb55f5b1a39f9c02dee0282`;
- block: `47293691`; and
- runtime code hash: `0x7f8a4214e70963f328cad322e81053af12f8965cdbeeb73dee7971bca8a116ec`.

The deployed runtime exactly matched the locally compiled Solidity `0.8.30` artifact. Full compiler
and receipt metadata is recorded in `deployments/robinhood-mainnet.json`.

For a future deterministic redeployment, use a dedicated encrypted Foundry keystore and fund it
with Robinhood ETH. Do not place a deployer key in an environment file.

```sh
forge script evm/script/Deploy.s.sol:Deploy \
  --root evm \
  --rpc-url https://rpc.mainnet.chain.robinhood.com \
  --account pons-privacy-deployer \
  --broadcast
```

Before any future broadcast, repeat `pnpm test:fork` and obtain independent account/relayer review.

## Run the relayer

Copy `.env.example` to an ignored `.env.local` and configure the deployed factory plus a dedicated
funded relayer key and a random `RELAYER_API_KEY` of at least 32 bytes. The service exposes
`GET /healthz` and authenticated `POST /v1/relay`. It binds to loopback by default; production
hosting must place it behind the authenticated application backend or a TLS reverse proxy.

```sh
pnpm build
set -a
. ./.env.local
set +a
pnpm --filter @pons-privacy/relayer start
```

The relayer is deliberately Pons-only. It has no environment switch for unrestricted targets.

## Controlled mainnet launch

The backend launch client reads live Pons eligibility, fee, config, USDG approval, and economics;
derives the counterfactual privacy account; prepares the owner-signed request; and defaults to a
non-broadcasting dry run. Keep `LAUNCH_OWNER_PRIVATE_KEY` and `RELAYER_API_KEY` in the server secret
store. This command is an operator diagnostic, not the user launch path, and must not be used to
launch a token while the frontend-first release gate is active. A dry run can be inspected without
broadcasting:

```sh
pnpm --filter @pons-privacy/relayer build
pnpm --filter @pons-privacy/relayer launch:mainnet
```

The production path is the authenticated application API described in `apps/web/README.md`. Keep
`BROADCAST` unset and `VITE_MAINNET_LAUNCH_ENABLED=false` until that API, its operation journal, and
the full end-to-end release gate below are deployed and reviewed. The operator client can decode
Pons's `TokenLaunched` event after a future, separately authorized broadcast.

## End-to-end release gate

1. authenticate the user and derive a fresh EVM execution owner without any Starknet wallet prompt;
2. confirm the SDK and deployed factory predict the same account;
3. deliver a small USDG amount through the validated transport path;
4. relay launch with exact live fee/economics and verify Pons attribution;
5. buy and sell while all assets remain at the execution account;
6. return USDG as USDC to a fresh Starknet recovery account;
7. open a new STRK20 note as a separate verified step; and
8. reconcile the custodial user ledger; and
9. audit logs/analytics for root identity, signature, key, witness, and exact private payload leaks.

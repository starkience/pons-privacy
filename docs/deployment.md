# Deployment

## Networks

| Surface                      | Network                          | Status                               |
| ---------------------------- | -------------------------------- | ------------------------------------ |
| Pons V2                      | Robinhood mainnet, chain `4663`  | existing external deployment         |
| USDG                         | Robinhood mainnet                | existing Pons-approved asset         |
| Pons Privacy account factory | Robinhood mainnet                | not deployed                         |
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

Use a dedicated encrypted Foundry keystore and fund it with Robinhood ETH. Do not place a deployer
key in an environment file.

```sh
forge script evm/script/Deploy.s.sol:Deploy \
  --root evm \
  --rpc-url https://rpc.mainnet.chain.robinhood.com \
  --account pons-privacy-deployer \
  --broadcast
```

Before broadcasting, repeat `pnpm test:fork`, obtain independent account/relayer review, and record
the factory address, transaction, block, compiler settings, runtime byte length, and runtime code
hash in a deployment manifest.

## Run the relayer

Copy `.env.example` to an ignored `.env.local` and configure the deployed factory plus a dedicated
funded relayer key. The service exposes `GET /healthz` and `POST /v1/relay`.

```sh
pnpm build
set -a
. ./.env.local
set +a
pnpm --filter @pons-privacy/relayer start
```

The relayer is deliberately Pons-only. It has no environment switch for unrestricted targets.

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

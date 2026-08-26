# Deployment

## Networks

| Surface                      | Network                          | Status                        |
| ---------------------------- | -------------------------------- | ----------------------------- |
| Pons V2                      | Robinhood mainnet, chain `4663`  | existing external deployment  |
| USDG                         | Robinhood mainnet                | existing Pons-approved asset  |
| Pons Privacy account factory | Robinhood mainnet                | not deployed                  |
| Pons relayer                 | offchain, Robinhood RPC          | not deployed                  |
| Pons V2 test stack           | Robinhood testnet, chain `46630` | no public addresses published |
| STRK20 transport helper      | Starknet                         | not implemented or deployed   |

Robinhood testnet is a distinct chain and is not Sepolia. Starknet Sepolia may be used later for
STRK20-side helper testing, but it cannot prove a provider route that exists only on mainnet.

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

1. derive a fresh official STRK20-backed execution owner without persisting key material;
2. confirm the SDK and deployed factory predict the same account;
3. deliver a small USDG amount through the validated transport path;
4. relay launch with exact live fee/economics and verify Pons attribution;
5. buy and sell while all assets remain at the execution account;
6. return USDG as USDC to a fresh Starknet recovery account;
7. open a new STRK20 note as a separate verified step; and
8. audit logs/analytics for root identity, signature, key, witness, and exact private payload leaks.

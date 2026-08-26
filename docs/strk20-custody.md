# Project-held STRK20 custody

## Runtime flow

```text
authenticated Pons intent
  → authorize and reserve balance in the project ledger
  → create and persist a validated transport order
  → discover USDC notes at a pinned mature Starknet block
  → construct the withdrawal and private change note
  → request a proof from the pinned hosted prover
  → submit through the project-held Starknet account
  → reconcile the Starknet receipt and transport delivery
```

The user never supplies a Starknet signer and never sees a Starknet confirmation. The backend owns
both the account signer and viewing key. The configured hosted prover computes the proof; the
backend constructs the request and submits the proved account transaction.

## Mainnet configuration

Public protocol pins live in `deployments/strk20-mainnet.json`. The following values are secrets or
route-specific deployment configuration and are intentionally absent:

- `STARKNET_RPC_URL`: HTTPS mainnet RPC URL containing the provider credential;
- `STRK20_ACCOUNT_ADDRESS`: deployed project-held Starknet account;
- `STRK20_ACCOUNT_PRIVATE_KEY`: signer stored in a secret manager or isolated signing service;
- `STRK20_VIEWING_KEY`: viewing key stored with signer-equivalent confidentiality; and
- `STRK20_USDC_ADDRESS`: exact Starknet USDC accepted by the validated production route.

Do not paste secrets into issue trackers, build logs, browser environment variables, or committed
`.env` files. Rotate any provider or signing credential disclosed through an uncontrolled channel.

## Release blockers

The SDK client alone is not a deployable custodial product. Before real funds:

1. deploy and fund a dedicated Starknet account with enough STRK for fees;
2. implement an authenticated, idempotent withdrawal API and double-entry user ledger;
3. persist an operation before proof construction and reconcile ambiguous submissions by hash/nonce;
4. validate and persist the bridge deposit action before allowing the USDC withdrawal;
5. use a durable queue plus distributed Starknet account-nonce lock, or run exactly one worker;
6. enforce per-user, per-order, and global amount/rate limits;
7. add signer isolation, rotation, backup, incident response, and access auditing; and
8. independently audit the custody, bridge, account, and relayer paths.

`Strk20Custodian` is intentionally an internal service primitive. It only spends the configured
USDC token, selects notes mature at the proof base, returns surplus privately to the same Starknet
account, and serializes submissions inside one process. It must not be exposed directly as a public
HTTP endpoint.

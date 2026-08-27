# @pons-privacy/sdk

Robinhood Chain configuration, deterministic execution-account signing, Pons V2 launch/curve
adapters, provider-neutral transport state types, and a strict LayerSwap V2 client. The client pins
Starknet USDC ↔ Robinhood USDG; parses limits, quotes, creation, status, transactions, and deposit
actions; and rejects route, address, token, amount, or contract drift. It does not execute wallet
deposit actions. This package does not implement STRK20 proofs, hold viewing keys, or treat a
routing provider as a privacy system.

`createHttpRelay` accepts an optional `apiKey` for authenticated backend-to-backend requests. Keep
that credential in a server secret store; never include it in a browser or public application bundle.

`preparePonsLaunchRelayRequest` is the browser-held launch boundary. It re-derives O2 locally,
verifies the deployed factory predicts R2, builds live economics-pinned Pons calldata, reads the R2
nonce, and returns only the signed relay request. Call it only with a memory-held privacy route;
never serialize that route or its O2/root/transport keys.

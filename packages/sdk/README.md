# @pons-privacy/sdk

Robinhood Chain configuration, deterministic execution-account signing, Pons V2 launch/curve
adapters, provider-neutral transport state types, and a strict LayerSwap quote client. The client
pins Starknet USDC ↔ Robinhood USDG and rejects route drift before returning bigint-denominated
quotes. It does not create or execute LayerSwap orders yet. This package does not implement STRK20
proofs, hold viewing keys, or treat a routing provider as a privacy system.

`createHttpRelay` accepts an optional `apiKey` for authenticated backend-to-backend requests. Keep
that credential in a server secret store; never include it in a browser or public application bundle.

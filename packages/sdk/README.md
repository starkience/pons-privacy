# @pons-privacy/sdk

Robinhood Chain configuration, deterministic execution-account signing, Pons V2 launch/curve
adapters, and provider-neutral transport state types. This package does not implement STRK20 proofs,
hold viewing keys, or treat a routing provider as a privacy system.

`createHttpRelay` accepts an optional `apiKey` for authenticated backend-to-backend requests. Keep
that credential in a server secret store; never include it in a browser or public application bundle.

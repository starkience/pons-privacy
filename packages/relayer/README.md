# @pons-privacy/relayer

Pons-only Robinhood relayer. Every call is decoded and checked against the current Pons factory,
factory-recorded curve/token relationship, USDG, execution-account recipient, live economics,
exact approvals, exact launch prefund, and bounded slippage before simulation and broadcast.

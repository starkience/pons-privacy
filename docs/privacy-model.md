# Privacy and sanitization model

“Sanitized” means Pons does not receive the connected/root wallet as caller, recipient, or creator.
It does not mean anonymous or confidential execution.

| Data                                                       | Visibility                           |
| ---------------------------------------------------------- | ------------------------------------ |
| STRK20 note ownership, private balance, internal transfers | hidden inside the pool               |
| Connected wallet R1 in Pons calldata                       | absent by construction               |
| S1 private/viewing keys and root signature                 | user-controlled, browser memory only |
| S1 deposit and S2 withdrawal amount/time                   | public Starknet edges                |
| S2→R2 order mapping                                        | visible to LayerSwap                 |
| R2, Pons token, curve, calls, prices, balances, metadata   | public Robinhood state               |
| Proof/discovery requests and network metadata              | visible to their service operators   |

OHTTP protects prover/discovery payload transport but does not make infrastructure unable to
correlate network metadata. STRK20 screening and selective disclosure remain protocol requirements.

## Correlation controls

- one S2 and R2 index per position or intentionally linkable activity cluster;
- never let S1 initiate the public outbound bridge;
- AVNU submission instead of root-wallet gas funding;
- amount bucketing and time separation where product economics allow;
- never transfer launch assets to R1; and
- never log the identity signature, derived keys, viewing key, witnesses, proofs, or exact private
  payloads.

These controls improve the public anonymity set. They do not hide an order from LayerSwap, prevent
amount/timing analysis, or protect against colluding infrastructure operators.

## Product copy

Use “STRK20-sanitized creator/trader identity” or “root-wallet unlinkability.” Do not say Pons
transactions are hidden, anonymous, or confidential. Disclose that edge amounts, assets, timing,
S2/R2, and all Pons execution are public, and that LayerSwap can link its order edges.

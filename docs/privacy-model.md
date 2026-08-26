# Privacy and sanitization model

“Sanitized” means that Pons does not receive the connected/root wallet as its caller, recipient, or
creator identity. It does not mean that execution is confidential or that every observer loses the
ability to correlate the user.

## Hidden and visible

| Data                                                     | Status                                | Reason                                              |
| -------------------------------------------------------- | ------------------------------------- | --------------------------------------------------- |
| STRK20 note owner, balance, internal sender/receiver     | Hidden inside pool                    | encrypted UTXO notes and STARK proofs               |
| Which private notes funded a position                    | Hidden from ordinary public observers | nullifiers do not expose the viewing key            |
| Connected/root wallet in Pons calldata                   | Absent by construction                | fresh derived execution account owns the position   |
| Robinhood execution account                              | Public                                | account, balances, and calls are onchain            |
| Pons token, curve, phase, metadata, amounts, prices      | Public                                | ordinary Pons execution                             |
| STRK20 deposit/withdrawal recipient, token, amount, time | Public edge                           | pool deposits and withdrawals are transparent edges |
| Provider source→destination mapping                      | Provider-visible                      | both legs belong to one routing order               |
| RPC/relayer request metadata                             | Operator-visible                      | normal service visibility                           |

STRK20 deposit screening remains mandatory. Its selective-disclosure mechanism can reveal one
user's history under the protocol's compliance process; a viewing key can read but cannot spend.

## Correlation controls

- one account index per position;
- fixed or bucketed funding amounts where product economics permit;
- delays between channel setup, withdrawal, transport, and trade;
- no root-wallet gas funding on Robinhood;
- relayer submission rather than connected-wallet submission;
- fresh Starknet recovery account per return; and
- no logs of identity signatures, derived keys, note witnesses, or full activity payloads.

These controls improve the public anonymity set. They do not hide order linkage from Layerswap,
Rhino.fi, their solvers, or infrastructure capable of correlating network traffic.

## Required product copy

Use “STRK20-sanitized creator/trader identity” or “root-wallet unlinkability.” Do not describe Pons
transactions as hidden, anonymous, or confidential. Always disclose that amounts, assets, timing,
and the execution account are public and the routing provider can link transport legs.

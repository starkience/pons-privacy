# Security

Pons Privacy is an unaudited prototype. Do not use it with valuable assets.

The execution account can make arbitrary calls authorized by its owner signature. Safety for
relayed operation comes from the Pons-only semantic policy; deploying an unrestricted relayer would
invalidate the threat model. Derived keys, identity signatures, viewing keys, note witnesses,
provider credentials, and relayer keys must never be logged or persisted in application storage.

Report suspected vulnerabilities privately to the repository owner. Include affected component,
reproduction steps, impact, and suggested mitigation without publishing exploitable details first.

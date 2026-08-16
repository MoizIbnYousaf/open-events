# Demo data

The default seed stays deliberately small. Rich demonstration data is an
explicit overlay so product tests that pin the base shape remain stable.

```sh
pnpm db:reset:showcase
```

This rebuilds local D1 from migrations, applies `seed.sql`, then
`seed-programme.sql`, then `seed-showcase.sql`. Repeating the command produces
the same ids and rows. The showcase contains 12 proposals, eight accepted and
published sessions over two days and rooms, two rejected decisions, two pending
decisions, two review rounds, one recorded recusal with reassignment, mixed
speaker readiness, a deliberate speaker-overlap conflict, and capture-only
message states.

All showcase identities use reserved `example.test` addresses. Captured fixture
messages store only a redacted marker and keyed fixture fingerprint. Their jobs
are capture-mode terminal rows with no payload, next-attempt time, provider id,
or delivery-budget reservation, so a drain cannot send them.

Acceptance is a resettable sandbox. With the exact acceptance target tuple and
reset secret configured, run:

```sh
pnpm db:reset:acceptance:showcase
```

The script first asks the acceptance-only reset endpoint to delete the isolated
event, then reapplies base, programme, and showcase layers to the acceptance D1.
The production reset route does not exist. A production overlay is never a
reset target and requires a D1 backup, bounded additive diff, and explicit
production-data authorization before the remote write.

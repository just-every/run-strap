# Member move-in integration contract

Owner instructions and the CSV format are in [Move members into Strap](MOVE-IN.md). This document covers the developer adapter and transport contract.

`importCommand(db, actor, name, input)` is exported by `src/strap/movein/index.ts`; actor is `{ id, email, role: string }`. The HTTP transport must authenticate a human session, protect request origin and reject machine/delegated credentials. The kit independently checks `oa_operators` for the matching ID/email, active status and owner role inside each transaction. Other human roles cannot import.

| Command | Input | Result |
| --- | --- | --- |
| `import.preview` | `{ csv }` | `{ format, fingerprint, counts, diagnostics, members, conflicts }` |
| `import.apply` | `{ csv, fingerprint }` | `{ job }` |
| `import.resume` | `{ jobId }` | `{ job }` |
| `import.undo` | `{ jobId }` | `{ job }` |
| `import.rollback` | `{ jobId }` | `{ job }` |
| `import.journal` | `{ jobId }` | `{ job, originals, batches, undo }` |

Job lists must filter `ik_jobs` by `destination='strap:members'`, `namespace='strap.mindbody.csv.v1'`, `mapping_version='mindbody-members-v1'` and the authenticated owner's `principal_id`. Detailed reads also enforce this binding. Render job/checkpoint states from the returned kit job; do not infer completion from an HTTP success.

Migration `0017_import_kit.sql` contains all Base D1 schema exports in initializer order and the native ownership table `st_import_people_revisions`. Product rows live in `st_people`; every import mutation increments `st_meta.version`. Native snapshots cover every person field, import revision, matching complete `st_records` rows and matching active/invited `oa_operators` rows. Both the observed set and dependency absence are fenced in the same transaction as reversal. No payroll identifier is used.

Source: Base import-kit and D1 transport at `c7cb0613120074c5ffca63f610533802afbda6bd`, copied without tests; member adapters follow the worked Lanyard move-in structure at `5316693371c149ffd3eb398a796ba66d83affa03` and add full dependency and invitation snapshots for Strap. Worker runtime requires `nodejs_compat`.

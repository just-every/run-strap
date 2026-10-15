# Move members into Strap

The first named format is **Mindbody member CSV v1**. This is a documented column mapping, not a verified adapter for a real vendor export. The fixture at `tests/fixtures/members.csv` contains synthetic examples only; it was not exported from Mindbody. Prepare and check your own file against the shape below.

Use UTF-8 CSV, optionally with a UTF-8 BOM, with exactly these columns in this order:

```csv
MemberId,FirstName,LastName,Email
synthetic-001,Alex,Example,alex.member@example.test
```

| CSV column | Strap field | Rules |
| --- | --- | --- |
| MemberId | Member ID | Stable, unique; 1–100 ASCII letters, digits, underscores or hyphens. Keep leading zeroes. |
| FirstName | First part of display name | Trimmed; joined with LastName by one space. |
| LastName | Last part of display name | Trimmed; at least one name part must be present. Combined name is at most 200 characters, with no control characters. |
| Email | Email | Required, trimmed, lowercased, at most 254 characters, unique within the file. |

The limit is 1–1000 member records and 1,000,000 UTF-8 bytes, including the header. Commas, doubled quotes and quoted line breaks follow CSV quoting rules; names cannot contain line breaks. Empty rows and extra or missing columns are errors. A trailing newline is accepted. Existing members are never overwritten or merged.

## Review and apply

Sign in as the owner, open Import, paste the file and preview it. Check the member names, counts, diagnostics and conflicts before applying. Apply requires the fingerprint from that exact preview. Any source-byte change, including whitespace or a line ending, requires another preview. Preview changes no member records.

Each apply or resume request processes at most ten records. Continue with Resume until the job is completed. Resume reads the retained plan and original CSV; it does not replace the source with a new file. The job belongs to the human owner identity that created it, and every transaction rechecks that this owner is still active.

Imports create inactive members only. They grant no access, send no invitation, add no credit and charge or bill nothing. Review and activate members through People, then invite them separately when appropriate. Records for erased identities cannot be imported again.

## Journal, undo and rollback

The private journal retains the original CSV, reviewed plan, batches, checkpoints and reversal dispositions. It contains personal data and must stay within the owner interface. Use Undo for a completed job and Rollback for an unfinished job, then Resume while a reversal is in progress.

Undo removes untouched imported members. It preserves native edits, activation, invitations, active access and dependent work such as bookings, attendance, credits and billing. Unknown record kinds containing the member ID are conservatively treated as dependent work. The journal explains retained members; an undone job can still have retained members. Undo and rollback retain the original CSV and audit journal and are not personal-data erasure.

## Integration contract

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

# Portable studio exit bundle

A native human owner downloads `GET /api/strap/exit.json` as `strap-exit.json`. The download rechecks the active native owner in the same database read transaction as the records. Members, instructors and agent credentials cannot export it. It performs no writes, collection or delivery. Keep the downloaded studio data private.

The response uses `Content-Type: application/json; charset=utf-8`, `Content-Disposition: attachment; filename="strap-exit.json"`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex, nofollow`.

## Format and exact values

The top level contains `manifest`, `tables` and `csv`. Manifest format `strap-exit`, version `1`, identifies this portable format. `manifest.schema` lists each included table's exact columns, primary key, row count, ordering and structured/binary columns. `manifest.relationships` documents joins; `recordKinds` counts all current record kinds. Exported IDs are the source IDs, never newly assigned IDs. Empty tables remain present with a CSV header.

`tables` contains arrays of row objects under their original table names. SQL NULL remains JSON null, integers remain numbers, and text remains text, including empty strings, quotes, commas, Unicode and embedded line breaks. JSON stored in `st_records.data`, `*_json` columns and plan chunk `body` remains its original text; parse it separately. A body chunk can be a fragment rather than an independently parseable JSON document. Unknown record kinds and fields are retained.

Each `csv` entry is a complete UTF-8 CSV string named `<table>.csv`. Headers are the exact plain column names in `manifest.schema`, in that order. Records use CRLF; every field is quoted and embedded quotes are doubled according to RFC 4180. **Data cells contain JSON values.** Use a CSV parser, then JSON-parse every data cell; do not JSON-parse the header. This distinguishes SQL null, empty text, numeric zero and the text `"null"` without sacrificing any original value. Do not auto-convert identifiers, dates or formula-looking strings in a spreadsheet. JSON remains the direct machine-readable representation.

Binary columns use null or `{ "encoding": "hex", "storageType": "blob" | "text", "hex": "…" }`. Decode the hex first. `storageType` records SQLite's original storage type: import original version 3 chunks store base64 as TEXT, whereas earlier formats store binary bytes. No bytes are interpreted as UTF-8 prematurely.

## Current studio schema and relationships

`st_people` holds members and instructors, including inactive and erased rows, with their stable `id`, `name`, nullable `email`, `role`, integer `active`, `version` and nullable `erased_at`. Erased rows remain redacted as stored. `st_meta.version` is the domain revision. `st_erasure_journal` retains identity hashes and erasure times; `st_import_people_revisions` links imported people to import revision tokens.

`st_notice_deliveries` holds one row per member per source (`closure`, `booking` for offers/promotions, or `booking_action` for a SCHED-014 action): the covered booking IDs (JSON), recipient, exact subject and text, and the recorded outcome (`accepted` by the provider with its message ID, `rejected`, `rate_limited`, `uncertain`, interrupted `queued`/`sending`, `not_configured`, `no_address` or `paused`). An accepted row is the provider's acceptance, not proof of mailbox delivery.

`st_records` holds `id`, `kind`, JSON text `data` and row `version`. Rows are ordered by stable primary key. Use explicit document versions, timestamps and pack-event revisions for chronology; physical database insertion order is not portable. The data object's `id` is the record ID. Current kinds are:

| Kind | Meaning and links |
| --- | --- |
| `studio` | Location and IANA time zone; settings ID `studio`. |
| `class` | Published occurrence, start/end, service, room/equipment, capacity, buffers, instructor person ID and source draft ID. |
| `unavailability` | Instructor/room/equipment blocked interval and active/removed status. Instructor `resourceId` refers to a person; rooms/equipment use normalized label identities. |
| `draft` | Exact class, pack, reminder or booking-change preparation and approval metadata. Class entries are nested under `classes`; their IDs become published class IDs. Pack/reminder `personId` refers to a person. |
| `approval` | `draftId`, type, opaque human `approvedBy` and `approvedAt`. |
| `pack` | Person ID, draft ID, purchase credits, remaining credits, exact amount cents, expiry, eligible services and ledger revision. |
| `packCreditEvent` | Person/pack IDs, revision, grant/reserve/restore/consume/adjust/transfer/opening event, signed credit delta, remaining/expiry after event, optional class/booking IDs and actor provenance. Legacy openings can contain reservation booking IDs. |
| `charge` | Person and pack IDs, exact amount cents and creation time. |
| `payment` | Person ID, exact received cents, unique external receipt reference and recorder. This records received money; it is not an instruction to collect it. |
| `booking` | Person/class IDs, optional pack ID, booking/waitlist/cancellation state and times, FIFO sequence, check-in attribution (actor, role, `checkinChannel` of roster, self, kiosk, kiosk_scan or desk_scan, and the opaque `kioskId` for kiosk check-ins) and refund flag. |
| `staffAction` | STAFF-006 canonical staff action for a current member command without a SCHED-014 action: actor/role/right/person/channel, before/after effect and optional request identity. Raw check-in codes and native authentication tokens are not copied into this audit. |
| `waiverLaunch` | STAFF-006 request intent linking a person and exact waiver version, requester, channel and request identity. It records a request, not delivery or acknowledgment. The installation-local dispatch table is excluded; imports/restores never send these requests. |
| `bookingAction` | SCHED-014 immutable cancellation, move, restore or waitlist event: booking/person/class IDs, before/after, actor/role/right/channel, reasons, fee/credit effect, notice/suppression and cancellation identity for a restore. |
| `cancellationReasons` | Owner-configured reason labels; old actions keep their original labels. |
| `closure` | SCHED-008 class cancellation or room/location closure: scope (class ID, or room and/or interval), reason, draft or applied status, the exact impact (classes, bookings, credits returned, waitlist spots closed) and attribution. A cancelled `class` carries `cancelReason` and `closureId`; its bookings carry `class_cancelled` or `waitlist_closed`. |
| `notice` | One in-app cancellation notice per affected booking: person, booking, class and closure IDs, subject, text and dismissal time. |
| `memberCheckin` | Person ID, optional 10-digit US phone used for kiosk lookup, and the member's current opaque check-in code with its revision and issue time. Paired kiosk devices are credentials and are not exported. |
| `waiver` | Immutable text, document version and creation attribution. |
| `acknowledgement` | Person ID, exact waiver ID, actor and receipt time. **This is not a signature.** |

Creator, approver, recorder, actor and check-in IDs and import `principal_id` retain opaque attribution. Native operator identities and authentication records are excluded, so these IDs need not resolve to a person. They grant no authority in a receiver. Optional relationship fields remain absent when no relationship exists.

## Import originals, journals and provenance

The export includes all current jobs, irrespective of which owner initiated them. `ik_jobs` preserves namespace, destination, mapping version, reviewed fingerprint, source plan, state, checkpoint, totals, fences, error and reversal policy/cursor/hash. Lease tokens and expiration are omitted. A job's retained original-set version is in `ik_original_sets`.

`ik_originals` identifies originals by `(job_id, kind, original_key)`, with name, SHA-256, byte size and nullable inline bytes. Join `ik_d1_original_chunks` on that triple and concatenate ascending ordinal. For original-set version 3, hex-decode each TEXT chunk, concatenate the resulting base64 text, then base64-decode once. For versions 1/2 concatenate decoded binary chunks. With no chunks, decode the inline bytes. Validate the resulting size and SHA-256. Null inline bytes with no chunks can mean an explicitly unavailable original: inspect the retained plan; never invent an empty file. Retired custody can deliberately lack originals.

`ik_d1_plan_chunks` contains the current chunked plan; `ik_d1_creation_plans` preserves creation snapshots and release state. Concatenate `body` by job and ordinal where a plan is chunked. `ik_sources` connects source identity and content/effects hashes to a job. `ik_provenance` connects the source identity and job/ordinal/effect ordinal to destination, target kind and target ID, with reversal state and retained record JSON. For the current `strap:members` destination, target kind `member` links `target_id` to `st_people.id`.

`ik_d1_history` retains displaced provenance and its successor chain. `ik_d1_entries.owner_job_id` names the job owning reused effects. `ik_batches` records action, start/end positions and fences. `ik_d1_reversal_reports` retains effect reports and positions. `ik_d1_streams` and `ik_d1_stream_pages` relate paged jobs to their stream and page ordinal. Historical references can outlive a target or active source after undo/retirement; preserve them instead of treating them as a new active member.

`ik_d1_erased_sources`, `ik_d1_erased_targets`, `ik_d1_retirements` and `ik_d1_erasure_journal` preserve existing import erasure/retirement evidence. Retirement receipts link to journal IDs. This bundle does not export transient import staging, leases, assertions or implementation coordination tables and cannot resume the native import engine by loading these rows directly.

## Reconstructing in an independent receiver

1. Create an empty data destination with outbound automation disabled. Check manifest format/version and row counts. Preserve the whole source bundle as provenance.
2. Read `tables` directly, or extract CSV strings, parse CSV and JSON-decode each data cell. Create maps keyed by each manifest primary key. Retain document versions, timestamps and ledger revisions separately from export ordering.
3. Load people and studio settings, then parse record data. Link classes to instructors, packs to people/drafts, bookings to classes/people/packs, charges to packs/people, events to packs/bookings and acknowledgements to waiver versions/people. Retain all other document fields and opaque actor IDs.
4. Rebuild each person's money balance as sum of charge `amountCents` minus sum of payment `amountCents`. Sum without floating-point currency conversion. Compare source and receiver person/record-kind counts and charge/payment/remaining-credit totals. Keep pack purchase credits distinct from available credits and money owed. Replay ledger events in pack revision order; an `opening` establishes an observed legacy balance rather than proving a historical grant. Older packs can have only a stored balance and no complete event history.
5. Reconstruct original files and validate sizes/hashes as above. Join provenance to source IDs, jobs and people, preserving undo/reversal reports and existing erasure evidence. Compare waiver texts and exact acknowledgement version links. Do not manufacture signed documents or media.
6. Review the receiver's own provider setup and authorization before enabling billing, messages or other outbound actions. Importing recorded payments, reminder drafts and approvals is data reconstruction, never permission to send or charge again.

Signed-waiver execution and media storage do not exist in today's studio schema. The document manifest explicitly marks each as `not_implemented` with an empty file list. Waiver text and acknowledgement receipts are included, but no signed waiver or signed evidence package is claimed. There are no current studio billing/message-delivery provider connection records to disconnect, pause or reconnect. The bundle transfers no provider authority and makes no claim to implement future reconnection controls. Installation sign-in mail configuration is separate and is excluded.

Native recovery remains the separate guarded `rer export` / `rer import` workflow described in [README](../README.md#back-up-and-restore), including empty-destination checks and the later-erasure-journal fence. This portable JSON is not a native archive or a replacement for that restore validation. Neither an older offline bundle nor an older native archive can discover a later erasure without later evidence.

# Agent preparations

The owner creates a preparation key in **Agent access**. It expires after 30 days and can be revoked immediately. Save the one-time value privately; never put it in chat, logs or source.

`GET /api/strap/agent/context` and `POST /api/strap/agent/command` require `Authorization: Bearer VALUE`. POST accepts JSON `{ "name": "pack.prepare", "input": { "personId": "MEMBER_ID", "credits": 5, "amountCents": 10000, "expiresAt": "2027-01-01T00:00:00Z" } }`.

Allowed commands:

| Command | Input | Result |
| --- | --- | --- |
| `classes.prepare` | `week` (Monday date), `classes` array of `{title,start,end,capacity,instructorId}` with optional `service` (blank uses the class name), `room`, `equipment` (array of names), `bufferBeforeMinutes`, `bufferAfterMinutes` | Frozen weekly publication draft |
| `pack.prepare` | `personId`, positive integer `credits`, nonnegative integer `amountCents`, ISO `expiresAt`, optional `eligibleServices` (array; empty permits all classes) | Frozen pack and charge draft |
| `reminder.prepare` | `personId` | Frozen current balance and reminder text |

Keys only prepare. The owner signs in normally, reviews the exact draft, and uses **Publish** or **Approve**. `classes.publish`, `pack.approve` and `reminder.approve` require that native human owner session and an `id` for the draft. The approval is recorded with the person, draft, reviewed contents and time; stale source data refuses approval. Neither a key nor a bearer token sent to a human route grants approval authority. Reminders export text; nothing is sent externally.

Human command routes use `POST /api/strap/command` with the same JSON envelope, a native session cookie and the installation's exact Origin header. `GET /api/strap/commands` describes the preparation/approval boundary. Browser forms use these same domain operations.

Class preparation and publication check instructor, room and equipment conflicts, including preparation/cleanup buffers and owner-recorded unavailable intervals. Buffer values are whole minutes, defaulting to zero. Resource names ignore case and extra whitespace. Intervals are half-open in UTC, so exact boundary contact is allowed. Agent conflict responses identify the blocking resource, time and record without revealing an unavailable interval’s private reason.

Only native human owners manage unavailable intervals, using `scheduling.unavailable.save` with `resourceKind` (`instructor`, `room` or `equipment`), `resourceId` (instructor ID or resource name), ISO `start`/`end` and `reason`; an optional `id` updates an interval. `scheduling.unavailable.remove` takes its `id` and retains the removed record. An interval cannot invalidate a published class.

`pack.adjust` requires the native human owner session, the pack `id`, whole `creditsDelta` (zero for expiry-only changes), a `reason`, pack-scoped unique `requestId` and current `revision` (`pack.summary.revision`). An optional ISO `expiresAt` changes unused-credit expiration and may explicitly expire it now. A replay of the same request returns its recorded adjustment; a changed request or stale revision is refused. Original purchase terms and money owed remain unchanged. Members read their own `packCreditEvents` and `packs[].summary` in studio state; the owner reads all.

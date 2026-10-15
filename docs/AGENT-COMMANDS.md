# Agent preparations

The owner creates a preparation key in **Agent access**. It expires after 30 days and can be revoked immediately. Save the one-time value privately; never put it in chat, logs or source.

`GET /api/strap/agent/context` and `POST /api/strap/agent/command` require `Authorization: Bearer VALUE`. POST accepts JSON `{ "name": "pack.prepare", "input": { "personId": "MEMBER_ID", "credits": 5, "amountCents": 10000, "expiresAt": "2027-01-01T00:00:00Z" } }`.

Allowed commands:

| Command | Input | Result |
| --- | --- | --- |
| `classes.prepare` | `week` (Monday date), `classes` array of `{title,start,end,capacity,instructorId}` | Frozen weekly publication draft |
| `pack.prepare` | `personId`, positive integer `credits`, nonnegative integer `amountCents`, ISO `expiresAt` | Frozen pack and charge draft |
| `reminder.prepare` | `personId` | Frozen current balance and reminder text |

Keys only prepare. The owner signs in normally, reviews the exact draft, and uses **Publish** or **Approve**. `classes.publish`, `pack.approve` and `reminder.approve` require that native human owner session and an `id` for the draft. The approval is recorded with the person, draft, reviewed contents and time; stale source data refuses approval. Neither a key nor a bearer token sent to a human route grants approval authority. Reminders export text; nothing is sent externally.

Human command routes use `POST /api/strap/command` with the same JSON envelope, a native session cookie and the installation's exact Origin header. `GET /api/strap/commands` describes the preparation/approval boundary. Browser forms use these same domain operations.

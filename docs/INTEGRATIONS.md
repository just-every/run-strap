# Integrations

An integration key lets another application, such as a front-desk display, a signage screen or a studio dashboard, read the rosters or attendance outcomes you explicitly grant. A key reads only its selected scopes and changes nothing.

## Create a key

Open **Integrations** in Strap. Only the studio owner sees this page. Name the key, select **Read class rosters** (`roster:read`) and optionally **Read attendance** (`attendance:read`, off by default), choose the location and, if you like, the events it should hear about. Then select **Create integration key**.

Strap shows the secret once. Paste it into the other application's secret settings straight away. Strap keeps only a SHA-256 hash of it, the same way it keeps agent keys.

Only you, signed in as the studio owner, can create, rotate and revoke keys or change their events. Strap issues secrets only on the Integrations page: the JSON command door refuses `integration.create` and `integration.rotate` with `integration_secret_in_app_only`, even for you, while `integration.revoke` and `integration.events` also work there. Agent keys, integration keys, members and instructors cannot manage keys at all. A key belongs to the owner who created it and stops working if that owner's access ends or changes.

## What a key can read

The catalogue has two separate read-only scopes. Scopes are fixed when a key is created. Existing keys never gain attendance, and rotating a secret never changes its scopes.

| Scope | Reads | Never includes |
| --- | --- | --- |
| `roster:read` | Classes (id, title, service, start and end in UTC, capacity, published or cancelled) with each booking's id and status (booked, waitlisted, offered or cancelled) and the attendee's first name and last initial | Attendance, money, packs, payments, fees, balances, email addresses, phone numbers, emergency contacts, notes, cancellation reasons and instructor names |
| `attendance:read` | Per seat: booking id, a member reference only this key can use, first name and last initial, outcome (booked, attended, no-show, excused, late cancel or early cancel), check-in time and channel, cancellation time and who cancelled, and whether the owner corrected it | Correction, cancellation or waiver reasons, notes, health answers, contact details, full names, person ids, kiosk ids, money, fees, credits, packs, instructor names or pay |

A key covers your studio's one location. Keys for chosen locations arrive with multiple locations (STUDIO-002). Other read scopes, such as contact details or money, and any write scope each need their own approved addition before Strap offers them. People you have erased never appear.

## Read the roster

Send a GET request with the secret and the schema version:

```sh
curl -H "Authorization: Bearer $STRAP_INTEGRATION_SECRET" \
  -H "strap-schema-version: 1" \
  "https://your-studio.example/api/strap/integration/roster?limit=25"
```

```json
{
  "schemaVersion": "1",
  "scope": "roster:read",
  "location": { "id": "studio", "name": "Brooklyn Studio" },
  "data": [
    {
      "id": "CLASS_ID", "title": "Morning Flow", "service": "Morning Flow",
      "start": "2026-11-02T14:00:00.000Z", "end": "2026-11-02T14:45:00.000Z",
      "capacity": 12, "status": "published",
      "roster": [ { "bookingId": "BOOKING_ID", "status": "booked", "attendee": "Ana L." } ]
    }
  ],
  "page": { "limit": 25, "next": "c1.OPAQUE" }
}
```

Classes come in order of start time, then id. A page holds 1 to 100 classes; `limit` sets the size and defaults to 50. To read the next page, send `page.next` back as `cursor`. On the last page `next` is `null`. Treat the cursor as opaque. A class whose start time changes while you page through can appear twice or be missed, so start again from the first page when you need a consistent copy.

`GET /api/strap/integration/key` describes the key itself: its scopes, location, event subscriptions and rate limit.

## Read attendance

Select **Read attendance** (`attendance:read`) only when you create a new key; the form lists the fields it shares. Send `GET /api/strap/integration/attendance` with the same Bearer secret, schema version and paging parameters as the roster.

```json
{
  "schemaVersion": "1",
  "scope": "attendance:read",
  "location": { "id": "studio", "name": "Brooklyn Studio" },
  "data": [
    {
      "id": "CLASS_ID", "title": "Morning Flow", "service": "Morning Flow",
      "start": "2026-11-02T14:00:00.000Z", "end": "2026-11-02T14:45:00.000Z", "status": "published",
      "attendance": [
        { "bookingId": "BOOKING_ID", "memberRef": "mref_0f3a…", "attendee": "Ana L.", "outcome": "attended",
          "checkedInAt": "2026-11-02T13:52:10.000Z", "checkInChannel": "roster",
          "cancelledAt": null, "cancelledBy": null, "corrected": false, "correctedFrom": null, "correctedAt": null, "source": "native" }
      ]
    }
  ],
  "page": { "limit": 50, "next": null }
}
```

`outcome` is the booking's current state: `booked` (a confirmed seat nobody has checked in or marked), `attended`, `no_show`, `excused`, `late_cancel` or `early_cancel`. Late arrival is not a state: compare `checkedInAt` with the class `start`. Waitlisted and offered places are absent, as are cancellations that were not a late or early cancel (a move, an expired offer, or the studio cancelling the class: its `status` says so). `checkedInAt` and `checkInChannel` are set only for a real check-in and are `null` when the owner corrected the seat to attended. `cancelledBy` is `member`, `staff` or `system`. When the owner corrects an outcome, `corrected` is true, `correctedFrom` is the outcome before the correction (`no_show` or `late_cancel`) and `correctedAt` is when; the owner's reason is never shared. `source` is `native` or `imported`.

`memberRef` is the first 128 bits of an HMAC-SHA-256 of the person id under a random secret held only by this key. It is the same for a member in every class and after you rotate the secret, differs between members, and cannot be matched across two keys or to a person id. Names are first name plus last initial. People you have erased are absent. A roster-only key receives 403 here and its roster stays free of attendance. A key with both scopes may join on `bookingId`.

Keys created with `attendance:read` before outcomes were available keep their original resource, which returns only `{ "bookingId", "attended" }` booleans for booked seats, and gain no fields. Create a new key for outcome rows.

All lifecycle, check-order, rate, log, location, erasure and restore rules apply to both scopes. Rate usage is shared per key across resources. No member-level sharing choice exists yet: your explicit grant on a new key is the consent step.

## Schema versions

Every request names a version in the `strap-schema-version` header. The current and only version is `1`. A request without the header is refused with `400` and `schema_version_required`; an unknown version is refused with `400` and `unsupported_schema_version`. Both refusals list the supported versions. Every response carries the header and a `schemaVersion` field.

## Rate limit

Each key may make 60 requests in any 60 seconds. Every request made with a working secret counts, whatever its outcome, except requests refused by the limit itself. Beyond the limit Strap answers `429` with `rate_limited` and a `Retry-After` header: the whole seconds (1 to 60) until the oldest counted request is 60 seconds old. Each key has its own limit.

## Refusals

| Status | `error` | Meaning |
| --- | --- | --- |
| 401 | `integration_credential_required` | No `Authorization: Bearer` integration secret was sent. |
| 401 | `integration_credential_invalid` | Strap does not know this secret. |
| 401 | `integration_credential_revoked` | The key was revoked, a rotation replaced this secret, or the owner who created the key no longer has the same access. |
| 429 | `rate_limited` | The key made 60 counted requests in the last 60 seconds. Wait for `Retry-After`. |
| 405 | `read_only` | Only GET is allowed (`Allow: GET`). Nothing was changed. |
| 400 | `schema_version_required`, `unsupported_schema_version` | Send `strap-schema-version: 1`. |
| 400 | `invalid_limit`, `invalid_cursor` | `limit` must be a whole number from 1 to 100; `cursor` must be a `page.next` value. Strap never adjusts them for you. |
| 403 | `scope_not_granted` | The key's scopes do not cover this data. Payments, balances, packs, people and every other resource are refused. |

Strap checks a request in this order: secret, rate limit, method, schema version, then the data asked for.

## Rotate or revoke a key

**Rotate secret** issues a new secret, and the old one stops working at the same moment. **Revoke** stops every secret of the key at once. A revoked key cannot be rotated or changed; create a new key instead.

## Usage and failures

Under each key, **Usage and failures** lists its newest 100 requests with the time, method, path, status and refusal code. It never stores query strings, secrets or member data. Requests made with a secret Strap does not know cannot be tied to a key and are not listed. Only the owner who created the key sees its log.

## Event subscriptions

A key may subscribe to the events its scopes allow. `roster:read` allows `class.changed` and `booking.changed`; `attendance:read` allows `attendance.changed`. Strap records your choice but does not deliver events yet: each subscription is labelled not delivered until signed event delivery (INT-008) ships.

## Backups, restores and exits

Integration keys stay with the installation where you created them. Native backups and the portable exit leave out the keys, their secrets, subscriptions, logs and rate counts. A restored studio therefore has no integration keys and refuses every old secret. Create new keys after a restore.

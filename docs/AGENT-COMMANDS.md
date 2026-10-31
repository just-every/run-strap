# Agent preparations

The owner creates a preparation key in **Agent access**. It expires after 30 days and can be revoked immediately. Save the one-time value privately; never put it in chat, logs or source.

`GET /api/strap/agent/context` and `POST /api/strap/agent/command` require `Authorization: Bearer VALUE`. POST accepts JSON `{ "name": "pack.prepare", "input": { "personId": "MEMBER_ID", "credits": 5, "amountCents": 10000, "expiresAt": "2027-01-01T00:00:00Z" } }`.

Allowed commands:

| Command | Input | Result |
| --- | --- | --- |
| `classes.prepare` | `week` (Monday date), `classes` array of `{title,start,end,capacity,instructorId}` with optional `service` (blank uses the class name), `room`, `equipment` (array of names), `bufferBeforeMinutes`, `bufferAfterMinutes` | Frozen weekly publication draft |
| `pack.prepare` | `personId` and `catalogVersionId` from `productCatalog.versions` for an active finite-pack product, with no term overrides; or `personId`, positive integer `credits`, nonnegative integer `amountCents`, ISO `expiresAt`, optional `eligibleServices` (array; empty permits all classes) | Frozen pack and charge draft; catalog preparation snapshots the selected immutable version for a personal non-household sale |
| `reminder.prepare` | `personId` | Frozen current balance and reminder text |

Keys only prepare. The owner signs in normally, reviews the exact draft, and uses **Publish** or **Approve**. `classes.publish`, `pack.approve` and `reminder.approve` require that native human owner session and an `id` for the draft. The approval is recorded with the person, draft, reviewed contents and time; stale source data refuses approval. Neither a key nor a bearer token sent to a human route grants approval authority. Reminders export text; nothing is sent externally.

Human command routes use `POST /api/strap/command` with the same JSON envelope, a native session cookie and the installation's exact Origin header. `GET /api/strap/commands` describes the preparation/approval boundary. Browser forms use these same domain operations.

Class preparation and publication check instructor, room and equipment conflicts, including preparation/cleanup buffers and owner-recorded unavailable intervals. Buffer values are whole minutes, defaulting to zero. Resource names ignore case and extra whitespace. Intervals are half-open in UTC, so exact boundary contact is allowed. Agent conflict responses identify the blocking resource, time and record without revealing an unavailable interval’s private reason.

Only native human owners manage unavailable intervals, using `scheduling.unavailable.save` with `resourceKind` (`instructor`, `room` or `equipment`), `resourceId` (instructor ID or resource name), ISO `start`/`end` and `reason`; an optional `id` updates an interval. `scheduling.unavailable.remove` takes its `id` and retains the removed record. An interval cannot invalidate a published class.

`pack.adjust` requires the native human owner session, the pack `id`, whole `creditsDelta` (zero for expiry-only changes), a `reason`, pack-scoped unique `requestId` and current `revision` (`pack.summary.revision`). An optional ISO `expiresAt` changes unused-credit expiration and may explicitly expire it now. A replay of the same request returns its recorded adjustment; a changed request or stale revision is refused. Original purchase terms and money owed remain unchanged. Members read their own `packCreditEvents` and `packs[].summary` in studio state; the owner reads all.

## SCHED-014 booking-change drafts

`booking.change.prepare` accepts `action` (`cancel` or `move`), the booking `id`, target `classId` for a move, `cancelReason` from the studio reason list, the displayed cancellation `terms` key, `mode` (`early` or `late`), a waiver `reason` when needed, and request `channel` (`desk`, `phone`, `inbox`). An optional capacity `override` needs a reason. Courtesy early cancellation may explicitly `suppressNotice` with `suppressionReason`. Preparing changes no booking, credit, fee or notice. The native owner reviews the exact draft under People and approves it once with `booking.change.approve` (`id` = draft id). Changed booking, waiver, capacity, pack, people or policy facts require a fresh draft. Agents cannot approve or execute the change.

## STAFF-006 member/staff command catalogue

`GET /api/strap/commands` publishes the actual studio dispatch registry’s roles, member-door mapping and staff right. Every member-role command has a current staff counterpart; current grants belong to the human owner. Agents retain only the listed preparation commands and cannot execute any staff action. Native authentication and member-owned acknowledgment remain the member’s own acts.

## SUCCESS-006 demand and coverage recommendations

The agent context includes `demand.classes`: source class and booking IDs, usable capacity, reservations (including held offers), waiting count, recorded attendance/no-shows and substitution history. `demand.availability` exposes active unavailable resource intervals without private reasons. These are observations, not forecasts; an unblocked calendar is not an instructor confirmation.

`recommendation.prepare` accepts `action` (`additional`, `retime`, `coverage`), `sourceClassIds` (1–100 published classes, including the target for changes), `reason`, and `proposal`. An additional proposal has the ordinary class fields; a retime names the target `classId` and only new ISO `start`/`end`; coverage names `classId` and only the new `instructorId`, with a current studio service qualification. At least one cited source has the target service. Existing buffers, rooms, spots, closures, booked credits and offer deadlines are checked. Preparation publishes nothing and sends nothing.

The recommendation appears in Prepared class weeks with the cited counts, exact class and member notification. Only the native owner approves with `recommendation.approve`, supplying its `id`, exact `impact` key and displayed `notification` (`in-app-and-email` for affected reservations, otherwise `no-affected-reservations`). No suppression choice is offered. Provider/origin changes or any source, booking, availability or qualification change require a fresh recommendation. Repeating the same approval repeats no publication or notice. The ordinary `classes.publish` command refuses recommendation drafts.

## SCHED-005 recurring class reservations

Native members and owners use `reservation.prepare` with the first timetable
`classId` and an inclusive `throughDate` within the published series. Owners also
supply `personId` and the request `channel` (`desk`, `phone`, `inbox`). The preview
lists booked, waitlisted and skipped dates and reasons without booking or spending
credits. `reservation.confirm` takes its exact `id` and `key`; changed facts require
a fresh preview. Each occurrence uses the ordinary class rules and waitlist order.

`reservation.cancel.prepare` takes the retained `reservationId` and shows each
future, unstarted booking's credit and fee effect. `reservation.cancel.confirm`
takes the preview `id` and `key`; owners also choose a configured `cancelReason`.
Repeating a confirmation creates no duplicate booking, credit return, fee or
notice. Past/started visits remain, and a moved booking keeps its series identity.
Members use **Recurring reservations** on Classes; owners use the same controls on
the member's People card. The owner acts for the booking right until STAFF-001.
Agent keys cannot use these reservation commands.


## Private appointment offer foundation

The native human owner can call `appointment.offer.save` with `requestId`, `service`, ISO `start`, `durationMinutes` (5–600), `instructorId`, `room`, optional `locationId` (the original studio by default), `equipment`, `bufferBeforeMinutes` and `bufferAfterMinutes`. The end is derived from the duration. Offers are immutable alternatives: two overlapping offers may coexist, and an exact request replay returns the original offer; a changed replay is refused. Save the returned offer ID.

`appointment.offer.preview` takes that `id` and rechecks current published allocations, unavailable intervals, instructor changes and applied location closures. Only the owner can save or preview these private offers. `available` describes current resource availability only; `reserved`, `paymentCollected` and `bookingAvailable` remain false. Each saved offer retains `availabilityAtCreation`, including private conflict reasons, even if an exception is later removed. No seat, credit, deposit, payment or message results, and these commands never execute unrelated due billing or notice work. Client-facing offers, acceptance, appointment reservation, member booking, rescheduling and collection remain SCHED-015 gaps; use the existing class workflow for released class bookings.


The native human owner can also call `appointment.series.offer.save` with the same service and resource fields, `startDate`, inclusive `endDate`, studio-local `time` (HH:MM), `minutes` (5–600), `intervalWeeks` (1–52, default 1) and a unique `requestId`. The series contains at most 104 immutable proposed occurrences; local time survives DST and nonexistent local times are refused. It reserves no session or calendar slot.

`appointment.series.offer.preview` takes the saved `id` and lists current availability and private reasons for every date. A conflicted occurrence lists available alternatives at the same local time on up to the next six days, excluding resource conflicts, closures and conflicts with other proposed occurrences. Alternatives are suggestions, never holds. Submit a new request with `choices: [{date, start}]` to retain a checked alternative for that original occurrence date; the chosen start must stay before the next recurrence and is checked again when saving. Duplicate dates, unavailable choices and changed replays are refused atomically. The original offer and its initial conflict reasons remain unchanged.

Both series commands refuse members, instructors, front desk, managers, finance users and agent keys. They follow the ct-approved private owner-only SCHED-002 offer policy. Session reservations, explicit skipped dates, booking rights, changes, notices, pay and appointment screens remain SCHED-013 gaps.


## SUCCESS-002 attendance options

A member saves their own dated availability windows and preferred locations in
**Classes → Attendance options**. `attendance.availability.save` takes the current
`version` (zero initially), up to 28 `windows` containing ISO `start` and `end`
instants, and `locationIds`. A window is at most 24 elapsed hours. Saving replaces
previous windows; an empty set withdraws availability. Staff may open the member
sign-in step with `attendance.availability.launch`, but cannot set these choices.

`attendance.plan.prepare` takes `personId`. An owner, connected preparation key or
explicitly scoped front-desk user receives up to ten chronological published
choices that fit the complete available interval and chosen location. Each cites
the class, times, service and eligible pack, plus actual attended booking IDs.
Current credits, plan hours, booking windows, freezes, intake, waiver, existing
bookings and online capacity all apply. A suggestion holds nothing and sends
nothing. No suitable class is reported honestly; members can request a plan change
or freeze through the existing packs doors, with their existing approval rules.

Only the member accepts with `attendance.plan.accept` and the offer `id` and
chosen `classId`. Staff use `attendance.plan.accept.staff` with a stable `requestId`
and `channel`. Acceptance rechecks current eligibility and capacity in the same
fenced transaction as the ordinary booking. Changed availability or class details,
spent credits and a full class refuse without a partial booking. Replays retain
one booking and one ordinary confirmation. A key can prepare but never accept.

The owner grants `attendance.booking.grant` separately from member-record access,
with the staff `personId`, `enabled`, named `memberIds` and `locationIds`. Both
grants must remain active and match on every staff request, including replay.
Front desk requires second-factor enrollment and sees only scoped attendance
options. Grants, revisions, preferences and source-linked offers remain portable;
no permission to send a future message or collect money is created.

# Retention cohorts and source evidence

The owner's **Retention cohorts** screen at `/app/retention` reads the same
projection as `GET /api/strap/reports/retention`. CSV and XLSX downloads append
`.csv` or `.xlsx` to that API path. A native owner session is required; preparation
and integration keys cannot read the report or import history. Reads are private,
read-only, and send `Cache-Control: no-store`.

## Cohorts and renewals

Credit, visit-limited and unlimited plans are included. Acquisition is the earliest
retained term, ordered by its creation instant then ID, grouped by that instant's
month in the current studio time zone and its original offer. A reviewed historical
import can establish the earlier acquisition. Later native sales remain in that
cohort even when their offer differs. Inactive members retain their history.

`month=YYYY-MM` and `offer=<exact initial offer>` select the same terms in the
screen, JSON and both downloads. Empty or invalid filters are refused. Each row
retains its pack, renewal attempts, successor, signed charge identities, assessed
USD cents and evidence links. A renewed completed native term needs an applied
PLAN-005 renewal or a non-void native recurring invoice with a distinct linked
successor belonging to the same member. Accepted future changes are scheduled;
previews and failures never count as renewals. Expiry alone is not cancellation.
Renewal rate is renewed completed terms divided by completed terms, times 100,
rounded to two decimals, and unavailable with no completed terms.

Native collected renewal cents require explicit receipt allocations to the linked
successor's positive renewal charge. Unallocated receipts and unrelated fees do
not count. Historical collections are separately labeled source observations,
with their original contract and payment references. Neither measure claims net
revenue after refunds or provider settlement.

Tenure spans the earliest retained term through the earlier of the report instant
and the latest term expiry, in whole elapsed 24-hour days, bounded below by zero.
Native visits use corrected attended bookings within that span, starting at the
reviewed native cutover when history is imported; imported visits
use the source's declared per-term totals, before the first native pack. Frequency
is visits times 30 divided by tenure days, rounded to two decimals, or unavailable
at zero tenure. Cohorts average members' tenure and pool their visits and days.

## Period churn

`churnFrom` and `churnTo` accept exact UTC instants. The interval is `(from, to]`;
the default is the last 30 complete UTC days. End must not be in the future, and
start must precede end. Acquisition filters remain independent of this period.

Opening members have personally accepted native recurring agreements at start,
with no recorded access end at or before start. A member is lost only when every
opening agreement ends during the interval, no accepted agreement remains at end,
and no other retained native plan provides access then. Applied terminations and
recorded stopped-agreement access ends establish losses. A second plan or fresh
replacement preserves the member. Deactivation, finite expiry, future schedules,
withdrawals and previews alone do not establish loss.

Member churn is unique lost opening members divided by unique opening members.
Gross canceled recurring revenue churn is lost opening monthly commitment divided
by opening monthly commitment. The immutable acceptance acknowledgement supplies
the original price; the latest non-void invoice due by start supplies a changed
opening price. Divide by the accepted interval in months. Sum before rounding
shown cents; rates round to two decimals. Zero denominators are unavailable, and
an unknown opening price makes revenue values unavailable. This is committed
recurring revenue, excluding collection outcomes, refunds, expansion and price
contraction. It is not net revenue churn. Every term carries `churnEvidence` with
opening agreements, recorded cancellation identities and source links.

Applied native terminations count once per agreement by recorded reason; scheduled,
withdrawn and superseded events do not become completed events. Confirmed started
freezes and actual resumptions retain their recorded type. These event totals are
separate from unique lost members. Historical source reason codes remain labeled;
historical churn denominators and freeze events are unavailable when not exported.

## Reviewed historical terms

Use the ordinary same-origin `POST /api/strap/command` door with
`{"name":"retention.history.preview","input":{"history":<document>}}`.
The result returns the normalized document and its fingerprint. Review it, then
submit `retention.history.import` with that same `history` and `fingerprint`.
The document can also be supplied as JSON text. Example shape:

```json
{
  "format": "strap-retention-history-v1",
  "personId": "existing-native-member-id",
  "source": "synthetic-strap-1",
  "cutoverPackId": "first-native-pack-id",
  "definitionDifferences": "UTC source terms and reported visits; historical freezes and churn denominators were not exported.",
  "terms": [{
    "sourceId": "synthetic-strap-2",
    "startsAt": "2025-01-01T00:00:00Z",
    "endsAt": "2025-02-01T00:00:00Z",
    "offer": "Original offer",
    "contractReference": "synthetic-strap-3",
    "paymentReference": "synthetic-strap-4",
    "amountCents": 10000,
    "paidCents": 9000,
    "attendedVisits": 2,
    "renewed": true,
    "terminationReason": null
  }]
}
```

Import one to 120 historical terms for an existing, non-erased member. Each term
has a unique source ID, valid increasing instants, nonnegative integer cents and
visits, and explicit renewal and termination facts. Terms must not overlap and
must end no later than the member's first native pack creation instant. The
cutover pack must belong to that member and have no earlier native renewal link.
A source renewal links to the next historical term, or from the final historical
term to the explicitly reviewed cutover pack. Gaps remain visible. A terminated
term cannot also claim renewal. False renewal flags never imply a cancellation.

The fingerprint fences changed previews. Repeating the identical import returns
the retained record once; a different second history for the same member is
refused. The immutable record retains normalized source fields, definition
differences, reviewer identity and import time. Unknown source fields are not
retained. Source evidence links show that record, while post-cutover renewals,
terminations and allocated receipts drill to native records. Reporting import
changes no member identity, sign-in, access, credit, charge, payment or collection
permission. Used-member retention and existing native archive rules continue to
apply. This is a documented reporting format, not an incumbent billing migration.
MOVE-009 carries broader historical ingestion and erasure; MOVE-001 through
MOVE-006 carry each incumbent's migration obligations.

CSV headers are plain text, with each data cell a JSON value, including nested
source records and nulls. XLSX preserves those typed source values, a Cohorts
sheet, declared unavailable facts and the context definitions. Report and source
links remain owner-only. Scheduled delivery remains RPT-006.

Contract scope: RPT-003 owns cohort acquisition, historical-term admission and renewal identity; RPT-008 owns churn, tenure, attendance frequency and source reconciliation.

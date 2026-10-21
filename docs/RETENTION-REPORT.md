# Native finite-pack acquisition and renewal report

RPT-003 is partial. The owner Retention cohorts screen (`/app/retention`, same `month` and
`offer` filters) shows the same cohorts and terms; there is no scheduled retention delivery.
Use a native owner session on the installed studio, through the existing same-origin
sign-in door. Preparation and integration keys cannot read this report.

- `GET /api/strap/reports/retention` returns definitions, unavailable metrics,
  `cohorts` and the term-level `rows` that explain each cohort.
- `GET /api/strap/reports/retention.csv` downloads those same term rows, with
  identical `month=YYYY-MM` and `offer=<exact initial offer name>` filters.
  Omit a filter to include every value. Invalid or empty month/offer is refused.
  CSV headers are plain text; each data cell is a JSON value, including arrays,
  numbers, booleans and null. Decode cells as JSON when importing programmatically.

Both doors are read-only and send `Cache-Control: no-store`. Acquisition means the
first **retained native finite credit pack** for that member, ordered by creation
instant then ID. It is not an assertion of the person's first-ever studio membership.
The cohort is its creation month in the current studio time zone and original offer
name (`Unnamed credit pack` when unnamed). Later terms and differently named packs
stay in that member's initial cohort; visits/unlimited plans and people without a
finite pack are excluded. Deactivating a member does not delete their retained
history. Imported historical continuity is unavailable.

Each row names the member, first pack, source pack, current start/expiry, every
renewal attempt ID, the accepted/applied change and applied successor where present,
and the pack's exact signed charge IDs and assessed USD cents. `packUrl`,
`renewalUrl` and `chargeUrls` open the retained evidence in existing owner screens;
`renewalChangeId` identifies the change in the Plan changes panel and native state.
Receipts without a pack allocation are never assigned to a renewal: `paymentIds`
and `collectedRenewalCents` remain null, even if a member has paid their balance.

A completed term expires at or before the report instant. A renewed term needs both
an applied PLAN-005 renewal and its distinct successor's `renewedFromPackId`, for
the same member. An accepted future change is **scheduled**, not applied, paid or
renewal revenue. Previews and failed changes never count as renewals. Expiry without
a linked applied renewal is labeled exactly that; it is not a membership cancellation.

Cohorts count unique members, all retained terms, completed terms, renewed completed
terms, scheduled renewals and terms expired without a linked renewal. The renewal
rate is `renewedTerms / completedTerms * 100`, rounded to two decimal places; no
completed terms means null, never 0%. The month/offer filters select acquisition
cohorts rather than renewal event dates. `packIds` explains every cohort total;
CSV contains the same term rows rather than a second inconsistent aggregation.

**Tenure and attendance frequency.** A member's tenure is the span from their first
retained finite pack's creation instant to the earlier of the report instant and the latest
retained pack expiry, in whole elapsed 24-hour days, never below zero. It is not churn.
Attended visits are current corrected attended bookings whose class started within that
span, inclusive. `visitsPer30Days` is visits × 30 ÷ tenure days rounded half-up to two
decimals, null at zero tenure days. Every term row repeats its member's `tenureDays`,
`attendedVisits` and `visitsPer30Days`; a cohort reports `meanTenureDays` (average over
its members), pooled `attendedVisits` and `visitsPer30Days` (pooled visits × 30 ÷ pooled
tenure days).

Member and revenue churn, imported 18-month history,
freeze/reactivation, PLAN-011 termination reasons/freeze types, and collected
renewal attribution are unavailable. Recurring contracts, payment providers and
migration records are not reconstructed from finite packs. The complete RPT-003
acceptance remains required.

# Packs, credits and payments

A class pack gives a member credits to book with. Strap keeps two separate things for each member: the credits they can
spend on classes, and the money balance between what their packs cost and what they have paid you.

Strap never charges a card. You take payment the way you do today and record it here.

## Give a member a pack

Open **Packs and payments** and use **Prepare a pack**:

- **Member**: an active member.
- **Class credits**: how many classes the pack covers.
- **Price**: in dollars, such as `$189.00`.
- **Eligible services**: one service name per line, such as `Mat`; blank permits all classes. Names match the class’s Service field, or its class name when that field is blank, ignoring case and extra spaces.
- **Good for**: 30 days to a year, each shown with the last day the credits can be used. Credits lapse at the end of
  that day on the studio's clock. The following local midnight is the exclusive expiration instant; the exact date, seconds, offset and studio time zone are shown in the review and pack history.

**Prepare pack** creates a draft. Check it under **Prepared packs and reminders**, then press **Approve this exact pack**. The credits
are ready at once and the pack's amount is added to what the member owes. If a member was waiting for a spot and now
has an eligible credit, the waitlist moves for them. A mat-only pack cannot book or promote into a reformer class.

## Plans: visits each week or month, unlimited and off-peak

**Prepare a pack** also sells a membership plan. Choose **What it gives**:

- **Visits each week or month**: set **Visits per period**, the **Period** and how many unused visits roll over. Weeks start Monday and months on the 1st, at midnight on the studio clock; a class counts in the period it starts, and the first and last periods grant full visits. Unused visits roll into the next period only, up to the limit; rolled visits are used first and never roll again. A booking that would take back a visit already rolled into a later booked period is refused.
- **Unlimited visits**: no visit count.

Under **Plan terms** any pack or plan can also name the plan, limit the days and the class start times (from inclusive, before exclusive, such as weekdays from 10:00 am to before 4:00 pm for an off-peak plan) and cap how many upcoming bookings it holds at once. Eligible services work as they do for packs. A plan holds one visit per booking: check-in or a no-show marks it attended, a late cancel that keeps the visit still counts, and an early cancel returns it. Members see what is left this period, and why a class is refused (outside the plan's hours, the period's visits used, or the upcoming limit). A plan has no credits: you can change its expiration with a reason, not add credits, and plan changes (PLAN-005) apply to class-credit packs. Plans do not renew automatically.

A booking rule in **Studio settings** can target a plan name: it then replaces the service and studio rules for the bookings that plan pays for, such as a longer booking window or a stricter cancel cutoff.

## Credit history and adjustments

Owners and members open a pack’s **Credit history** from the pack table. Remaining credits are available now; a booked seat reserves one, check-in marks it consumed, and cancellation returns it. Restored is the cumulative number returned, while reserved and consumed describe current allocations. Expired counts unused credits whose exact expiration has passed. Every grant, reservation, check-in, restoration and adjustment retains its actor and time; a later action adds an event and preserves the earlier entries.

The owner opens **Adjust credits or expiration**, enters a whole positive or negative credit adjustment and a reason, and may set an exact new expiration on the studio clock. Zero credits changes only expiration. A past expiration makes unused credits expire immediately; credits already allocated to bookings stay with those bookings. An adjustment changes available credits and validity, leaving the original purchase credits, price and money owed intact. A stale form is refused; repeating the same submitted adjustment does not repeat its effect.

Older packs keep their recorded balances. If they predate detailed credit events, the history explicitly labels a legacy opening balance and any unknown earlier usage; it never presents an invented historical grant or visit.

## Record a payment

When a member pays, use **Record a payment** with the member, the amount in dollars and a unique payment reference, such
as the receipt number from your card reader. A reference can be used once: recording the same reference again never
creates a second payment.

## See what every member owes

**Member balances** lists every member who owes money and how much. Each person's card in **People** shows their credits, balance and last visit. Members see their
own balance under **My packs**.

## Balance reminders

For a member who owes money, **Prepare a balance reminder** (or **Prepare a reminder** in **Member success** on Today) writes a draft with the recipient, the outstanding balance
and the exact message. Approve it, then use **Download** in **Approval history** to get the text and send it from your own
email. Strap does not send reminders itself. If the member's balance changes before you approve, Strap asks you to
prepare the reminder again.

## Revenue and collections

Open **Revenue reports** as the owner to compare assessed sales and fees with money received and refunded outside Strap. Filter events by studio-local inclusive dates, named plan/type and the current studio location. **Inspect record** opens the exact retained source; member links open the member profile. The JSON door is `GET /api/strap/reports/revenue`, with `from`, `to`, `plan`, `location` and optional `sourceId` filters. It requires your native owner session.

Ordinary receipts have no plan allocation and stay **Unallocated**. A balance credit is different from an external cash refund. Current member counts and all-time balances have their own labels; balances are unavailable under a plan filter. The definitions on the report explain every total. Missing due dates, historical membership states, processor costs and ACH returns remain unavailable rather than appearing as zero or claiming provider verification.

## Pack renewal report through HTTP

The signed-in owner can read `/api/strap/reports/renewals?days=30&lowCredits=1` and download the same rows from `/api/strap/reports/renewals.csv` with the same query. Open **Renewal worklist** for the same filters, assigned follow-ups and CSV/XLSX downloads. It lists finite credit packs expiring in the next selected number of 24-hour days, or currently at/below the selected credit threshold. It omits expired packs and packs with a member-accepted or applied renewal. Each pack appears once. Last visit uses corrected attended bookings for classes that have started. Money remaining and marketing permission are unavailable; pack price and booking-email preferences do not establish either.

The owner posts `renewal.followup.create` through `/api/strap/command` with the row’s `packId` and exact `basis`, the report’s `days` and `lowCredits`, and `ownerId`, `nextAction` and an ISO `dueAt`. It creates an assigned internal inquiry in Lead follow-up once per pack. Changed source facts require a fresh report. Identical repeats return the existing task; changed assignment details refuse and must be edited in Lead follow-up. No message is sent and no consent is granted.

Other plan kinds, worklist screens, monetary remaining value, marketing permission and approved sequences remain unfinished; the complete RPT-007 acceptance still applies.

## Report downloads

In Revenue, apply the date, plan and location filters, then choose Download CSV or Download XLSX. Attendance has the same download choices for its own filters; the cancellation list also offers filtered XLSX alongside CSV. Downloads are available to the owner under the same access checks as the reports.

CSV data cells contain JSON values, matching the portable exit: decode text cells as JSON when importing programmatically. XLSX opens as a workbook with Sources, Totals (revenue and attendance) and Context sheets. Money stays in exact USD cents; blank unavailable cells are distinct from zero. Context keeps the filters, studio time zone and definitions. Source references remain literal text. Retention cohorts and Renewal worklist also offer XLSX with the same filters and term/pack rows as their CSV. Retention adds Cohorts and Unavailable sheets so its summary metrics travel with the source terms. Teaching pay offers owner-only CSV and XLSX for the current summary; its Totals sheet keeps the configured subtotal separate from an unavailable overall total. Nested source identities, pay rules, calculations and adjustment records are literal JSON text in XLSX. Each native-report workbook records the report instant, effective filters and metric definitions. These teaching-pay downloads do not run payroll or transfer funds; [Envelope](https://github.com/just-every/run-envelope) is the payroll sibling. Scheduled email delivery, autopay exports and reports for unimplemented provider capabilities remain unavailable.

## Intro offers

In **Packs and payments → Intro offers**, the owner configures an immutable offer with a name, included visits, price, elapsed-day duration, eligible services, new-client or returning-client eligibility, and a lifetime limit per person or household across offers. Close an offer to stop new sales; existing purchase terms and credit history remain intact. Prices add debt to the studio balance. Record external payments separately; Strap collects no money.

Before either purchase door works, the owner verifies the member’s identity and household with a concise reason. Link another verified account belonging to the same person, or another verified household member, when appropriate. These additive links restrict intro eligibility; they give no access to another account, booking, contact, payer or household record. Verification and exception reasons are owner-only. Links and used eligibility history remain retained; correction and erasure policy is pending contract review.

A new client has no earlier pack or attended visit across their linked accounts. Returning clients must have earlier activity and satisfy the configured number of elapsed days since every pack expired and the last attended visit. A household limit includes linked people in that household. The member or owner previews an exact sale, then confirms within 15 minutes. Changed identity, offer or purchase facts require a fresh preview. Until delegated staff rights ship, only the native owner sells at the desk or by phone. A sale outside eligibility requires the owner’s explicit exception reason and is audited under the price right. Retrying the same confirmation never sells twice.

The intro starts at confirmation, expires after the configured number of elapsed 24-hour days, and uses the ordinary credit ledger, waiver, service, booking and cancellation rules. Its receipt shows the exact exclusive expiry. Expiry creates no membership, renewal charge or new pack. Under **Freezes and recurring invoices**, the owner may separately propose recurring studio invoices for the same credit count and price at a disclosed calendar-month interval. The member alone accepts those exact terms, or declines with **Stop future invoices now**. Ignoring a proposal grants no consent. These invoices authorize studio-balance debt only; card and bank collection are unavailable.

## Renewal worklist

**Renewal worklist** combines native fixed-term visit/unlimited plans, intro offers, finite pack expiry/low credits, stopped invoice renewals, scheduled terminations (with an owner-entered reason code) and freeze resumptions. The date is the effective end or, for a freeze-only row, resumption. Withdrawing a termination restores the retained term date. An accepted renewal removes its source pack.

The value is unused receipt-allocated prepaid access under the existing elapsed-access calculation, excluding confirmed freeze time and rounded half-up to cents. An eligible unallocated receipt makes the value unavailable; zero means no recorded allocated prepaid value. It is not a refund quote, inferred sale price or payment collection. The screen, CSV and XLSX share their filters, dates, source identities, values, channel permissions and enrollment outcomes.

Create one assigned internal follow-up per pack, or preview and approve a native renewal sequence, then enroll a currently permitted row once. Changed source facts refuse enrollment. Explicit queue review rechecks permission, source eligibility and pause, and holds marketing SMS during the member's quiet hours. It may record one native in-app message. SMS and email remain held as provider delivery unavailable; no external dispatch or automatic sequence runs. Opt-out suppresses queued work and a new rule cannot bypass permission. These foundations do not claim full AUTO-001 or provider-autopay behavior.


## Renewal disclosures and future prices

In **Packs and payments**, the owner opens **Schedule renewal disclosure** under an
active recurring invoice agreement and chooses its lead time, from 15 to 365 elapsed
days. The agreement personally accepted by the member records its minimum price-notice
period (30 days by default). Choose a longer scheduling lead time to allow for delivery
delays; an actually late notice cannot support price acceptance. Old agreements without
accepted notice terms require a fresh agreement before proposing a price change. An optional exact future price needs the member's personal acceptance before
the exact accept-by instant shown in the notice. The effective date is that stated
renewal, after the full accepted notice period. Without acceptance by expiry the original price continues. The accepted price applies
once at the stated renewal and continues for later invoices; the original agreement
acknowledgment and the exact amendment remain retained. Changed source terms or a
moved due date require owner review before billing. No card or bank debit is authorized.

The member sees the same disclosure in **My packs**, accepts its exact price there,
or follows **Review terms and stop future invoices** to the one-step stop. The owner
can open the member's acceptance door but cannot accept for them. The staff action
retains the contract-change right, actor, member, channel and before and after facts.

**Schedule a pack expiry notice** covers a finite pack without an accepted renewal,
with 1 to 365 elapsed days of lead time. It retains the purchase basis and creates no
invoice or new term. A notice whose due date changed is closed as stale. The owner
can cancel a scheduled notice before dispatch.

Each scheduled notice reserves one in-app notice and one email through the configured
Base provider, regardless of booking-email preferences or whether the in-app notice was
read. Required email includes the exact old and new prices, effective date, accept-by
instant and an absolute cancellation link. Its actual email outcome is shown to both
the member and owner; missing configuration, paused delivery and failed or uncertain
sends remain visible and never claim successful delivery or silently disappear. A
failed attempt is never automatically resent. Native restores
retain the notices but exclude dispatch authority, even at the same origin. New owner
scheduling creates authority only for that installation; old pending notices stay stale.

The native notice policy and riders were approved by ct on 24 Oct 2026. Provider
collection remains with BILL-002, BILL-013 and BILL-014; STAFF-001 carries delegated
staff rights. Installations need a configured, connected mail sender to deliver required
email. These controls do not claim legal compliance for every jurisdiction.

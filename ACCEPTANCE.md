# First release and target acceptance

Target edition: 17 October 2026. This checklist keeps the existing first-release bullet form and lists every CONTRACT.md clause with the same status and public-door acceptance journey. `done` needs cited code and existing public-door tests; `partial` identifies the existing foundation and the remaining gap. Missing target behavior is required product work, not a release claim.

Current judgment: commit `411dc1910f35337acd819abe79b1e061e25e90c3` (17 October 2026). Run `pnpm run test:strap` for current studio HTTP flows, `pnpm run test:archive` for archive CLI flows, and `pnpm run build:site` plus `rer check --profile first-party` for document/site structure. A future clause is complete only when its entire journey passes; controlled live provider/store/migration evidence is additional to network-edge tests.

## Published guarantees

- **AUTH-001 — Native roles and private records.** **Status:** done. **Acceptance evidence:** Sign in through invitations as an owner, two members and two instructors; read state, submit commands and request reminder downloads across roles; unauthorized work is refused without writes. **Current evidence:** `src/strap/domain/index.ts`; `src/strap/domain/bookings.ts`; `src/strap/http.ts`; `tests/strap.test.mjs`.

- **AUTH-002 — Immediate revocation and origin protection.** **Status:** done. **Acceptance evidence:** Deactivate an invited member and revoke an agent key, then reuse their sessions or credentials; attempt cross-origin and malformed commands; require refusal and unchanged records. **Current evidence:** `src/strap/credentials.ts`; `src/strap/http.ts`; `src/strap/domain/store.ts`; `tests/strap.test.mjs`.

- **AGENT-001 — Exact drafts and human approval.** **Status:** done. **Acceptance evidence:** Use an agent key to prepare a pack and reminder, refuse agent approval and the human endpoint with that key, approve as owner, download the text and refuse duplicate approval. **Current evidence:** `src/strap/domain/drafts.ts`; `src/strap/domain/money.ts`; `src/strap/domain/classes.ts`; `tests/strap.test.mjs`.

- **DATA-001 — Authoritative transactional studio records.** **Status:** done. **Acceptance evidence:** Race public booking commands for one seat and one credit; inspect one confirmed booking, no negative credit balance and no duplicate committed effect. **Current evidence:** `src/strap/domain/store.ts`; `src/strap/domain/bookings.ts`; `tests/strap.test.mjs`.

- **BOOK-001 — Eligible credit bookings.** **Status:** done. **Acceptance evidence:** Publish a reviewed future class, grant packs, book through the member API, attempt a duplicate and missing-waiver booking and inspect capacity and credit state. **Current evidence:** `src/strap/domain/classes.ts`; `src/strap/domain/bookings.ts`; `tests/strap.test.mjs`.

- **BOOK-002 — Cancellation and eligible FIFO promotion.** **Status:** done. **Acceptance evidence:** Fill a one-seat class, add a waiter, refuse another member's cancellation, cancel the booked seat and inspect one refunded credit and the waiter's confirmed seat and single debit. **Current evidence:** `src/strap/domain/bookings.ts`; `tests/strap.test.mjs`.

- **PACK-001 — Reviewed finite class packs.** **Status:** done. **Acceptance evidence:** Prepare a ten-credit pack, inspect no credits before approval, approve once and inspect ten credits, the exact owed cents and approval; repeat approval is refused. **Current evidence:** `src/strap/domain/money.ts`; `tests/strap.test.mjs`.

- **PAY-001 — Once-only external receipt recording.** **Status:** done. **Acceptance evidence:** Record a partial external receipt against an approved pack, repeat its reference and submit a negative amount; inspect one payment and the remaining balance. **Current evidence:** `src/strap/domain/money.ts`; `tests/strap.test.mjs`.

- **WAIVER-001 — Exact current waiver acknowledgement.** **Status:** done. **Acceptance evidence:** Publish two waiver versions, reject booking without acknowledgement and acknowledgement of the obsolete version, acknowledge the latest and book successfully. **Current evidence:** `src/strap/domain/bookings.ts`; `tests/strap.test.mjs`.

- **IMPORT-001 — Reviewed member CSV and reversible journal.** **Status:** done. **Acceptance evidence:** Upload the documented CSV through import.preview, refuse altered bytes with the old fingerprint, apply and resume to completion, inspect originals, edit one member and undo; the edited member survives. **Current evidence:** `src/strap/movein/csv.ts`; `src/strap/movein/index.ts`; `src/strap/movein/targets.ts`; `tests/strap.test.mjs`.

- **ARCHIVE-001 — Complete native archive and guarded restore.** **Status:** done. **Acceptance evidence:** Populate a studio through HTTP, export with the public CLI, restore into an empty destination and re-export equal product parts; refuse corruption, a populated destination and a pre-erasure archive with a later journal. **Current evidence:** `src/strap/archive-policy.mjs`; `tests/archive.test.mjs`.

- **ERASE-001 — Unused identity erasure fence.** **Status:** done. **Acceptance evidence:** Erase an unused person through person.erase, inspect absence of their email, refuse recreation and CSV reimport, and run the CLI older-backup/later-journal refusal. **Current evidence:** `src/strap/domain/people.ts`; `tests/strap.test.mjs`; `tests/archive.test.mjs`.

- **AUDIT-001 — Retained draft approval records.** **Status:** done. **Acceptance evidence:** Approve a pack through HTTP, inspect its draft-linked approval, archive the populated studio and compare the restored approval records. **Current evidence:** `src/strap/domain/drafts.ts`; `tests/strap.test.mjs`; `tests/archive.test.mjs`.

- **PUBLIC-001 — Run site and installed studio doors.** **Status:** partial. **Acceptance evidence:** Build the run site, open its homepage, /run and /docs; open the installed Worker Lobby signed out and attempt /app before and after sign-in. Confirm the public and private routes remain separate. **Current evidence:** `src/site/pages.ts`; `src/site/html.ts`; `src/strap/http.ts`; `tests/runtime.mjs`. **Gap:** Installed Lobby and private HTTP doors have coverage; no complete browser journey verifies the built run-site, /run and every docs link.

## Studio and members

- **STUDIO-001 — US studio configuration.** **Status:** missing. **Acceptance evidence:** Configure a New York studio and a Los Angeles location; buy a USD pack, view its receipt and book across a DST transition; local times and charged cents agree across staff and member views. **Gap:** No implemented us studio configuration workflow or public-door acceptance coverage.

- **STUDIO-002 — Locations and shared memberships.** **Status:** missing. **Acceptance evidence:** Give a member a two-location plan, book at both, deny a third location, and compare site-restricted manager and consolidated owner reports. **Gap:** No implemented locations and shared memberships workflow or public-door acceptance coverage.

- **MEM-001 — Unified member history.** **Status:** partial. **Acceptance evidence:** Open a migrated member, book, attend, pay and reply; see the dated timeline and ledger, merge a duplicate with review and confirm all histories remain linked. **Current evidence:** `src/strap/domain/index.ts`; `src/strap/ui/people.ts`; `src/strap/ui/packs.ts`; `tests/strap.test.mjs`. **Gap:** People, bookings and payment records exist; combined profiles, notes, preferences, emergency contacts and duplicate merge are absent.

- **MEM-002 — Households and authorized payers.** **Status:** missing. **Acceptance evidence:** Create a household with two children and a payer, book each child and charge their payer, remove a guardian and verify the next request loses child access. **Gap:** No implemented households and authorized payers workflow or public-door acceptance coverage.

- **MEM-003 — Family pricing and tuition.** **Status:** missing. **Acceptance evidence:** Enroll two siblings, preview and collect discounted monthly tuition, withdraw one and verify the next bill and participant entitlements. **Gap:** No implemented family pricing and tuition workflow or public-door acceptance coverage.

- **MEM-004 — Intake forms and restricted notes.** **Status:** missing. **Acceptance evidence:** Publish an intake form, complete it on signup, change a required question and attempt a new enrollment; front desk sees permitted answers while unauthorized instructors cannot read restricted notes. **Gap:** No implemented intake forms and restricted notes workflow or public-door acceptance coverage.

- **MEM-005 — Signed waivers and enrollment policies.** **Status:** missing. **Acceptance evidence:** Sign a waiver on mobile as an adult and authorized guardian, download each evidence package, replace the policy and verify re-signing is required before the affected booking. **Gap:** No implemented signed waivers and enrollment policies workflow or public-door acceptance coverage.

- **MEM-006 — Member preferences and privacy choices.** **Status:** missing. **Acceptance evidence:** Save different transactional and marketing preferences, book a class, attempt a marketing sequence and export the preference record with its source and date. **Gap:** No implemented member preferences and privacy choices workflow or public-door acceptance coverage.

## Plans and memberships

- **PLAN-001 — Recurring memberships and product catalogue.** **Status:** partial. **Acceptance evidence:** Publish one of each product, purchase through member checkout, then change the catalogue price; existing contract terms and purchase evidence remain intact. **Current evidence:** `src/strap/domain/money.ts`; `tests/strap.test.mjs`. **Gap:** Approved finite packs exist; recurring subscriptions, catalogue checkout, fixed-term plans and distinct intro/drop-in products are absent.

- **PLAN-002 — Unlimited and period entitlements.** **Status:** partial. **Acceptance evidence:** Buy a four-visit monthly plan and an unlimited plan, cross a period boundary, book eligible and ineligible classes concurrently and inspect exactly the allowed reservations. **Current evidence:** `src/strap/domain/bookings.ts`; `src/strap/domain/money.ts`; `tests/strap.test.mjs`. **Gap:** Finite credit booking works; unlimited, periodic, service/location-limited and rollover entitlements are absent.

- **PLAN-003 — Pack validity and credit history.** **Status:** partial. **Acceptance evidence:** Buy a pack restricted to mat classes, attempt a reformer booking, consume and return a credit, cross expiry and inspect the immutable usage and adjustment history. **Current evidence:** `src/strap/domain/bookings.ts`; `src/strap/domain/money.ts`; `src/strap/domain/index.ts`; `tests/strap.test.mjs`. **Gap:** Remaining credits and expiry checks exist; service restrictions, a complete ledger, adjustment reasons and expiry journey coverage are absent.

- **PLAN-004 — Intro offers and eligibility.** **Status:** missing. **Acceptance evidence:** Purchase a two-week intro as a new member, refuse a duplicate purchase under another account linked to the same member, use its visits and accept or decline an explicit recurring offer. **Gap:** No implemented intro offers and eligibility workflow or public-door acceptance coverage.

- **PLAN-005 — Upgrades downgrades and proration preview.** **Status:** missing. **Acceptance evidence:** Upgrade mid-cycle, accept the preview, downgrade at renewal and race a second change; charge and entitlements match the confirmed preview and stale approval is refused. **Gap:** No implemented upgrades downgrades and proration preview workflow or public-door acceptance coverage.

- **PLAN-006 — Freezes and planned resumption.** **Status:** missing. **Acceptance evidence:** Freeze a plan with future bookings, inspect the exact billing and class effects, approve, cross the dates and verify one resumption and the revised renewal charge. **Gap:** No implemented freezes and planned resumption workflow or public-door acceptance coverage.

- **PLAN-007 — Cancellation and remaining value.** **Status:** missing. **Acceptance evidence:** Cancel a plan with unused credits and future reservations, approve a required exception, verify confirmation and final bill, then advance beyond renewal and confirm no further charge. **Gap:** No implemented cancellation and remaining value workflow or public-door acceptance coverage.

- **PLAN-008 — Renewal disclosures and price changes.** **Status:** missing. **Acceptance evidence:** Schedule an annual renewal and a price increase, deliver the notices at the configured lead time, cancel from the notice and verify no renewal collection. **Gap:** No implemented renewal disclosures and price changes workflow or public-door acceptance coverage.

- **PLAN-009 — Courses workshops and tuition installments.** **Status:** missing. **Acceptance evidence:** Enroll a household participant in a six-week course, collect the deposit and installments, record attendance and withdraw under policy; roster, installments and credited balance reconcile. **Gap:** No implemented courses workshops and tuition installments workflow or public-door acceptance coverage.

- **PLAN-010 — Guest passes and guest allowances.** **Status:** missing. **Acceptance evidence:** Give a member a plan with two monthly guest passes, use both, attempt a third guest booking in the same period under each policy and see it refused or charged once to the payer; cross the period boundary and verify the allowance resets; another member cannot book the same guest on a guest pass beyond the per-guest limit. **Gap:** No guest-pass entitlement, allowance policy or guest ledger exists.

## Scheduling and attendance

- **SCHED-001 — Recurring timetable and series edits.** **Status:** partial. **Acceptance evidence:** Create a weekly class across DST, move one session and then the remaining series, inspect affected bookings and confirm members receive only the relevant changes. **Current evidence:** `src/strap/domain/classes.ts`; `src/strap/ui/classes.ts`; `tests/strap.test.mjs`. **Gap:** Reviewed explicit weekly occurrences ship; recurrence, series edits, location resources and DST scheduling journeys are absent.

- **SCHED-002 — Private appointments and services.** **Status:** missing. **Acceptance evidence:** Offer two overlapping appointment slots using one instructor and room, book concurrently, collect a deposit and reschedule; only one conflicting reservation commits. **Gap:** No implemented private appointments and services workflow or public-door acceptance coverage.

- **SCHED-003 — Room equipment and instructor conflicts.** **Status:** partial. **Acceptance evidence:** Try to publish overlapping classes using the same instructor, room or equipment, including a concurrent change; each conflict is refused and displayed without partial publication. **Current evidence:** `src/strap/domain/classes.ts`. **Gap:** Instructor-overlap validation exists; room/equipment resources, availability, buffers and conflict-path tests are absent.

- **SCHED-004 — Instructor substitutions.** **Status:** missing. **Acceptance evidence:** Request a substitute, reject a conflicting candidate, approve an available instructor and verify their roster rights and pay report change while the original instructor loses attendance rights. **Gap:** No implemented instructor substitutions workflow or public-door acceptance coverage.

- **SCHED-005 — Recurring member reservations.** **Status:** missing. **Acceptance evidence:** Reserve a weekly class with one full occurrence and one holiday closure, inspect booked/waitlisted/skipped dates, cancel one and then the future series without double-credit effects. **Gap:** No implemented recurring member reservations workflow or public-door acceptance coverage.

- **SCHED-006 — Booking windows and cancellation rules.** **Status:** partial. **Acceptance evidence:** Book at both sides of a booking-window boundary and cancel before and after a service cutoff; the displayed policy, credit return and fee match persisted outcomes. **Current evidence:** `src/strap/domain/bookings.ts`. **Gap:** Current booking and cancellation stop at class start; configurable windows, priority and per-service policy previews are absent.

- **SCHED-007 — Spot and reformer selection.** **Status:** missing. **Acceptance evidence:** On mobile select a reformer, race another member for that spot, move to a free spot and inspect the instructor roster; only one booking owns each spot. **Gap:** No implemented spot and reformer selection workflow or public-door acceptance coverage.

- **SCHED-008 — Closures and class cancellation.** **Status:** missing. **Acceptance evidence:** Cancel a full class and its waitlist due to a closure, confirm affected members and financial effects, submit twice and verify each credit/refund and notification occurs once. **Gap:** No implemented closures and class cancellation workflow or public-door acceptance coverage.

- **SCHED-009 — Absence credits and makeups.** **Status:** missing. **Acceptance evidence:** Report an eligible absence, issue one makeup credit, book a replacement through the parent portal, repeat the request and inspect one credit and linked original/makeup attendance. **Gap:** No implemented absence credits and makeups workflow or public-door acceptance coverage.

- **SCHED-010 — Front-desk booking for members and walk-ins.** **Status:** partial. **Acceptance evidence:** As front desk, book a phoned-in member choosing between two eligible packs, sell a drop-in at the moment of booking, and book a walk-in as an unpaid visit that a later ten-pack purchase settles with one debit; attempt a full-class and an outside-window booking without the override right (refused, no writes) and with it (booked, override audited); inspect exactly one credit debit per visit throughout. **Current evidence:** `src/strap/domain/bookings.ts`; `tests/strap.test.mjs`. **Gap:** Owners can cancel on a member's behalf under the shared seat and credit fence; staff booking for a member, pass choice, desk sale at booking, unpaid-visit settlement and audited capacity/window overrides are absent.

- **SCHED-011 — Online capacity and held walk-in spots.** **Status:** partial. **Acceptance evidence:** Set a class to total 12 and online 10; fill 10 through member doors and see it full online with the waitlist offered; front desk books spot 11 for a member and spot 12 for a walk-in; a 13th staff booking without the override right is refused; a member cancellation reopens one online spot and promotes the first eligible waiter once. **Current evidence:** `src/strap/domain/classes.ts`; `src/strap/domain/bookings.ts`; `tests/strap.test.mjs`. **Gap:** Each class has one explicit capacity enforced by the shared booking fence; separate online capacity, held walk-in spots and channel-specific allocation are absent.

- **SCHED-012 — Booking a named guest.** **Status:** missing. **Acceptance evidence:** A member with two guest passes books themselves and a named guest into a class with two seats left; one guest pass is consumed, the class is full, a lead exists with the member as referrer, and the guest's check-in is refused until the waiver is signed from the emailed link; a concurrent booking for the last seat is refused or waitlisted; cancelling the guest seat restores the guest pass once. **Gap:** No guest booking, guest waiver routing or guest-to-lead creation exists.

- **ATT-001 — Member kiosk and staff check-in.** **Status:** partial. **Acceptance evidence:** Check in through member mobile, kiosk lookup, a scanned member QR code and assigned instructor doors, rescan the same code, attempt another instructor and duplicate check-in, and reconcile the class attendance roll. **Current evidence:** `src/strap/domain/bookings.ts`; `src/strap/ui/classes.ts`; `tests/strap.test.mjs`. **Gap:** Owner and assigned-instructor attendance exist; member self-check-in, kiosk and explicit no-show marking are absent.

- **ATT-002 — Late-cancel and no-show fees.** **Status:** missing. **Acceptance evidence:** Late-cancel one booking and no-show another, run the fee process twice, waive one as authorized staff and inspect one assessment per outcome with its charge status. **Gap:** No implemented late-cancel and no-show fees workflow or public-door acceptance coverage.

- **ATT-003 — Attendance corrections and credit overrides.** **Status:** partial. **Acceptance evidence:** Mark a paid no-show incorrectly, correct attendance as a permitted manager, approve the refund and inspect one restored credit and one fee reversal; an instructor without that right is refused. **Current evidence:** `src/strap/domain/bookings.ts`; `tests/strap.test.mjs`. **Gap:** Ordinary pre-start cancellation refunds once; late overrides, fee reversals and attendance correction workflows are absent.

## Billing and money

- **BILL-001 — Studio-owned Stripe connection.** **Status:** missing. **Acceptance evidence:** Connect a Stripe test account, complete readiness, purchase a plan, rotate the connection and inspect the same merchant and retained transaction history; foreign-account webhooks cannot mutate it. **Gap:** No implemented studio-owned stripe connection workflow or public-door acceptance coverage.

- **BILL-002 — Card checkout and recurring autopay.** **Status:** missing. **Acceptance evidence:** Buy a monthly plan with authentication-required and declined Stripe test cards and with Apple Pay and Google Pay test wallets, complete authentication, advance one renewal and replay requests; one charge per successful invoice appears in Stripe and Strap. **Gap:** No implemented card checkout and recurring autopay workflow or public-door acceptance coverage.

- **BILL-003 — ACH verification mandates and settlement.** **Status:** missing. **Acceptance evidence:** Authorize a Stripe ACH test bank, collect a renewal, replay pending/success/return events out of order and verify the correct open balance, mandate evidence and access without calling pending money settled. **Gap:** No implemented ach verification mandates and settlement workflow or public-door acceptance coverage.

- **BILL-004 — Stored payment methods and self-service.** **Status:** missing. **Acceptance evidence:** Replace an expiring card and verify an ACH account from self-service; the next invoice uses the selected default, another household member without payer rights cannot change it and logs contain no raw details. **Gap:** No implemented stored payment methods and self-service workflow or public-door acceptance coverage.

- **BILL-005 — Scheduled invoice and renewal engine.** **Status:** missing. **Acceptance evidence:** Run renewal across restart and duplicate scheduler invocation, including a trial and cancelled plan; each due period gets one invoice, the agreed access and no cancelled-plan charge. **Gap:** No implemented scheduled invoice and renewal engine workflow or public-door acceptance coverage.

- **BILL-006 — Proration and adjustments.** **Status:** missing. **Acceptance evidence:** Join mid-month, upgrade and freeze on specified dates, approve each calculation, compare invoice lines with previews and refuse a changed-plan stale preview. **Gap:** No implemented proration and adjustments workflow or public-door acceptance coverage.

- **BILL-007 — Failed-payment dunning and recovery.** **Status:** missing. **Acceptance evidence:** Fail a monthly card renewal, deliver the recovery message, update the method, collect once and inspect restored access; simulate an ACH return and a hard decline and confirm the configured separate handling. **Gap:** No implemented failed-payment dunning and recovery workflow or public-door acceptance coverage.

- **BILL-008 — Refunds credit notes and disputes.** **Status:** missing. **Acceptance evidence:** Refund part of a pack purchase, replay the provider event, fail a refund, and receive a test dispute; the ledger shows each state and amount, remaining credits follow approved policy and agent approval is refused. **Gap:** No implemented refunds credit notes and disputes workflow or public-door acceptance coverage.

- **BILL-009 — Invoices receipts and balances.** **Status:** partial. **Acceptance evidence:** Buy a pack, pay partly by an external receipt and partly by Stripe, refund a line and download the member invoice and receipts; totals and each settlement state agree. **Current evidence:** `src/strap/domain/money.ts`; `src/strap/ui/packs.ts`; `tests/strap.test.mjs`. **Gap:** Pack charges, external receipts and balances exist; itemized documents, delivered receipts, tax and processor states are absent.

- **BILL-010 — Payment event reconciliation.** **Status:** missing. **Acceptance evidence:** Replay, reorder, omit and forge invoice/payment webhooks, run owner reconciliation and compare Stripe objects with Strap's invoice, access and balance; no duplicate charge or lost exception appears. **Gap:** No implemented payment event reconciliation workflow or public-door acceptance coverage.

- **BILL-011 — Payouts fees and deposit matching.** **Status:** missing. **Acceptance evidence:** Collect by card and ACH, refund a portion, settle a payout and download reconciliation; gross less refunds and fees equals the net payout and unmatched deposits remain visible. **Gap:** No implemented payouts fees and deposit matching workflow or public-door acceptance coverage.

- **BILL-012 — US sales tax and product taxability.** **Status:** missing. **Acceptance evidence:** Sell a taxable retail item and a differently classified class in a Stripe Tax test account, issue a partial refund and compare invoice tax and reversal with provider responses and filing export. **Gap:** No implemented us sales tax and product taxability workflow or public-door acceptance coverage.

## Sales and member follow-up

- **SALE-001 — Gift cards and promotional pricing.** **Status:** missing. **Acceptance evidence:** Buy a $100 gift card, redeem $40 with an eligible code, attempt a disallowed second use and inspect the remaining $60 liability and refund treatment. **Gap:** No implemented gift cards and promotional pricing workflow or public-door acceptance coverage.

- **SALE-002 — Retail point of sale.** **Status:** missing. **Acceptance evidence:** Sell a mat and drop-in at a connected Stripe Terminal test reader, take a Tap to Pay test payment with a tip on a private session, split an allowed tender, return the mat and reconcile inventory, tax, receipt and payment without double fulfillment. **Gap:** No implemented retail point of sale workflow or public-door acceptance coverage.

- **SALE-003 — Inventory and purchase controls.** **Status:** missing. **Acceptance evidence:** Receive two sizes of studio apparel, sell the last unit, block overselling, transfer stock between locations and record a non-restockable return; all movements reconcile. **Gap:** No implemented inventory and purchase controls workflow or public-door acceptance coverage.

- **LEAD-001 — Lead capture and attribution.** **Status:** missing. **Acceptance evidence:** Submit the same enquiry from a website form and a Meta test lead, assign staff, purchase an intro and verify one linked member with both source records and permission evidence. **Gap:** No implemented lead capture and attribution workflow or public-door acceptance coverage.

- **LEAD-002 — Follow-up pipeline and tasks.** **Status:** missing. **Acceptance evidence:** Assign an enquiry, schedule a callback, miss its due date, complete a first visit and convert the lead; the staff queue and stage report show each transition and its next action. **Gap:** No implemented follow-up pipeline and tasks workflow or public-door acceptance coverage.

- **LEAD-003 — Welcome and intro nurture.** **Status:** missing. **Acceptance evidence:** Buy an intro, receive welcome and first-visit guidance, attend and receive an eligible membership offer; purchase membership or reply and verify obsolete sales steps stop. **Gap:** No implemented welcome and intro nurture workflow or public-door acceptance coverage.

- **LEAD-004 — Missed visits and lapse recovery.** **Status:** missing. **Acceptance evidence:** Establish a weekly pattern, miss visits while one member is frozen and another has no eligible class, run the rule and inspect only justified tasks/messages with the booking evidence. **Gap:** No implemented missed visits and lapse recovery workflow or public-door acceptance coverage.

- **LEAD-005 — Win-back campaigns and referrals.** **Status:** missing. **Acceptance evidence:** Approve a win-back offer for eligible former members, receive a referral and renew one plan; compare redemptions, reward cost and later visits and confirm an opted-out member is excluded. **Gap:** No implemented win-back campaigns and referrals workflow or public-door acceptance coverage.

- **LEAD-006 — Attendance milestones and recognition.** **Status:** missing. **Acceptance evidence:** Reach a 50-visit milestone, correct one attendance record and replay processing; inspect one recognition or reward and no public sharing without permission. **Gap:** No implemented attendance milestones and recognition workflow or public-door acceptance coverage.

- **LEAD-007 — Empty-place outreach.** **Status:** missing. **Acceptance evidence:** Open two seats in a class with a waiting list, send approved offers, race three acceptances and verify no oversell, waitlist priority and spending within the owner's limit. **Gap:** No implemented empty-place outreach workflow or public-door acceptance coverage.

- **LEAD-008 — Post-visit feedback and review requests.** **Status:** missing. **Acceptance evidence:** Complete two first visits, deliver the feedback requests, submit a low and a high rating; both members see the public review link, the low rating creates one staff task, and a member who opted out of marketing receives no request. **Gap:** No feedback request, review link or rating follow-up exists.

## Delivered communication and automation

- **MSG-001 — Two-way studio inbox.** **Status:** missing. **Acceptance evidence:** Reply to a class enquiry by SMS and email, assign the conversation and respond in-app; inspect one timeline, delivery outcomes and no leaked internal note. **Gap:** No implemented two-way studio inbox workflow or public-door acceptance coverage.

- **MSG-002 — Booking confirmations and changes.** **Status:** missing. **Acceptance evidence:** Book, reschedule and cancel through member doors and approve a substitution; inspect provider-received messages with correct dates and links, then replay events and see no duplicate notice. **Gap:** No implemented booking confirmations and changes workflow or public-door acceptance coverage.

- **MSG-003 — Scheduled class reminders.** **Status:** missing. **Acceptance evidence:** Book a class, change its start before reminder time, run the scheduler and inspect one reminder for the new time and a staff task for a failed channel. **Gap:** No implemented scheduled class reminders workflow or public-door acceptance coverage.

- **MSG-004 — Waitlist offers and expiry.** **Status:** partial. **Acceptance evidence:** Cancel a full-class booking, deliver the next waiter's offer, let it expire and accept the following offer; verify FIFO eligibility, one seat and one credit debit. **Current evidence:** `src/strap/domain/bookings.ts`; `tests/strap.test.mjs`. **Gap:** Automatic eligible FIFO promotion exists; notifications, offer acceptance policy and expiry are absent.

- **MSG-005 — Twilio SMS delivery and replies.** **Status:** missing. **Acceptance evidence:** Send a studio SMS to a controlled real number after provider setup, reply to it and receive delivery events; reject a forged webhook and inspect cost/status without claiming submission proves receipt. **Gap:** No implemented twilio sms delivery and replies workflow or public-door acceptance coverage.

- **MSG-006 — Postmark transactional email.** **Status:** missing. **Acceptance evidence:** Verify a sender, deliver a booking email to a controlled inbox, reply through the supported inbound route and process bounce/complaint events; member history shows each outcome and failed sender setup cannot show sent. **Gap:** No implemented postmark transactional email workflow or public-door acceptance coverage.

- **MSG-007 — Native push notifications.** **Status:** missing. **Acceptance evidence:** Opt into push on each platform, receive a waitlist alert, open its booking, sign out and revoke permission; subsequent pushes cannot expose another member's data. **Gap:** No implemented native push notifications workflow or public-door acceptance coverage.

- **MSG-008 — Consent suppression and quiet hours.** **Status:** missing. **Acceptance evidence:** Queue a marketing sequence, receive a signed STOP webhook before dispatch, run the queue and synchronize Mailchimp; no suppressed SMS sends, the opt-out is visible and re-entry requires new permission. Schedule a marketing SMS for a member whose local quiet hours are in effect and verify it is held and delivered once when the window opens. **Gap:** No implemented consent suppression and quiet hours workflow or public-door acceptance coverage.

- **MSG-009 — One-off segmented announcements.** **Status:** missing. **Acceptance evidence:** Send an email and an SMS announcement to active members at one location, a segment that includes an SMS-opted-out member and a member in quiet hours; the previewed count equals the sends, the opted-out member receives nothing, the quiet-hours SMS is held until the window opens, the scheduled send goes at its time, each recipient's outcome appears in member history and a booking from a clicked link is attributed to the announcement. **Gap:** No announcement composer, segment builder, scheduled send or campaign outcome tracking exists.

- **AUTO-001 — Controlled automation operations.** **Status:** missing. **Acceptance evidence:** Preview and enable an intro sequence and renewal rule, pause while work is queued, restart and change membership state; only currently authorized work runs, with a visible reason for every skip or exception. **Gap:** No implemented controlled automation operations workflow or public-door acceptance coverage.

## Member and staff applications

- **APP-001 — Branded iOS and Android member apps.** **Status:** missing. **Acceptance evidence:** Install the branded app through iOS TestFlight and Android testing distribution, sign up, buy a plan, sign a waiver, choose a reformer, book and receive a push; repeat the core journey on both platforms. **Gap:** No implemented branded ios and android member apps workflow or public-door acceptance coverage.

- **APP-002 — Embedded website booking and checkout.** **Status:** missing. **Acceptance evidence:** Embed on an allowed studio domain, select a class signed out, complete signup, waiver and checkout and return to that booking; reject an unapproved embedding origin and expired session. **Gap:** No implemented embedded website booking and checkout workflow or public-door acceptance coverage.

- **APP-003 — Member account self-service.** **Status:** partial. **Acceptance evidence:** On a 390-pixel phone view and desktop update a profile, book/cancel, replace a card and request a freeze; verify the owner sees the same state and another member sees none of it. **Current evidence:** `src/strap/ui/index.ts`; `src/strap/ui/classes.ts`; `src/strap/ui/packs.ts`; `src/strap/domain/index.ts`; `tests/strap.test.mjs`. **Gap:** Own bookings and pack/payment views exist; profile editing, payment-method management and membership lifecycle self-service are absent.

- **APP-004 — Mobile instructor and front-desk work.** **Status:** partial. **Acceptance evidence:** At 390 pixels check a roster and member in, book a phoned-in member and sell a drop-in with Tap to Pay, disconnect during another check-in, reconnect after a booking change and resolve the conflict without a false saved indicator or extra credit debit. **Current evidence:** `src/strap/ui/classes.ts`; `src/strap/ui/index.ts`; `src/strap/domain/bookings.ts`; `tests/strap.test.mjs`. **Gap:** Responsive assigned-instructor roster and check-in exist; tested mobile journeys, offline reconciliation, substitutions, inbox and pay history are absent.

- **APP-005 — Accessible and resilient interaction.** **Status:** missing. **Acceptance evidence:** Run an automated WCAG 2.2 AA audit (axe-core) over every member and staff page with zero violations, and complete signup-to-booking with keyboard and a screen reader at desktop and phone widths; interrupt payment and a save, then recover while preserving choices and showing the real final state. **Gap:** No implemented accessible and resilient interaction workflow or public-door acceptance coverage.

## Distribution and digital classes

- **CHANNEL-001 — ClassPass inventory and rosters.** **Status:** missing. **Acceptance evidence:** Complete ClassPass partner onboarding, publish selected inventory, reserve the last seat concurrently from both channels, cancel and reconcile the roster and settlement report; no duplicate seat or retail pack debit occurs. **Gap:** No implemented classpass inventory and rosters workflow or public-door acceptance coverage.

- **CHANNEL-002 — Wellhub corporate-wellness access.** **Status:** missing. **Acceptance evidence:** Connect a Wellhub partner test or approved controlled account, book and check in an eligible participant, deny an ineligible visit, cancel another and reconcile roster and reimbursement references. **Gap:** No implemented wellhub corporate-wellness access workflow or public-door acceptance coverage.

- **CHANNEL-003 — Livestream classes with Zoom.** **Status:** missing. **Acceptance evidence:** Book a hybrid Zoom class, receive an authenticated join link, cancel and attempt reuse; an entitled attendee joins while an unauthorized account is refused and recording stays unpublished until approved. **Gap:** No implemented livestream classes with zoom workflow or public-door acceptance coverage.

- **CHANNEL-004 — On-demand video memberships.** **Status:** missing. **Acceptance evidence:** Publish a captioned Mux-hosted class to one plan, watch on phone and desktop, revoke membership and verify access expiry; watch history appears separately from class attendance. **Gap:** No implemented on-demand video memberships workflow or public-door acceptance coverage.

## Staff retail operations and reporting

- **STAFF-001 — Manager front-desk instructor and finance rights.** **Status:** partial. **Acceptance evidence:** Invite each role at two locations and exercise every permitted workflow plus direct unauthorized API/download attempts, including a full-class booking by front desk with and without the override right; revoke a scope and verify the next request loses it. **Current evidence:** `src/strap/domain/store.ts`; `src/strap/domain/index.ts`; `src/strap/domain/bookings.ts`; `tests/strap.test.mjs`. **Gap:** Owner/member/instructor isolation ships; manager, front-desk, finance, location scopes and granular rights do not.

- **STAFF-002 — Instructor rates and teaching pay.** **Status:** missing. **Acceptance evidence:** Teach full, low-attendance, cancelled and substituted classes under different rules; correct one attendance record and compare the pay report with the versioned calculation and authorized adjustment. **Gap:** No implemented instructor rates and teaching pay workflow or public-door acceptance coverage.

- **STAFF-003 — Time clock and approved hours.** **Status:** missing. **Acceptance evidence:** Clock two shifts, miss a clock-out, request a correction and approve it; export approved hours only and verify another location's manager cannot approve them. **Gap:** No implemented time clock and approved hours workflow or public-door acceptance coverage.

- **STAFF-004 — US payroll handoff.** **Status:** missing. **Acceptance evidence:** Approve one pay period, export W-2 wages, 1099 teaching compensation, commissions and tips, import into a Gusto test workflow and reconcile worker IDs, hours, rates and totals without initiating unapproved payroll. **Gap:** No implemented us payroll handoff workflow or public-door acceptance coverage.

- **STAFF-005 — Sales commissions and tips.** **Status:** missing. **Acceptance evidence:** Attribute a membership sale and a retail sale to one staff member under an item-level and a staff-level commission rate, refund part of the retail sale and take a tip on a private session at POS; compare the pay-period report and the Gusto export line by line with the expected commissions, reversal and tip. **Gap:** No sales attribution, commission rules, reversals or tip records exist.

- **RPT-001 — Revenue collections and member trends.** **Status:** missing. **Acceptance evidence:** Run a month of purchases, cancellations, returned ACH and refunds, filter the dashboard and drill each total to its ledger; independent sums of those records match the report. **Gap:** No implemented revenue collections and member trends workflow or public-door acceptance coverage.

- **RPT-002 — Occupancy demand and attendance.** **Status:** missing. **Acceptance evidence:** Fill and partly attend classes with disabled reformers, a waitlist and a cancellation, then inspect each denominator and drill to rosters and source bookings. **Gap:** No implemented occupancy demand and attendance workflow or public-door acceptance coverage.

- **RPT-003 — Retention and renewal cohorts.** **Status:** missing. **Acceptance evidence:** Import an 18-month member history, renew and cancel plans after cutover and inspect continuous cohorts; drill churn and recovered renewals to original and new contract/payment evidence. **Gap:** No implemented retention and renewal cohorts workflow or public-door acceptance coverage.

- **RPT-004 — Cash earned revenue and liabilities.** **Status:** missing. **Acceptance evidence:** Sell an annual plan, ten-pack and gift card, consume some value and refund part; monthly cash/earned/deferred totals reconcile to invoices, entitlements and recognized service periods. **Gap:** No implemented cash earned revenue and liabilities workflow or public-door acceptance coverage.

- **RPT-005 — Lead intro and campaign conversion.** **Status:** missing. **Acceptance evidence:** Create leads from two channels, run an intro campaign, convert one and lapse another; funnel stages, spending and attributed revenue drill to the recorded events without inventing a conversion. **Gap:** No implemented lead intro and campaign conversion workflow or public-door acceptance coverage.

- **RPT-006 — Report exports and scheduled delivery.** **Status:** missing. **Acceptance evidence:** Download and open a month's CSV/XLSX in a spreadsheet, compare row totals with the dashboard and receive its scheduled email; remove a recipient's rights and confirm the next delivery is blocked. **Gap:** No implemented report exports and scheduled delivery workflow or public-door acceptance coverage.

## Named integrations and developer access

- **INT-001 — QuickBooks Online accounting sync.** **Status:** missing. **Acceptance evidence:** Connect a QBO sandbox, map a pack and retail SKU, sync a month and rerun it; no duplicates appear, AR/liabilities/payout totals agree and a missing mapping enters an actionable queue. **Gap:** No implemented quickbooks online accounting sync workflow or public-door acceptance coverage.

- **INT-002 — Google Calendar schedule publication.** **Status:** missing. **Acceptance evidence:** Connect Google Calendar, book and reschedule a class, cancel it and verify calendar changes and timezone; editing the external event leaves the authoritative booking unchanged. **Gap:** No implemented google calendar schedule publication workflow or public-door acceptance coverage.

- **INT-003 — Kisi membership-linked access.** **Status:** missing. **Acceptance evidence:** Connect a controlled Kisi site, activate, freeze and cancel a plan, interrupt the connector and verify desired versus confirmed door state and an actionable exception rather than a false revoked indicator. **Gap:** No implemented kisi membership-linked access workflow or public-door acceptance coverage.

- **INT-004 — HybridAF membership-linked access.** **Status:** missing. **Acceptance evidence:** Connect a controlled HybridAF site, grant access, expire a plan and replay the update; one correct grant/revocation results and an unavailable provider stays visibly unresolved. **Gap:** No implemented hybridaf membership-linked access workflow or public-door acceptance coverage.

- **INT-005 — Mailchimp consent-aware audiences.** **Status:** missing. **Acceptance evidence:** Sync intro and lapsed segments to a Mailchimp test audience, unsubscribe externally, resync and run a campaign; the unsubscribed member remains suppressed and is not silently re-added. **Gap:** No implemented mailchimp consent-aware audiences workflow or public-door acceptance coverage.

- **INT-006 — Meta lead ads and conversion tracking.** **Status:** missing. **Acceptance evidence:** Submit a Meta test lead, purchase an intro and membership, replay callbacks and inspect one deduplicated conversion each; turn off ad consent and verify no disallowed tracking payload. **Gap:** No implemented meta lead ads and conversion tracking workflow or public-door acceptance coverage.

- **INT-007 — Google Analytics booking attribution.** **Status:** missing. **Acceptance evidence:** With and without analytics consent, complete widget checkout and inspect GA4 DebugView; consented events appear once with matching transaction value and no identifying payload fields. **Gap:** No implemented google analytics booking attribution workflow or public-door acceptance coverage.

- **INT-008 — Zapier and signed outbound events.** **Status:** missing. **Acceptance evidence:** Trigger a booking and lead in a Zapier test connection, receive signed events, replay them and submit an allowed action; inspect idempotence and refusal of refund approval. **Gap:** No implemented zapier and signed outbound events workflow or public-door acceptance coverage.

- **INT-009 — Google Business Profile booking.** **Status:** missing. **Acceptance evidence:** Add the booking link to a test Google Business Profile, follow it signed out, buy an intro offer and see the lead and conversion attributed to Google; with a Reserve with Google feed enabled, book the last online seat from Google and from the app concurrently and verify one booking. **Gap:** No Google Business Profile link attribution or Reserve with Google feed exists.

- **API-001 — Authenticated studio HTTP interface.** **Status:** done. **Acceptance evidence:** Read authenticated state, perform a member booking, prepare a pack with a bearer key, refuse its approval and revoke it through the owner interface. **Current evidence:** `src/strap/http.ts`; `src/strap/credentials.ts`; `tests/strap.test.mjs`.

- **API-002 — Scoped integration lifecycle.** **Status:** partial. **Acceptance evidence:** Create a read-roster integration for one location, traverse paginated results, attempt financial data and writes, rotate/revoke the key and inspect failures and rate-limit behavior. **Current evidence:** `src/strap/credentials.ts`; `src/strap/http.ts`; `tests/strap.test.mjs`. **Gap:** Revocable preparation credentials exist; granular integration scopes, pagination, schema lifecycle and rate-limit journeys are absent.

## Move-in and portability

- **MOVE-001 — Mindbody studio migration.** **Status:** partial. **Acceptance evidence:** Use a sanitized real Mindbody export set from a consenting studio, preview per-file mappings and unsupported fields, apply, reconcile every record class and opening value, then book a migrated member and run a shadow renewal. **Current evidence:** `src/strap/movein/csv.ts`; `src/strap/movein/index.ts`; `tests/strap.test.mjs`. **Gap:** Only a synthetic four-column member CSV is supported; actual Mindbody exports, billing, balances, bookings, waiver files and shadow renewal are unverified or absent.

- **MOVE-002 — WellnessLiving studio migration.** **Status:** missing. **Acceptance evidence:** Preview a consenting studio's real WellnessLiving files, map plans and families, resolve one unsupported field, apply and compare member/visit/due totals and future reservations before approving cutover. **Gap:** No implemented wellnessliving studio migration workflow or public-door acceptance coverage.

- **MOVE-003 — Vagaro studio migration.** **Status:** missing. **Acceptance evidence:** Upload a sanitized real Vagaro data package, match clients to packages and contracts, preserve signed forms and reconcile future class seats, remaining sessions and next dues; reject a missing mandatory balance rather than silently invent it. **Gap:** No implemented vagaro studio migration workflow or public-door acceptance coverage.

- **MOVE-004 — Momence studio migration.** **Status:** missing. **Acceptance evidence:** Import a real Momence export package with an intro, frozen plan and credit pack; compare the next bill, credit expiry, waiver provenance and booked class roster and require resolution of unsupported terms. **Gap:** No implemented momence studio migration workflow or public-door acceptance coverage.

- **MOVE-005 — Arketa studio migration.** **Status:** missing. **Acceptance evidence:** Move a consenting Arketa studio with in-person, livestream and video memberships, reconcile its members, open credits and recurring dates and verify each migrated member's entitled services without publishing unlicensed media. **Gap:** No implemented arketa studio migration workflow or public-door acceptance coverage.

- **MOVE-006 — PushPress studio migration.** **Status:** missing. **Acceptance evidence:** Import a real PushPress package, including appointment sessions and a failed invoice, compare opening balances and the next billing schedule, then repeat import and verify no duplicated credit or collection. **Gap:** No implemented pushpress studio migration workflow or public-door acceptance coverage.

- **MOVE-007 — Processor-coordinated payment-method transfer.** **Status:** missing. **Acceptance evidence:** Complete a provider-approved transfer rehearsal or controlled transfer, reconcile source customers to destination methods, document unsupported ACH mandates and complete secure re-entry; a dry-run renewal identifies every collectible and blocked account without raw payment data in exports. **Gap:** No implemented processor-coordinated payment-method transfer workflow or public-door acceptance coverage.

- **MOVE-008 — Opening credit and liability reconciliation.** **Status:** missing. **Acceptance evidence:** Migrate a studio with partial packs, appointment credits, gift cards, a debt and an overpayment; compare both ledgers and approve a reasoned adjustment; one unresolved member cannot become a silent zero. **Gap:** No implemented opening credit and liability reconciliation workflow or public-door acceptance coverage.

- **MOVE-009 — Historical records waivers and consent.** **Status:** missing. **Acceptance evidence:** Import a year of history and waiver PDFs with consent records, inspect continuous member history and reports, and run schedulers; no historical charge or message is replayed and an unverified waiver requires renewal. **Gap:** No implemented historical records waivers and consent workflow or public-door acceptance coverage.

- **MOVE-010 — Rehearsal cutover and safe rollback.** **Status:** missing. **Acceptance evidence:** Rehearse, refresh changed exports, resolve conflicts and approve cutover; simulate a failed processor setup and roll back untouched work while preserving native bookings, with no simultaneous old/new renewal. **Gap:** No implemented rehearsal cutover and safe rollback workflow or public-door acceptance coverage.

- **MOVE-011 — Usable exit exports and recovery.** **Status:** partial. **Acceptance evidence:** Download the exit bundle and native archive from a populated studio, reconstruct relationships in a fresh receiver, compare totals and documents and confirm no outbound collection or message occurs before reconnection approval. **Current evidence:** `src/strap/archive-policy.mjs`; `tests/archive.test.mjs`. **Gap:** Native archive round trip is tested; neutral CSV/JSON/document bundles, media exports and paused provider reconnection are absent.

## Security custody and operating boundaries

- **SEC-001 — Private records and operational recovery.** **Status:** partial. **Acceptance evidence:** Deploy to a controlled studio account, exercise role-separated exports and provider failure diagnostics, inspect logs for planted secrets and restore a backup to a recovery installation. **Current evidence:** `src/strap/http.ts`; `src/strap/credentials.ts`; `src/strap/archive-policy.mjs`; `tests/archive.test.mjs`. **Gap:** Private route checks and credential exclusion exist; hosted secret/logging assurance, granular export rights and integrated recovery diagnostics are unproved.

- **SEC-002 — Durable staff and automation audit.** **Status:** partial. **Acceptance evidence:** Change staff rights, correct attendance, run a renewal and approved refund, export and erase a member; inspect the complete ordered audit and verify agents and staff cannot rewrite it. **Current evidence:** `src/strap/domain/drafts.ts`; `src/strap/movein/index.ts`; `tests/strap.test.mjs`. **Gap:** Draft approvals and import journals exist; comprehensive action auditing, search/export and erasure-aware retention do not.

- **SEC-003 — Member erasure and retention controls.** **Status:** partial. **Acceptance evidence:** Request a used member's export and erasure, resolve an outstanding invoice, verify redaction of notes, waivers and provider links under the chosen policy, retain justified financial evidence and refuse resurrection with an old backup and later journal. **Current evidence:** `src/strap/domain/people.ts`; `src/strap/archive-policy.mjs`; `tests/strap.test.mjs`; `tests/archive.test.mjs`. **Gap:** Unused-identity erasure and a backup fence ship; used/imported-member requests, document deletion, retention policy and provider erasure are absent.

- **SEC-004 — Multi-factor sign-in for privileged roles.** **Status:** missing. **Acceptance evidence:** Invite a finance user and attempt a payout report before enrolment (refused); enrol a passkey and a TOTP app and sign in with each; use one recovery code twice (second refused); have one owner reset another's factor and inspect the audit record. **Gap:** Sign-in uses invitation links and sessions only; no second factor, recovery codes or audited reset exists.

- **BOUNDARY-001 — Payments tax and payroll custody.** **Status:** missing. **Acceptance evidence:** Complete a studio purchase, tax calculation, pay export and ledger handoff; verify each provider reference and pending/failed outcome is visible without claiming Strap holds funds, files taxes or completed unapproved payroll. **Gap:** No implemented payments tax and payroll custody workflow or public-door acceptance coverage.

- **BOUNDARY-002 — Studio scope and neighboring products.** **Status:** missing. **Acceptance evidence:** From a studio member or invoice open a linked Orbit/Nectar/Inkwell record through a permitted integration and verify permissions and source ownership; a handoff never creates a second conflicting studio balance. **Gap:** No implemented studio scope and neighboring products workflow or public-door acceptance coverage.

- **BOUNDARY-003 — Specialist instruction and health boundaries.** **Status:** missing. **Acceptance evidence:** Export a permissioned participant and enrollment as a Zen Planner member-import CSV, import it into a Zen Planner trial account and link its progress record back; restricted intake stays private and no medical, school or specialist-progress parity is asserted. **Gap:** No implemented specialist instruction and health boundaries workflow or public-door acceptance coverage.

- **BOUNDARY-004 — Partner delivery and portability evidence.** **Status:** missing. **Acceptance evidence:** Inspect a controlled launch with store distribution, aggregator onboarding and live delivered messages; interrupt one provider and block one token transfer, then verify the unresolved states and member reauthorization path are visible. **Gap:** No implemented partner delivery and portability evidence workflow or public-door acceptance coverage.

## Push further

- **SUCCESS-001 — Detect explainable attendance drop-off.** **Status:** missing. **Acceptance evidence:** Run an approved member journey through public booking/attendance doors, remove visits for one routine and freeze another member; inspect cited risk reasons, no false freeze alert and no message without permitted policy. **Gap:** No implemented detect explainable attendance drop-off workflow or public-door acceptance coverage.

- **SUCCESS-002 — Offer a workable attendance plan.** **Status:** missing. **Acceptance evidence:** Give a member a narrow available schedule and no entitlement to reformer classes; inspect only eligible available choices, accept one and verify the offered class remains feasible after a concurrent booking. **Gap:** No implemented offer a workable attendance plan workflow or public-door acceptance coverage.

- **SUCCESS-003 — Book accepted help under human control.** **Status:** missing. **Acceptance evidence:** Accept a suggested class, fill its last seat concurrently and verify a truthful conflict or single booking; request a freeze and refund and require explicit human approval with a recheck before execution. **Gap:** No implemented book accepted help under human control workflow or public-door acceptance coverage.

- **SUCCESS-004 — Measure recovered visits and renewals.** **Status:** missing. **Acceptance evidence:** Run an approved attendance-recovery campaign, record later visits and one failed renewal, compare observed and collected outcomes with source events and inspect an inconclusive small cohort without a fabricated success claim. **Gap:** No implemented measure recovered visits and renewals workflow or public-door acceptance coverage.

- **SUCCESS-005 — Recover billing without breaking access.** **Status:** missing. **Acceptance evidence:** Return an ACH debit after apparent success, ask for recovery help and inspect the provider-grounded explanation, correct debt/access and a secure update link; refuse an agent attempt to waive the balance. **Gap:** No implemented recover billing without breaking access workflow or public-door acceptance coverage.

- **SUCCESS-006 — Balance demand and instructor coverage.** **Status:** partial. **Acceptance evidence:** Create overfilled and underused classes through public doors, provide instructor availability and request a recommendation; review its cited demand, change availability before approval and require a fresh preview. **Current evidence:** `src/strap/domain/index.ts`; `src/strap/domain/classes.ts`; `src/strap/http.ts`; `tests/strap.test.mjs`. **Gap:** Agent-readable schedules and human-reviewed drafts exist; demand analysis, staff availability and recommendation evaluation are absent.

- **SUCCESS-007 — Make cutover reconcile.** **Status:** partial. **Acceptance evidence:** Upload a real source package with duplicate names, a missing pack balance and an unsupported payment method; inspect cited proposed matches, resolve ambiguities and require owner sign-off before any collection. **Current evidence:** `src/strap/movein/csv.ts`; `src/strap/movein/index.ts`; `src/strap/ui/import.ts`; `tests/strap.test.mjs`. **Gap:** Reviewed member mappings and import journals exist; cross-record reconciliation, agent matching and cutover/processor analysis are absent.

- **SUCCESS-008 — Resolve routine member enquiries.** **Status:** missing. **Acceptance evidence:** Ask about credits, a class time and a freeze by SMS and in-app, change the source schedule mid-conversation and verify grounded updated answers, approved booking actions and human escalation for the freeze and refund. **Gap:** No implemented resolve routine member enquiries workflow or public-door acceptance coverage.

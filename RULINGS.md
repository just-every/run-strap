# Strap rulings

### RL-101 — Win-back campaigns and referrals

Date: 2026-10-28 · Ruled by: ct · Governs: `LEAD-005`.

**Question.** May private referral matching and once-only studio credit require verified attribution, actual renewal and attended service?

**Proposed/adopted default.** Private unverified member/front-desk referrals; owner verifies the actual request, one attribution per friend, no friend disclosure, budget reserved on finite renewal, negative balance reward after completed attendance and separate owner review.

**Outcome: adopt with rider.** Approve private submitted referral evidence, owner-verified attribution and a once-only reviewed noncash studio-credit reward within the explicitly approved campaign budget, without revealing the friend’s account, purchase or visit history to the referrer.

**Why.** No common norm for this exact reward trigger or verification process: Mindbody documents configured campaigns with opt-out and eligibility stops, while WellnessLiving permits configurable referral points and automatic awards. Manual verified credit after real attendance is the chosen conservative default, not an incumbent-wide mandatory trigger.

**Rider.** Keep one durable attribution/reward identity across campaigns and cancellation, recheck current source eligibility and remaining budget at reservation and posting, and require fresh reviewed authority for any broader reward, payout or outbound campaign; scoped staff submission remains STAFF-001 work.

**Place once.** LEAD-005 owns one referral verification/reward acceptance point; shared campaign consent cites MEM-006 and AUTO-001.

**Incumbent/source behavior.**

- [Mindbody’s configured marketing automation stops on opt-out, purchase, visit or other loss of eligibility.](https://support.mindbodyonline.com/s/article/understanding-campaigns-and-automations-Frederick?language=en_US)
- [WellnessLiving permits studio-configured referral points and qualifying purchases, with automatic referral awards.](https://www.wellnessliving.com/blog/january-2018-release-notes/)

**Engineering/proof distinction.** Studio credit is not processor settlement or a cash payout; broader staff rights and transport remain engineering.

Main reference: `CONTRACT.md:198` at `cde1c45311e831cb37b22295b7ca200e9031eed3`; current Status Gap read in full. Route: `round`.

### RL-102 — Empty-place outreach

Date: 2026-10-28 · Ruled by: ct · Governs: `LEAD-007`.

**Question.** May empty-seat offers reserve an incentive on acceptance and post noncash credit only after attended completion and separate review?

**Proposed/adopted default.** Approved in-app invitations only; no automatic external send; atomic incentive reservation on acceptance; once-only negative balance after completed attendance and owner review; no collection or cash payout.

**Outcome: adopt with rider.** Approve exact reviewed in-app empty-seat offers with waitlist priority, current consent and capacity checks, atomically reserved budget and a once-only reviewed studio-credit incentive after the class ends with completed attendance.

**Why.** Mindbody documents waitlist notifications and explicit reservation permissions; WellnessLiving allows configurable referral rewards. No common norm establishes this exact attendance-gated empty-seat incentive. Budget reservation before a possible reward and review before noncash posting is the chosen safe default.

**Rider.** An invitation holds no seat; all booking, waiver, entitlement and resource rules apply at acceptance, and a canceled reservation never recycles an old reward identity. Wider automation, incentives and scoped staff rights remain owed; any external send needs current reviewed channel authority.

**Place once.** LEAD-007 owns the capacity/incentive acceptance point and cites existing scheduling and campaign-consent rules.

**Incumbent/source behavior.**

- [Mindbody offers waitlist notices and separates staff reservation, cancellation and policy-override permissions.](https://www.mindbodyonline.com/business/education/product-waitlist-improvements)
- [WellnessLiving allows a business to choose referral reward amounts and qualifying events, including automatic awards.](https://www.wellnessliving.com/blog/january-2018-release-notes/)

**Engineering/proof distinction.** The approved bounded in-app component does not complete provider outreach or the full STAFF-001 matrix.

Main reference: `CONTRACT.md:202` at `cde1c45311e831cb37b22295b7ca200e9031eed3`; current Status Gap read in full. Route: `round`.

### RL-103 — Unified member history

Date: 2026-10-28 · Ruled by: ct · Governs: `MEM-001`.

**Question.** May the current duplicate workflow link history and retire source sign-in without transferring money, entitlements or consent?

**Proposed/adopted default.** Owner-only restricted notes/finances/history merge, scoped MFA-protected front desk, source sign-in retired, no transfer of balances, credits, waiver or consent authority.

**Outcome: adopt with rider.** Approve exact reviewed source-history linkage with unchanged financial ledgers, restricted owner notes/finances and explicitly scoped front-desk create/invite/contact operations, without deriving financial, booking, waiver or consent authority from a merge.

**Why.** Mindbody has separate duplicate-location/merge permissions and combines multiple histories. No common norm requires its full merge to imply a consent transfer, or Strap’s precise history-only behavior; preserving source evidence while avoiding identity-based authority transfer is a safe bounded default.

**Rider.** The receipt must identify retained/source identities and consequences before retiring sign-in, refuse changed facts and keep the original provenance; full unified history and STAFF-001 role/location breadth remain required, with separate authority review before adding any money or entitlement consolidation.

**Place once.** MEM-001 owns one reviewed history-link acceptance point and cites STAFF-001, MEM-006 and custody/erasure duties.

**Incumbent/source behavior.**

- [Mindbody separately grants locate-duplicates and merge-client permissions.](https://support.mindbodyonline.com/s/article/Staff-Permissions-Settings?language=en_US)
- [Mindbody combines visit, payment and contact histories under a reviewed duplicate merge.](https://support.mindbodyonline.com/s/article/203256053-Reports-explained?language=en_US)

**Engineering/proof distinction.** Wider staff rights and provider conversation history remain engineering; history linkage alone does not establish a completed money transfer.

Main reference: `CONTRACT.md:68` at `cde1c45311e831cb37b22295b7ca200e9031eed3`; current Status Gap read in full. Route: `round`.

### RL-104 — Member preferences and privacy choices

Date: 2026-10-28 · Ruled by: ct · Governs: `MEM-006`.

**Question.** May consent remain channel-specific and initially off, with confirmed unique-phone SMS opt-in, shared-phone STOP and protective quiet hours?

**Proposed/adopted default.** Initially denied marketing by channel; member-owned feedback/booking preferences; provenance for staff changes; unique-phone positive confirmation, shared-phone STOP, 20:00–10:00 SMS quiet hours, accessibility member/owner-only.

**Outcome: adopt with rider.** Approve separate marketing permissions, immediate opt-out and queued suppression, staff-recorded provenance without manufactured member consent, positive SMS confirmation only for one unambiguous mapped member, shared-phone STOP for every matching recipient and the stated local quiet-hour floor.

**Why.** Mindbody requires marketing-text consent and supports STOP-style withdrawal; its waitlist product separately permits operational notices. No common norm establishes a 20:00–10:00 floor, shared-phone confirmation model or accessibility visibility. The more protective ambiguity and disclosure defaults are selected product rules, not legal certification.

**Rider.** Consent renewal never revives an already suppressed invitation; maintain member-only feedback opt-in and restricted accessibility requests, permit stricter applicable channel restrictions, and do not bypass a provider-wide STOP merely by labelling a later SMS operational. Distinguish SMS, email and in-app authority rather than treating one channel as permission for another.

**Place once.** One member/channel-consent door rule in MEM-006, cited by MSG-005/008 and RPT-007; quiet-hour logic is stated once.

**Incumbent/source behavior.**

- [Mindbody describes consent-based marketing texts separately from service texts and provides STOP/END/QUIT withdrawal.](https://www.mindbodyonline.com/company/legal/sms-texting-terms)
- [Mindbody distinguishes waitlist operational SMS from other communication preferences and exposes explicit opt-out states.](https://www.mindbodyonline.com/business/education/product-waitlist-improvements)

**Engineering/proof distinction.** Provider transport and complete SMS integration remain MSG-005/008 proof. This approves product consent behavior, not a live messaging launch or legal sign-off.

Main reference: `CONTRACT.md:82` at `cde1c45311e831cb37b22295b7ca200e9031eed3`; current Status Gap read in full. Route: `round`.

### RL-105 — Intro offers and eligibility

Date: 2026-10-28 · Ruled by: ct · Governs: `PLAN-004`.

**Question.** May verified person/household links restrict intro eligibility without transferring any household or payment authority?

**Proposed/adopted default.** Owner verifies additive same-person/household links and reasoned price-right exceptions; deny unverified eligibility; links remain private, retain eligibility fences and never renew or collect automatically.

**Outcome: adopt with rider.** Approve explicit private verification of same-person/household eligibility across accounts, with exact offer/source review and attributed exceptions; a link restricts duplicate intro eligibility and grants no sign-in, profile, booking, payer, waiver or recurring-payment authority.

**Why.** Mindbody documents new-customer introductory promotions and separate staff settings/merge permissions. No common norm establishes owner-only household verification or lifelong cross-offer links. Exact explicit verification without authority transfer is the chosen safe default for the seed’s stated duplicate-eligibility target.

**Rider.** Preserve only the minimum eligibility linkage required by SEC-003’s retention/erasure policy, disclose the reason for denial to authorized reviewers without exposing another person’s account, and retain delegated front-desk/manager sale and exception rights as STAFF-001 obligations; an intro expiry cannot imply accepted recurring terms.

**Place once.** PLAN-004 owns one eligibility-link acceptance point and cites STAFF-001, MEM-002 and SEC-003.

**Incumbent/source behavior.**

- [Mindbody describes introductory offers as new-customer promotions selected by the business.](https://www.mindbodyonline.com/en-gb/education/blog/how-to-intro-an-offer-they-cant-refuse)
- [Mindbody gives staff distinct administration and duplicate-client permissions rather than treating all staff as one authority.](https://support.mindbodyonline.com/s/article/Staff-Permissions-Settings?language=en_US)

**Engineering/proof distinction.** Provider checkout, wider household authority and delegated sale/price rights are implementation gaps, not a new owner policy decision.

Main reference: `CONTRACT.md:92` at `cde1c45311e831cb37b22295b7ca200e9031eed3`; current Status Gap read in full. Route: `round`.

### RL-106 — Upcoming plan endings and renewal worklist

Date: 2026-10-28 · Ruled by: ct · Governs: `RPT-007`.

**Question.** May the renewal worklist enroll only exact reviewed native sequences under current channel consent while external transport remains unavailable?

**Proposed/adopted default.** Owner previews/approves exact native sequence and enrolls eligible source packs once; each queue review rechecks source/permission/pause/quiet hours; at most one native in-app message and no provider email/SMS claim.

**Outcome: adopt with rider.** Approve current source-bound native renewal enrollment and private once-only follow-up tasks, with exact reviewed sequence authority and the channel-consent rule in Strap RL-104; a renewal, opt-out, pause or changed source stops the ineligible queued effect.

**Why.** Mindbody supports configured renewal/prospect-style automations with eligibility and opt-out stops. Its scheduled provider delivery is broader than Strap’s explicit native review: the current no-provider component is safe, but not the permanent automation target.

**Rider.** A standing explicitly reviewed sequence may authorize only its stated bounded messages; no new per-step owner approval requirement is inferred for the final automation product. External renewal delivery, provider-autopay endings and scoped staff workflow remain required under AUTO-001/STAFF-001.

**Place once.** RPT-007 owns enrollment/source-parity acceptance; cite MEM-006’s single consent rule (RL-104) and AUTO-001 instead of duplicate consent text.

**Incumbent/source behavior.**

- [Mindbody runs configured communication sequences automatically and stops them when the client opts out or becomes ineligible.](https://support.mindbodyonline.com/s/article/understanding-campaigns-and-automations-Frederick?language=en_US)

**Engineering/proof distinction.** Provider-autopay ending coverage, actual email/SMS delivery and full staff rights remain engineering/proof work.

Main reference: `CONTRACT.md:323` at `cde1c45311e831cb37b22295b7ca200e9031eed3`; current Status Gap read in full. Route: `round`.

### RL-1 — MEM-003 retained product ruling

Date: 2026-10-23 · Ruled by: ct · Governs: `MEM-003`.

Ct approved these native semantics with riders on 23 October 2026; SEC-003 must retain anonymized tuition chronology before used-member erasure ships; MEM-002, BILL-002, BILL-004, BILL-005 and BILL-014, STAFF-001, SEC-002, SEC-003 and MOVE-009 inherit exact payer consent, original participant allocations, scoped history and no retroactive repricing before new doors ship.

### RL-2 — MEM-003 retained product ruling

Date: 2026-10-23 · Ruled by: ct · Governs: `MEM-003`.

Native monthly schedules, exact payer acceptance, sibling discounts, participant credit grants, external receipt recording and future-only withdrawal ship under the ct ruling of 23 October 2026.

### RL-3 — MEM-004 retained product ruling

Date: 2026-10-23 · Ruled by: ct · Governs: `MEM-004`.

Ct approved these native semantics with riders on 23 October 2026; immutable form versions, separate audited sensitive-notes rights and signed-out one-use tablet handoffs confer no legal signing or payment authority; MEM-001, MEM-002 and MEM-005, SCHED-002, SCHED-012 and SCHED-013, BILL-002 and BILL-014, STAFF-001, SEC-002 and SEC-003 and MOVE-009 inherit exact versions, scoped reads, provenance and nontransfer of signing or payment authority before new doors ship.

### RL-4 — MEM-005 retained product ruling

Date: 2026-10-26 · Ruled by: ct · Governs: `MEM-005`.

CT policy ruling, 26 October 2026: APPROVE WITH RIDERS for the bounded account-less personal-copy default; MEM-005 remains PARTIAL.

### RL-5 — PLAN-006 retained product ruling

Date: 2026-10-22 · Ruled by: ct · Governs: `PLAN-006`.

Semantics (ct ruling 22 Oct): the native owner defines freeze types and approves exact requests or direct staff freezes under the contract-change right until STAFF-001.

### RL-6 — PLAN-007 retained product ruling

Date: 2026-10-22 · Ruled by: ct · Governs: `PLAN-007`.

Semantics (ct ruling 22 Oct): the member, the payer or a minor's guardian cancels online in one step with no reason, approval, retention gate or fee (the BILL-005 stop); access ends at the current paid term end, including freeze-added days.

### RL-7 — SCHED-002 retained product ruling

Date: 2026-10-25 · Ruled by: ct · Governs: `SCHED-002`.

*Tier:* Core **Requirement.** Ct ruling of 25 October 2026, 18:50Z: the current private appointment-offer foundation is native human owner only.

### RL-8 — SCHED-009 retained product ruling

Date: 2026-10-22 · Ruled by: ct · Governs: `SCHED-009`.

Semantics (ct ruling 22 Oct): only the owner configures eligible service, minimum pre-start notice and expiry in elapsed days after the original class.

### RL-9 — SCHED-012 retained product ruling

Date: 2026-10-25 · Ruled by: ct · Governs: `SCHED-012`.

Ct approved this partial slice on 25 October 2026: owner-only access, immutable first attribution and no implied marketing consent, reward or extra outbound action; STAFF-001, SEC-003 and LEAD-001 inherit scoped access, used-person retention and identity matching before their new doors ship.

### RL-10 — SCHED-012 retained product ruling

Date: 2026-10-25 · Ruled by: ct · Governs: `SCHED-012`.

Ct approved the private inquiry slice on 25 October 2026: owner-only guest inquiry and booking-source records, immutable first attribution, and no marketing permission, reward or extra outbound action.

### RL-11 — SCHED-013 retained product ruling

Date: 2026-10-27 · Ruled by: ct · Governs: `SCHED-013`.

Ct approved these expanded conservative defaults with riders on 27 October 2026; STAFF-001, SCHED-005, SCHED-014 and SCHED-015 retain their original inherited obligations.

### RL-12 — SCHED-013 retained product ruling

Date: 2026-10-27 · Ruled by: ct · Governs: `SCHED-013`.

CT policy ruling, 27 October 2026: APPROVE WITH RIDERS; SCHED-013 remains PARTIAL.

### RL-13 — BILL-005 retained product ruling

Date: 2026-10-22 · Ruled by: ct · Governs: `BILL-005`.

Semantics (ct ruling 22 Oct): the native foundation proposes an exact member-accepted studio-invoice agreement on an existing pack: one invoice, renewed entitlement and balance charge per current due period, with no stored method or provider debit.

### RL-14 — BILL-014 retained product ruling

Date: 2026-10-26 · Ruled by: ct · Governs: `BILL-014`.

CT policy ruling, 26 October 2026: APPROVE WITH RIDERS for the additional immutable agreement and Stripe TEST card method-authorization foundation; BILL-014 remains PARTIAL.

### RL-15 — MSG-008 retained product ruling

Date: 2026-10-22 · Ruled by: ct · Governs: `MSG-008`.

Ct approved these native defaults on 22 October 2026 at 20:55Z, retaining PARTIAL: STOP suppresses every member sharing the phone; re-entry needs fresh permission and a unique member reply; the 20:00–10:00 floor cannot be shortened; each held send must recheck suppression when dispatch becomes possible; the owner reviews the queue and no automatic external dispatch is enabled.

### RL-16 — STAFF-001 retained product ruling

Date: 2026-10-27 · Ruled by: ct · Governs: `STAFF-001`.

CT policy ruling, 27 October 2026: APPROVE WITH RIDERS; STAFF-001 remains PARTIAL.

### RL-17 — RPT-004 retained product ruling

Date: 2026-10-26 · Ruled by: ct · Governs: `RPT-004`.

CT policy ruling, 26 October 2026: APPROVE WITH RIDERS for the provisional operational recognition default; RPT-004 remains PARTIAL.

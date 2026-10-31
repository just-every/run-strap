# People and access

Everyone who signs in to Strap is a person in **People**: your members and your instructors. The owner adds them, and
only the owner grants or ends access. The owner may grant the bounded member-record right described below.

## Add a person

Use **Add a person** with the person's full name, email, role (**Member** or **Instructor**) and status. People you
[move in](MOVE-IN.md) from a CSV arrive inactive; set them to **Active** when they are ready.

Search by name or email, and open a person to see their card: credits, what they owe, their last visit and upcoming
bookings, with **Edit** and **Prepare a pack**. When you [prepare a class week](classes.md) you pick each class's
instructor by name.

## Invite someone to sign in

Open an active person and press **Invite to sign in**. Strap emails them a sign-in link; after that they sign in with
their email whenever they like.

While Strap runs on your computer no email leaves it. Invitations land in **Local mail** instead. To try a member's view
yourself, open the private `RER_OPEN` link in a second browser profile, sign out there, then open the invitation from
**Local mail** in that profile.

## Member profiles

A member opens **My profile** to change their own name, mobile phone and emergency contact. Their sign-in email is
shown there, but only you change it, under **Sign-in and access** on their card.

When a member calls or comes to the desk, open them in People and use **Edit profile**. Choose how the request
arrived (front desk, phone or inbox) and save. Strap records who made each change, the channel and the exact before
and after values. You and the member see the same details and history under **Profile changes**. No other member
and no instructor can see a member's phone or emergency contact.

An emergency contact belongs to someone else, so it follows the member: it is in your backups and exit download, and
erasing the member removes it and keeps only who changed what and when.

## End someone's access

Open **Sign-in and access** on a member's card (or **Edit** for an instructor) and set their status to **Inactive**.
Their access ends on their next request, and their bookings and payment history stay on record.

## Erase personal data

**Erase personal data** is the shortcut for an unused identity. For a used or imported member, open **Privacy requests** on their card. Only the owner, with a verified second factor and privacy authority, can complete these requests. A manager's member-record permission does not grant privacy authority.

Record whether the request arrived in person, by phone or by email, then record the identity check. For an access request, download the member copy and separately confirm delivery to the verified person. Strap records the request, verification, download and delivery; downloading alone does not claim that the member received it. A changed identity requires a new verified request. The access copy excludes reusable payment credentials and other household members’ profiles; shared invoices show only the requesting participant’s allocations.

For erasure, settle the balance first, explicitly retain the obligation, or explicitly cancel positive outstanding debt. A credit owed to the member cannot be canceled: retain it or settle it through the ordinary payment process. Review the retention reason and date, choose whether to delete signed member evidence or keep it restricted, and explicitly approve ending account access. Future bookings must first be resolved through their ordinary cancellation doors, and future course enrollment through course withdrawal. A changed review must be prepared again.

The confirmed operation removes contact details, emergency contacts, restricted notes, personal sign-in links and imported source values. Original financial amounts and chronology remain under a redacted identity; an explicit debt cancellation adds a balancing entry. Shared household history keeps other people's obligations and accepted allocations. The erased member leaves active household and staff scopes, future family tuition ends for that person, and makeup authority is revoked without issuing another credit. Merged history retains the original source identifiers with personal values removed. Completed or withdrawn personal course enrollment keeps its redacted source records and installment amounts. Retired receipt references cannot be captured again through another payment door.

Retained affirmations and membership agreements are available only under **Studio → Privacy retention**. Each retained document has a stated reason and date. Personal-copy delivery metadata remains with the retained affirmation; old download capabilities do not. An optional hold records its basis, scope, actor, review date and release condition. Release a hold explicitly after its condition is satisfied; dispose of the document only after the retention date. Expiry never deletes evidence automatically. Retention settings record the studio's decision; they do not certify a legal retention period.

Unsupported related work is refused before anything is erased. Pending or uncertain provider work must be reconciled first. Supported local billing methods and recurring permissions are retired; financial receipts remain. Shared course payers, shared guardian signing and other unfinished record classes still require additional handling. Erasure does not delete data held by external providers, previously delivered copies or offline backups. Use a later erasure journal when restoring an older backup: the restore refuses resurrection. Erased identities cannot be recreated or imported again.

## Act for a member

Open a member in People. Under **Check-in code and key tag**, read their existing code or issue the first one; reading keeps the tag working. Replacing a lost tag is a separate action with a required reason. Under **Member waiver link**, review the exact current waiver and request the member’s secure sign-in link. The member signs in and acknowledges for themselves; a request never confirms delivery or acknowledgment. Under **Member notices**, mark a notice read for the named member. Its content stays unchanged and the member sees that staff marked it read. Choose how the request arrived (desk, phone or inbox). Staff action history retains each action’s right and before/after effect. Until staff roles ship, these controls belong to the native owner.

After a restore, staff waiver links stay paused with member email. Review and reconnect member email in Studio before requesting a new link; an old launch record never resends itself. Members can still request their own ordinary sign-in link.

## Find and download staff actions

In People, **Staff action history** shows recorded staff-made member actions, retained staff-access grants and revocations, and drawer count corrections and reopens. Select a person to focus on that member, then
filter by acting staff member, action right, channel, command and from/through date. Both date bounds include the whole day in the studio's
time zone. The newest event is first; event identity orders simultaneous events. Clear a field to include all its values.
Open **Recorded change** for the before and after effect and the retained actor, right, channel and reason. Access changes show their exact grant version and original source identity. Drawer changes retain their original session and source identity, count or status change and recorded reason. New changes retain the acting role; older missing roles, versions, channels or resulting snapshots remain explicitly unavailable. The view never substitutes current grants or drawer balances for historical facts.

**Download staff history CSV** and **Open staff history JSON** use the same filters. These are private owner downloads;
members, instructors and preparation agents cannot use them. Reads and downloads never create or rewrite history.
Existing unused-identity erasure keeps action provenance with personal before/after values removed. This history covers
current staff-made actions; it is not a complete studio audit, and it makes no new retention-policy claim.

For an authenticated native owner, `GET /api/strap/staff-history` returns `timeZone`, effective `filters` and ordered `rows`.
`GET /api/strap/staff-history.csv` downloads those same audit facts. Both accept `person`, `auditActor`, `auditRight`, `auditChannel`,
`auditCommand`, `auditFrom` and `auditTo`; dates use `YYYY-MM-DD`. Other values match exactly. CSV headers are plain
strings and data cells are JSON values, matching Strap's portable-exit convention; `before` and `after` contain JSON
text when present, and null when absent or erased. Only explicit audit fields are exported, without internal replay
payloads or command results. Keep these downloads private like your other studio records.

## Member-record staff and unified history

The owner grants **Member-record staff access** in People to a member sign-in identity, selects the exact member records it may open and separately allows creation. The person signs in again and enrolls a second factor. Front desk can create an active member profile from a phone or desk request, explicitly send its invitation once, and edit assigned contacts with before/after provenance. Repeating the same request never sends another invitation. Submission is recorded separately from delivery; an interrupted attempt remains uncertain. Changing or revoking a grant invalidates previous sessions and pending native invitation authority. Generic account-management routes remain closed to front desk.

**Unified member history** links dated packs, usage, bookings, attendance, waivers, native conversation messages, profile and staff changes, and the owner's original charge/receipt ledger. Front desk sees credits, bookings and attendance without prices, fees or payers. **My profile** includes the member's native conversation and reply. This is an in-app conversation, not an SMS or email inbox. Restricted notes and their check-in alerts are owner-only; front desk, members, instructors, kiosks and agents cannot read them.

Only the owner reviews duplicate identities. The preview names both identities and retained history; changed facts invalidate confirmation. Confirmation links history and retires the source sign-in. Original records, credits, money, waivers and consent keep their source identities; no authority transfers to the target. The owner cannot reactivate a retired source identity. This conservative merge and staff-scope policy awaits contract approval; it is not a promise of legal identity verification or automatic financial consolidation.

## Channel preferences and privacy

Members open **My profile → Channel preferences and privacy**. Marketing starts off independently for email, SMS and in-app messages. Booking email is separate: opting out preserves in-app notices, and only the member can reverse that choice. Sign-in/security, receipts, failed-payment and required legal messages retain their existing rules. Preferred classes/times and contact channels do not grant marketing permission. Accessibility requests remain visible only to the member and owner. The initially-off feedback choice is member-owned and authorizes no feedback delivery today.

Front desk changes assigned channel preferences with the member's stated permission and source reference. Opt-out suppresses queued and future marketing immediately. A verbal SMS opt-in stays pending until a valid signed reply from the member's uniquely matched phone confirms it. STOP suppresses all matching members for a shared phone; a positive reply on an ambiguous phone confirms nobody. START alone cannot reverse a STOP. The owner configures the Twilio consent callback separately; no SMS transport is included. External marketing synchronization is explicitly pending.

Members may remove their rows from existing roster and attendance integration keys. Re-enabling sharing requires a new recorded consent statement. The owner or authorized staff may export the preference record with its dated source history; other members, instructors and agents cannot. Exports and notes stay private.

Marketing texts are held during quiet hours, which always include 8 pm–10 am in the member's chosen time zone, or the studio's when none is chosen, and can be stricter. Quiet hours never hold in-app marketing or operational messages. These defaults, shared-phone confirmation and restricted-access rules await contract approval. No provider delivery or complete MSG-008 acceptance is claimed.

## Family tuition

Open **Family tuition**, choose a household whose payer has accepted responsibility for its studio balance, and enter each participant’s monthly rate and credits. Set the class service and first and end months (the end month is excluded). With two or more enrolled participants, the sibling percentage applies to each participant; each discount rounds half up to cents and discounts never stack.

Preview a month before billing it. The payer signs in, reviews each participant’s amount and credits, and accepts the exact total. Staff can launch that review but cannot accept it. Acceptance creates one bill, separate credits for each participant and charges only the payer’s studio balance. No card or bank payment is authorized or collected. Record money already received in **Packs and payments**, using a unique external receipt reference.

Withdraw a participant from a future unbilled month with the member’s request and a reason. The next preview recalculates the discount. Billed months, their charges and paid access stay unchanged. Every month needs its own exact payer acceptance; automatic collection is unavailable.

## Intake forms and restricted answers

Open **Intake forms** to publish an immutable question version for signup or a class service. A required form must be complete before new applicable enrollment; changing its version requires fresh completion. Past answers retain their original questions and dates. Optional forms never block enrollment, while required questions must be answered whenever that form is submitted.

Members complete forms in their own account. Front desk chooses an assigned member and records phone answers with the phone channel; the profile and audit show staff entry. A separate **Sensitive-notes access** grant is needed to read or enter restricted answers, in addition to the member-record grant. Changing either grant ends prior staff sessions; changing member-record scope requires a fresh sensitive grant. Instructors, agents and payers receive no restricted answers.

**Launch locked tablet intake** creates a private, one-use handoff for a dedicated signed-out tablet, expiring after 15 minutes. Open it on that device; a signed-in device is refused. It shows only the current questions, no earlier answers or account records. The participant affirms the displayed name, submits and hands the locked tablet back. The response records tablet-member affirmation and the launching staff identity; this is not native authenticated sign-in, a legal waiver signature or payment authorization. Keep the handoff private. Handoff credentials do not travel in backups, and a changed form or revoked staff authority makes an unused handoff unavailable.


## Gift desk and time approval rights

In Security, grant a location manager the separate **Time approval right**. Their assigned locations still bound every approval, including a replay. Revoking either the location scope or the approval right takes effect on the next request. A manager cannot approve their own shift; another owner can approve an owner's completed shift. Exports include only approved hours with no pending correction. Review reasons above eight shift hours or forty approved hours in the local starting week are human review flags, with no legal overtime or payroll transmission claim.

The owner command `retail.staff.grant` assigns native gift permissions using `personId`, `enabled`, `sale`, `refund`, `memberIds` and `locationIds`. The two rights are independent and start absent. A signed-in, factor-verified front-desk identity sees **Gift sales** only while an enabled grant has a sale or refund right. Only the named recipients and locations are visible; funding receipts remain private. The sale right supports native gift redemption and issue. Adjustment and original-funding refund require the refund right and a reason. Revocation also blocks a replay of an earlier request. These native records do not collect a provider payment or operate a connected reader.

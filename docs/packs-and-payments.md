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

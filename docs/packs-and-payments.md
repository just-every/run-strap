# Packs, credits and payments

A class pack gives a member credits to book with. Strap keeps two separate things for each member: the credits they can
spend on classes, and the money balance between what their packs cost and what they have paid you.

Strap never charges a card. You take payment the way you do today and record it here.

## Give a member a pack

Open **Packs and payments** and use **Prepare a pack**:

- **Person**: an active member.
- **Class credits**: how many classes the pack covers.
- **Pack amount (cents)**: the price in cents, so `18000` is $180.00.
- **Expiry**: when unused credits lapse, as a timestamp with a timezone, such as `2026-12-31T23:59:00-06:00`.

**Prepare pack** creates a draft. Check it under **Prepared drafts**, then press **Approve this exact pack**. The credits
are ready at once and the pack's amount is added to what the member owes. If a member was waiting for a spot and now
has a credit, the waitlist moves for them.

## Record a payment

When a member pays, use **Record a payment** with the person, the amount in cents and a unique payment reference, such
as the receipt number from your card reader. A reference can be used once: recording the same reference again never
creates a second payment.

## See what every member owes

**Member balances** shows each member's charged total, what they have paid and what is outstanding. Members see their
own balance under **My packs**.

## Balance reminders

For a member who owes money, **Prepare a payment reminder** writes a draft with the recipient, the outstanding balance
and the exact message. Approve it, then use **Download approved reminder** to get the text and send it from your own
email. Strap does not send reminders itself. If the member's balance changes before you approve, Strap asks you to
prepare the reminder again.

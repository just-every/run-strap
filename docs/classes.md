# Classes and the waitlist

You publish a week of classes at a time. Members book with their class credits, a full class keeps a waitlist, and a
cancellation hands the spot to the first person waiting.

## Prepare a class week

Open **Classes** and find **Prepare a class week**. Choose the Monday that starts the week, then list the week's classes
as a JSON array. Each class needs a `title`, a `start` and an `end` (timestamps with a timezone), a `capacity` and the
`instructorId` of an active instructor. **Instructor IDs** lists them.

```json
[
  {
    "title": "Morning Flow",
    "start": "2026-10-20T07:00:00-05:00",
    "end": "2026-10-20T08:00:00-05:00",
    "capacity": 12,
    "instructorId": "INSTRUCTOR_ID"
  }
]
```

Use your studio's own offset, such as `-05:00` for Nashville in October (`-06:00` once daylight saving time ends), so
each class lands on the right day. Strap stores every time in UTC and shows it that way.

**Prepare class week** creates a draft. Nothing is published yet.

## Review and publish

The draft appears under **Prepared drafts** with its exact contents. Read it through, then press **Approve and publish
this exact week**. The classes appear under **Published classes** and members can book them. A published class is never
changed quietly: to run a different week, prepare and publish that week.

Strap publishes the classes you list; it does not repeat a schedule for you.

## Booking

A member opens **Classes** and presses **Book class or join waitlist**.

- If the class has room, the booking spends one credit from the member's pack that expires first.
- If the class is full, the member joins the waitlist. A waitlist entry spends no credit.
- If the owner has published a waiver, the member acknowledges the current version before their first booking.

A member can press **Cancel my booking** any time before the class starts. A booked spot gives its credit back once.

## The waitlist fills cancellations

When someone cancels, Strap offers the spot to the waitlist in the order people joined. The first waiting member who is
still active, has acknowledged the current waiver and holds a valid credit gets the spot, and that credit is spent in
the same step. Their booking changes from **Waitlisted** to **Booked**.

## Check people in

The class's instructor opens **My teaching schedule** and presses **Check in** beside each booked person as they arrive.
The owner can check people in to any class from **Bookings** under each class. A check-in records the time and can't be
repeated.

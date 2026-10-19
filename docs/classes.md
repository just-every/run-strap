# Classes and the waitlist

You publish a week of classes at a time. Members book with their class credits, a full class keeps a waitlist, and a
cancellation hands the spot to the first person waiting.

## Set your studio's clock

Before the first week, open **Studio** (the location row under the logo, with its pencil) and save the location name and the studio's time
zone, such as Central for Nashville. Every class time is entered and shown on that clock, the US way ("6:00 am"),
for you, your instructors and your members, and daylight saving time is handled for you.

## Prepare a class week

Open **Classes** and find **Prepare a class week**. Choose the Monday that starts the week, then fill one row per class:
the class name, its room, the day, the start time, its length in minutes, the number of spots and the instructor,
picked by name. **Service** groups classes for pack eligibility, such as `Mat` or `Reformer`; blank uses the class name. The pack’s eligible services must match this name, ignoring case and extra spaces. Rows left without a class name are skipped; **Add seven more rows** gives you more.

Enter each shared piece of equipment or reformer by name, one per line. Use the same room and equipment names wherever they are shared; matching ignores case and extra spaces. Preparation and cleanup minutes reserve the instructor, room and equipment before and after the class. Two reservations may touch at their exact end and start, but may not overlap.

**Prepare class week** creates a draft. Nothing is published yet. Conflicts name the occupied resource and the existing record; the entire week is refused if any class conflicts.

## Review and publish

The draft appears under **Prepared class weeks** as a table of the week's classes. Read it through, then press
**Approve and publish this exact week**. The classes appear under **Upcoming classes** and on **Today**, and members can
book them. A published class is never changed quietly: to run a different week, prepare and publish that week.

The draft is checked again when you publish. If another class or an unavailable interval has appeared, the draft lists the blocking records and stays unpublished.

Strap publishes the classes you list; it does not repeat a schedule for you.

## Record unavailable time

The owner opens **Availability exceptions** on **Classes**, chooses **Record unavailable time**, and selects an instructor, room or equipment name. Enter the start and end on the studio clock and a reason. The interval blocks new classes, including their preparation and cleanup; it cannot overlap a class already published. **Remove** releases the interval while retaining the removed record. Reasons are visible only to the human owner. A preparation agent receives the blocking resource and interval without the reason; members and instructors do not receive exception records.

## Booking

A member opens **Classes**, where each class shows how many spots are open ("11 open", or "Full · waitlist 2"), and presses
**Book**.

- If the class has room, the booking spends one credit from the member's pack that expires first.
- If the class is full, the member joins the waitlist. A waitlist entry spends no credit.
- If the owner has published a waiver, the member acknowledges the current version before their first booking.

A member can cancel any time before the class starts. Beside **Cancel**, Strap shows exactly what happens: the credit returns, or, after the cancel cutoff, the credit is kept and any late fee is added to what they owe. Leaving a waitlist is always free.

## Booking and cancellation rules

The owner sets rules under **Studio → Booking and cancellation rules**: when booking opens (hours before class), when priority packs open (earlier), when booking closes (minutes before class), the cancel cutoff (hours before class), and whether a late cancel keeps the credit and adds a fee. A rule for a service, such as `Reformer`, replaces the studio rule for that service. Hours count back from the class start. Each class shows its rule to members before they book, and a booking keeps the cancellation rule in force when it was made.

A pack prepared with **Priority booking** lets its member book inside the priority window, using that pack.

After the cutoff, the owner cancelling for a member from the roster (**Cancel for …**) sees the same fee and chooses **Late cancel**, or an early cancel that returns the credit with no fee and records a reason. The fee is added to the member's balance; Strap does not charge a card.

## The waitlist fills cancellations

When someone cancels, Strap offers the spot to the waitlist in the order people joined. The first waiting member who is
still active, has acknowledged the current waiver and holds a valid credit gets the spot, and that credit is spent in
the same step. Their booking changes from **Waitlisted** to **Booked**.

## Check people in

The class's instructor or the owner opens **Today**, opens the class's roster and presses **Check in** beside each
booked person as they arrive. **Check in** in the top bar opens the class that is on now. A check-in records the time and can't be
repeated.

Once the class has started, **No-show** marks a booked person who didn't come: their credit stays used and the
no-show fee from your booking rules, if any, is added to what they owe. Members see that fee with the class's rules before
they book.

## Correct a no-show or late cancel

If a no-show or late cancel was a mistake, the owner opens the roster and uses **Correct no-show** or **Correct late cancel**
under the person, with a reason. **Excused** or an early cancel returns the credit to its pack (extend the pack first if it
has expired); **Attended** keeps the credit used. Either way the fee is reversed. If the member already paid the fee, add the
reference of the refund you paid them outside Strap. The original no-show or late cancel stays in the booking's history, and a
booking can be corrected once.

When spots are open but the first person waiting has no credit that covers the class, **Today** marks the class
**Waitlist stuck** and offers **Prepare a pack** for them.

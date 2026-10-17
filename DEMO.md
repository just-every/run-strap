# Strap demo

Run `rer demo` for a fresh, signed-in throwaway studio. Open the private RER_OPEN
link. Stop its recorded process with Ctrl-C; the studio is discarded. Normal
`.wrangler/state` data stays untouched. The hosted demo is https://demo.run-strap.com/.
Each visitor gets their own native Worker isolate and SQLite facets; it ends after
60 minutes or 15 idle minutes and erases its data.

The sample uses Strap's own class, pack, booking, waitlist, attendance, payment
receipt and waiver domain functions. It has three instructors, 24 members,
14 upcoming classes in two named rooms, four recent classes with attendance,
intro/five/ten-class passes, unpaid and part-paid balances, expiring and expired
passes, two inactive members, and a pack and reminder waiting for approval.
Dates follow the start time; fixed IDs and one atomic batch make the seed
idempotent. It never fetches.

Strap currently supports finite packs and inactive access, not recurring
membership or subscription pause states. Rooms are identified in class titles.
Payments remain external receipt records; there is no processor integration or
SMS sender in this version. Invitations silently succeed through Base's demo mail
sender. No email leaves, no message is captured, and no outbox is shown. Base's
demo guard mocks external writes and lets public reads run for real; Strap has
no public internet read feature.

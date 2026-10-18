# Strap demo

Run `rer demo` for a fresh, signed-in throwaway studio. Open the private RER_OPEN
link. Stop its recorded process with Ctrl-C; the studio is discarded. Normal
`.wrangler/state` data stays untouched. The hosted demo is https://demo.run-strap.com/.
Each visitor gets their own native Worker isolate and SQLite facets; it ends after
60 minutes or 15 idle minutes and erases its data.

The sample is the East Nashville studio of the owner-picked app look, on Central time, built with Strap's own
studio, class, pack, booking, waitlist, attendance, payment receipt and waiver domain functions. Mara Ellis owns it;
Dana Reyes, Kim Lowe, Tessa Moore and Ray Chen teach; 42 members hold 3, 5, 10 and 20-class packs. Today has five
classes (6:00 am Reformer Flow full with two waiting, 9:30 am Mat Yoga, 12:15 pm Reformer Express with a waitlist that
can't move, 5:30 pm Barre, 6:00 pm Restore Yoga: 65 of 92 spots); classes already begun show their check-ins. The six
days ahead follow the week's pattern. Four earlier classes carry attendance, so Ana Patel's last Tuesday and Thursday
6 am visits are three weeks back. Unpaid and part-paid balances, a pack ending this week, an expired pass and two
inactive members are there, and a renewal pack and next-but-one week prepared by the studio's agent and a balance
reminder wait for approval. Dates follow the start time; fixed IDs and one atomic batch make the seed idempotent. It
never fetches.

Strap currently supports finite packs and inactive access, not recurring
membership or subscription pause states. Rooms are the part of a class title after " · ".
Payments remain external receipt records; there is no processor integration or
SMS sender in this version. Invitations silently succeed through Base's demo mail
sender. No email leaves, no message is captured, and no outbox is shown. Base's
demo guard mocks external writes and lets public reads run for real; Strap has
no public internet read feature.

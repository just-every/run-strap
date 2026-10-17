# Getting started

Strap runs your studio's week: the classes you publish, the class credits members book with, the waitlist that fills a
cancelled spot, and what each member has paid. It is free and open source under the MIT licence, and every record stays
in your own account.

## What you need

A Mac, a Linux computer or Windows with WSL2, with Git and Node 22 or later. Nothing else: Strap brings its own
database and opens in your browser.

## Run Strap on your computer

One line installs the `rer` command, gets Strap and starts it:

```sh
npx -y @runeditrun/rer dev just-every/run-strap
```

Without Node, `curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-strap` does the same. To start it again later, run `cd run-strap && rer dev`.

`rer dev` installs everything, makes you the owner and prints two lines. `RER_OPEN` is a private link that opens Strap
signed in as you: keep it to yourself. `RER_READY` is the ordinary address. The first launch can take a few minutes;
running `rer dev` again reuses the copy that is already running.

To start with your own email as the owner, run `npx -y @runeditrun/rer install just-every/run-strap`, then `rer setup --owner-email you@example.com` and `rer dev` from the checkout. Stop Strap with `rer dev --stop` or Ctrl-C. If the saved port is busy, run `rer dev --port 8899`.

## Finish setup

The first time you open Strap you see **Finish setup**. Check the owner name and email, tick the box and press
**Finish setup**. Strap then opens on **Classes**.

## Find your way around

| Screen | What it is for |
| --- | --- |
| Classes | The published week, the current waiver and the form that prepares next week |
| Packs and payments | Class packs and credits, member balances, payments and balance reminders |
| People | Members and instructors, invitations and access |
| Import | Bringing members across from a Mindbody CSV |
| Agent access | Keys that let an assistant prepare drafts for you |
| Local mail | Sign-in and invitation emails while Strap runs on your computer |

Each person sees only their own work. The owner sees everything. An instructor sees **My teaching schedule** and checks
people in to their own classes. A member sees the published classes, their own bookings, **My packs** and their balance.

## Your first week

1. Add your instructors and members in [People](people.md), or [move them in](MOVE-IN.md) from a CSV.
2. Give members credits by preparing and approving a pack in [Packs and payments](packs-and-payments.md).
3. Publish a [waiver](waivers.md) if members must acknowledge one before booking.
4. [Prepare and publish the week](classes.md). Members can book straight away.
5. When it is time to open your doors to everyone, [put Strap online](put-strap-online.md).

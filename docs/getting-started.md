# Getting started

Strap runs your studio's week: the classes you publish, the class credits members book with, the waitlist that fills a
cancelled spot, and what each member has paid. It is free and open source under the MIT license, and every record stays
in your own account.

## What you need

A Mac, a Linux computer or Windows with WSL2. Git is required; rer brings Node and pnpm. Nothing else: Strap brings
its own database and opens in your browser.

## Run Strap on your computer

One line installs the `rer` command, gets Strap into `run-strap` and starts it:

```sh
curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-strap
```

Already have Node 22 or later? `npx -y @runeditrun/rer dev just-every/run-strap` does the same. If the installer prints a line that puts `rer` on your PATH, run that line too. To start it again later, run the same line from the same folder, or `cd run-strap && rer dev`.

`rer dev` installs everything, makes you the owner and prints two lines. `RER_OPEN` is a private link that opens Strap
signed in as you: keep it to yourself. `RER_READY` is the ordinary address. The first launch can take a few minutes;
running `rer dev` again reuses the copy that is already running.

To start with your own email as the owner, run `npx -y @runeditrun/rer install just-every/run-strap`, then `rer setup --owner-email you@example.com` and `rer dev` from the checkout. Stop Strap with `rer dev --stop` or Ctrl-C. If the saved port is busy, run `rer dev --port 8899`.

## Finish setup

The first time you open Strap you see **Finish setup**. Check the owner name and email, tick the box and press
**Finish setup**. Strap then opens on **Today**, which first asks for your studio's location and time zone.

## Find your way around

| Screen | What it is for |
| --- | --- |
| Today | The day's classes, each class's roster with check-in, the class that needs you, and Member success: follow-ups and drafts waiting for your approval |
| Classes | The published week, the current waiver and the form that prepares next week |
| Packs and payments | Class packs and credits, member balances, payments and balance reminders |
| People | Members and instructors, invitations and access |
| Import | Bringing members across from a Mindbody CSV |
| Agent access | Keys that let an assistant prepare drafts for you |
| Studio | Location, time zone, legal studio identity, US address, receipt details and weekly business hours |
| Local mail | Sign-in and invitation emails while Strap runs on your computer |

Each person sees only their own work. The owner sees everything. An instructor sees their classes on **Today** and **My
classes** and checks people in to their own classes. A member sees the published classes, their own bookings, **My packs** and their balance.

## Your first week

1. Add your instructors and members in [People](people.md), or [move them in](MOVE-IN.md) from a CSV.
2. Give members credits by preparing and approving a pack in [Packs and payments](packs-and-payments.md).
3. Publish a [waiver](waivers.md) if members must acknowledge one before booking.
4. [Prepare and publish the week](classes.md). Members can book straight away.
5. When it is time to open your doors to everyone, [put Strap online](put-strap-online.md).

## Studio identity and hours

Open **Studio** to save the legal studio name, US address and receipt details. An address needs its street, city, state or territory code and five-digit ZIP (optionally ZIP+4). Clear every address field to remove it. Receipt details are saved for future invoices and receipts; saving them issues no document or message.

Weekly business hours use your studio time zone. Give each open day one opening and closing time on the same day; leave both blank for closed days. These hours describe the studio. Class availability and booking windows keep their separate rules. Multiple locations and US phone defaults are not available.

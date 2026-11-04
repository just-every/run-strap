# Getting started

Strap runs your studio's week: the classes you publish, the class credits members book with, the waitlist that fills a
cancelled spot, and what each member has paid. It is free and open source under the MIT license, and every record stays
in your own account.

## What you need

A Mac, a Linux computer or Windows with WSL2. Git is required; rer brings Node and pnpm. Nothing else: Strap brings
its own database and opens in your browser.

## Run Strap on your computer

Install the `rer` launcher first. You do not need Node:

```sh
curl -fsSL https://runeditrun.com/install.sh | sh
```

Before starting Strap, make the command available in this terminal:

```sh
export PATH="$HOME/.local/bin:$PATH"
rer cli path
```

Run the shell startup line that `rer cli path` prints so `rer` is also available in new terminals. The installer does not change your shell startup file.

Then clone and start Strap:

```sh
rer dev just-every/run-strap
```

This gets Strap into `run-strap`. To start it again later, run `cd run-strap && rer dev`.

**Node 22+ only:** if you already have Node 22 or later, you can use `npx -y @runeditrun/rer dev just-every/run-strap` instead.

`rer dev` installs everything, prepares an owner and prints `RER_OPEN`, a private link that opens Strap signed in as
that owner: keep it to yourself. `RER_READY` is the ordinary app address. The first launch can take a few minutes;
running `rer dev` again reuses the copy that is already running.

To start with your own email as the owner, install the launcher above, then run:

```sh
rer install just-every/run-strap
cd run-strap
rer setup --owner-email you@example.com
rer dev
```

`rer dev` leaves Strap running in the background, so closing the terminal or pressing Ctrl-C after launch does not
stop it. From the `run-strap` checkout, use `rer dev --stop` when you are finished. If the saved port is busy, run
`rer dev --port 8899` with an available port. Keep local development private.

## Finish setup

The first time you open Strap you see **Finish setup**. Check the owner name and email, tick the box and press
**Finish setup**. Strap then opens on **Today**, which first asks for your studio's location and time zone.

## Find your way around

| Screen | What it is for |
| --- | --- |
| Today | The day's classes, each class's roster with check-in, the class that needs you, and Member success: follow-ups and drafts waiting for your approval |
| Classes | Published classes, repeating timetables, class-week drafts and the current waiver |
| Packs and payments | Class packs and credits, member balances, payments and balance reminders |
| People | Members and instructors, invitations and access |
| Import | Bringing members across from a Mindbody CSV |
| Agent access | Keys that let an assistant prepare drafts for you |
| Studio | Location, time zone, legal studio identity, US address, receipt details and weekly business hours |

Each person sees only their own work. The owner sees everything. An instructor sees their classes on **Today** and **My
classes** and checks people in to their own classes. A member sees the published classes, their own bookings, **My packs** and their balance.

## Try a member’s view locally

Add an active member in **People**, then choose **Invite to sign in**. Local development sends no external email.
Open the terminal’s private `RER_OPEN` link in a second browser profile first, then sign out in that profile. Open
`/signin` at the local app address and choose **Sign in as** the invited member. Keep your owner profile open separately.
On a hosted installation, invitations and email sign-in use your configured mail sender.

## Your first week

1. Add your instructors and members in [People](people.md), or [move them in](MOVE-IN.md) from a CSV.
2. Give members credits by preparing and approving a pack in [Packs and payments](packs-and-payments.md).
3. Publish a [waiver](waivers.md) if members must acknowledge one before booking.
4. [Prepare and publish classes](classes.md). Members can book straight away.
5. When it is time to open your doors to everyone, [put Strap online](put-strap-online.md).

## Studio identity and hours

Open **Studio** to save the legal studio name, US address and receipt details. An address needs its street, city, state or territory code and five-digit ZIP (optionally ZIP+4). Clear every address field to remove it. Receipt details are saved for future invoices and receipts; saving them issues no document or message.

Weekly business hours use your studio time zone. Give each open day one opening and closing time on the same day; leave both blank for closed days. These hours describe the studio. Class availability and booking windows keep their separate rules. Multiple locations and US phone defaults are not available.

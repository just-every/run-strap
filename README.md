# Strap

<img src="public/brand/mark.svg" alt="" width="64" height="64">

Classes, class packs and member balances for a US yoga, Pilates or boutique fitness studio, priced in US dollars. You own the records and run the app in your Cloudflare account. Payments stay with your existing processor. MIT licensed. [First release](ACCEPTANCE.md); the [product contract](CONTRACT.md) is the full studio system it is growing into.

The owner guides start at [Getting started](docs/getting-started.md); the run site serves them at `/docs`.

## Run

Strap's run site is live at https://run-strap.com, and https://run-strap.com/run has the install commands. To run it locally instead, install Git, then run one line to install the launcher, clone and start:

```sh
npx -y @runeditrun/rer dev just-every/run-strap
```

Without Node, `curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-strap` does the same. To start it again later, run `cd run-strap && rer dev`.

RER installs the pinned dependencies and Node 22.20.0, builds the app, migrates local D1 and prepares an owner. First launch can take several minutes. Open the private `RER_OPEN` link printed in the terminal, confirm the owner and click **Finish setup**. Keep that link private. `RER_READY` is the ordinary app address. A repeated `rer dev` resumes or reuses the running app. On a busy Mac, RER may refuse when its 15-second process-ownership inspection times out; retry the same command. This is a launcher limitation, not a completed launch.

For your own owner email, run `npx -y @runeditrun/rer install just-every/run-strap`, then from the checkout `rer setup --owner-email you@example.com` and `rer dev`. Local development sends no external email. Stop its foreground process with Ctrl-C. If a saved port is occupied, run `rer dev --port 8899` with an available port. Never expose local development publicly.

## Run your first week

1. Open **People**. Add an instructor with role `instructor` and members with role `member`; activate them, then **Invite to sign in**. Invites establish native sessions, and only the owner grants access. To use a second local browser profile, open the terminal's private `RER_OPEN` link there first, then sign out. In the second profile, open `/signin` and choose the invited person’s one-click sign-in. Local owner access uses the private launch link; local member access uses these invitations. Hosted email sign-in uses the configured mail sender.
2. Open **Studio** (the location under the logo) and save the studio's location and time zone. Open **Packs and payments**. Prepare a pack for a member with its credits, price in dollars and last day of use, review it, then approve. The approved amount becomes owed; no card is charged. Record payments only after receiving them through your processor, with a unique receipt reference. Credits and money balances are separate.
3. Open **Classes**. Prepare a Monday-starting week, one row per class: name, room, day, start time on the studio's clock, minutes, spots and instructor. Review the exact draft, then publish it. Times show in the studio's time zone, the US way ("Tue, Oct 20 · 6:00 am"). This release uses explicit occurrences, not repeating schedules. A published class cannot be silently edited.
4. Sign in as a member. Acknowledge the current waiver if the owner has published one, then book a class. A full class adds the member to its waitlist without spending a credit. Cancellation before start returns the booked credit once and promotes the first eligible waiting member with a valid credit. Members see their own balances and bookings. An assigned instructor opens **Today** and checks attendees in from the class roster.
5. An owner can prepare a balance reminder and review its exact wording and balance before approving the text export. Strap does not send reminders or collect payments. [Agent commands](docs/AGENT-COMMANDS.md) can prepare drafts, while native human owner sessions approve them.
6. **Import** accepts the [documented Mindbody member CSV shape](docs/MOVE-IN.md). Paste the [synthetic fixture](tests/fixtures/members.csv), preview, review and apply the unchanged CSV. Imports start inactive with no credits or charges. The journal retains original source and supports resume and conflict-preserving undo.

Deactivate a person in **People** to revoke studio access immediately. Revoke preparation keys in **Agent access**. Waiver acknowledgement records receipt of the exact version; it is not a legal signature. Only unused, uninvited, non-imported people can be erased; used member history remains retained. Erasure blocks the same identity from being recreated or imported.

## Back up and restore

Stop the app, and keep exports private:

```sh
rer dev --stop
rer export --output exports/strap.rer
```

Restore into a fresh clone of the same revision before setup or entering data:

```sh
npx -y @runeditrun/rer install just-every/run-strap
cd run-strap
rer import --input /private/path/strap.rer --yes
rer setup --owner-email original-owner@example.com
rer dev
```

The original owner/member identities, classes, packs, bookings, payments, approvals, waiver acknowledgements, import originals and journals travel. Sessions, sign-in links, agent keys, provider credentials and the development outbox do not. Re-enter private configuration and sign in again. Setup uses the archived owner's email. Damaged archives and populated destinations are refused. After erasure, pass a later archive as the journal: `rer import --input OLD.rer --journal LATER.rer --yes`. A current destination or supplied later journal fences older data. Offline older backups cannot discover later erasure; protect and retire old copies. `rer reset --yes` destroys local data and settings; export first if needed.

## Deploy

No domain or provider account is needed locally. For hosting, use your own Cloudflare Workers/D1 account and verified mail sender. Resource identities in `wrangler.jsonc` and `deploy.json` stay stable. Set `MAIL_FROM` in `deploy.json` to your verified sender and provide private `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `OWNER_EMAIL`, `SESSION_SECRET`, `SETUP_TOKEN` and `MAIL_API_KEY` environment variables through your secret manager. Mail uses Resend. Never put secrets in arguments or source. Commit intended configuration changes before deploying.

```sh
rer deploy --dry-run
rer deploy
```

Dry run validates and builds without provider calls. Real deployment provisions resources, applies migrations, uploads secrets and checks health. It claims the configured owner and retires the setup token. Open the returned workers.dev origin and sign in by email. A custom domain is optional. `rer signin` provides owner recovery when mail is not working yet; then correct the sender/email configuration. This round verifies local runtime and dry-run behavior; real provider delivery and hosted acceptance remain unverified.

## Develop

Package mode pins `@runeditrun/rer@0.2.50`. The committed Base foundation was `c7cb0613120074c5ffca63f610533802afbda6bd`. [Source adaptation](docs/SOURCES.md), [operations](RUN-LOCALLY.md), [agent guide](AGENTS.md).

```sh
pnpm run test:strap
pnpm run test:archive
pnpm run typecheck
rer verify
```

Integration tests use real workerd/D1, native invitations/sessions and public HTTP commands, plus the public archive CLI. Build/deploy never run tests. One sharded Verify workflow runs per push commit; the separate lane runs the stranger journey.

The mark is a sea-glass stability ball with a plum band (`public/brand/mark.svg`; `mark-dark.svg` for dark grounds; hand-tuned `favicon-16.svg` and `favicon-32.svg`). The run site's look (Playfair Display headings in plum, Figtree text, white and sea-glass grounds) has its tokens in `public/site/theme.css`. The app's tokens are in `public/rer-theme.css`, Strap's shared app components in `public/brand/strap.css`, which also dresses Base's sign-in and setup frames, and the app layout in `src/strap/ui/style.ts`.

## Run site

`rer build --site` writes the static run site to `dist/site`: the homepage (`src/site/landing`), whose **Run Strap** opens `/run`, Base's Run page with the commands in `src/site/run.json`, and the docs rendered from `docs/*.md` in the order `docs/site.json` gives. An installed Strap serves the Lobby at `/` instead. `rer dev` serves the run site too and prints its address as `RER_SITE`; open its `/run` page for the local install commands. `.github/workflows/run-site.yml` publishes it to the domain in `deploy-site.json` only when the repository variable `RUN_SITE_DEPLOY` is `true`.

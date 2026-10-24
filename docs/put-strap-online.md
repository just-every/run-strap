# Put Strap online

On your computer Strap is yours alone. To let members and instructors sign in from their phones, deploy it to your own
Cloudflare account. Strap runs as a Worker with a D1 database there; the records stay in your account.

## Before you deploy

- A Cloudflare account, and an email sender verified with Resend, which Strap uses for sign-in and invitation emails.
- Provide `MAIL_FROM` as your verified sender address through your deployment environment. It is a declared deployment input; you do not need to edit source to change it.
- Required private inputs: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `OWNER_EMAIL`, `SESSION_SECRET`,
  `SETUP_TOKEN`, `MFA_KEY` and `MAIL_API_KEY`. Provide them as private environment variables from your secret manager. Never put secrets in commands or files you
  commit.
- Commit any configuration changes you mean to deploy.

## Deploy

```sh
rer deploy --dry-run
rer deploy
```

The dry run checks and builds everything without contacting Cloudflare. The real deploy creates the Worker and
database, applies the database migrations, uploads the secrets, checks the app answers, and makes `OWNER_EMAIL` the
owner. Open the address it prints and sign in by email. A custom domain is optional.

## If sign-in email is not working yet

Run `rer signin` from the project folder. It prints a one-time sign-in link for the owner, so you can get in and correct
the sender or email settings.

# Strap agent guide

Run from the checkout root with `rer dev`. It installs and prepares a fresh checkout. Open the private RER_OPEN link and finish setup. Stop with `rer dev --stop`. For an owner-chosen identity, use `rer install`, `rer setup --owner-email you@example.com`, then `rer dev`.

Read README.md and ACCEPTANCE.md. Product HTTP routes live in src/strap/http.ts, domain services in src/strap/domain, server-rendered screens in src/strap/ui, and the member move-in adapter in src/strap/movein. D1 migrations are append-only in migrations/core. Every handler authenticates and authorizes independently. Agent keys prepare; native human owners approve exact drafts.

Run pnpm run test:strap and pnpm run test:archive for changed flows, pnpm run typecheck for source, and rer verify for the full local plan. GitHub Verify shards the same plan. Build and deploy do not run tests. Tests stay below the cap in test-budget.json. No mock application data or fallback behavior.

The app pins @runeditrun/rer in package mode. Do not vendor or patch its internals locally. Keep deploy, project, edition, Worker, D1 and package identities stable. Data backups and real deploy use rer export/import and rer deploy; read README.md. No secrets or private exports in source. Native sessions, credentials and outboxes never travel in backups. Use Base publication scan on the exact tree before a public push, zero findings and no exclusions.

Lander-Regenerate: `node scripts/contract-docs.mjs write`, then `node scripts/contract-docs.mjs check`. CONTRACT.md remains the only source for acceptance, evidence and Status rows. Regenerate the edition source lock after generation.

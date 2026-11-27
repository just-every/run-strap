# Changelog

## 0.1.0 — 2026-11-27

The first release. Strap runs classes, class packs and member balances for a US yoga, Pilates or boutique fitness studio, priced in US dollars, in your own Cloudflare account. Payments stay with your existing processor.

- **Runs on rer 0.2.143.** The pinned platform moves from 0.2.80.
- **Mail optional.** `MAIL_PROVIDER=none` deploys with no sender or mail key: the owner signs in with `rer signin`, members get in-app notices, and document-copy email is refused with `mail_off` without a provider being contacted. Email sign-in, invitations and member emails need a configured provider.
- **Deployable migrations.** Migrations 0021–0045 are renamed from `NNNN-name.sql` to `NNNN_name.sql`, the only form `rer deploy` accepts; no hosted installation had applied them under the old names.
- **Demo follows releases.** The run-demo workflow redeploys the demo at each published release's tag (Base fc087acf), instead of on pushes to main.

### Not in this release

CONTRACT.md tracks the full studio system Strap is growing into: 63 clauses done, 41 partial and 47 missing at this release.

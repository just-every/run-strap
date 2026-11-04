# Backup and restore

Strap exports the whole studio to one archive file and restores it into a fresh copy. Keep archives private: they hold
your members' details.

## Export

Install the launcher and configure its PATH using [Getting started](getting-started.md) first. Stop Strap, then export:

```sh
rer dev --stop
rer export --output exports/strap.rer
```

The archive holds the owner and every member and instructor, classes, packs, bookings, payments, approvals, waiver
acknowledgements, members' check-in codes and phones, and the originals and journals of member imports. Sessions,
sign-in links, second factors (authenticator apps, passkeys and recovery codes), agent keys, integration keys with their subscriptions and request logs, paired kiosk devices, provider
credentials and local mail are not included; you sign in again after a restore, create new agent and integration keys
and pair your kiosks again.

## Restore

Restore into a fresh clone of the same version of Strap, before running setup or entering any data:

```sh
rer install just-every/run-strap
cd run-strap
rer import --input /private/path/strap.rer --yes
rer setup --owner-email original-owner@example.com
rer dev
```

Use the same owner email the archive was made with. Strap refuses a damaged archive, and it refuses to restore over a
copy that already holds data.

## After erasing someone

Restore the current archive made after the erasure:

```sh
rer import --input /private/path/after-erasure.rer --yes
```

An older archive plus a later journal is not a guaranteed recovery path. The launcher refuses incompatible erasure epochs with `restore_refused` / `erasure_epoch`; do not remove the journal to bypass that refusal. Use the post-erasure archive instead to restore the unaffected studio records and keep the erasure.

If you need to supply a later journal for an otherwise compatible older archive, `--input` accepts an absolute path but `--journal` currently requires a path inside the destination checkout. Copy the later archive into the ignored `exports/` folder first:

```sh
mkdir -p exports
cp /private/path/LATER.rer exports/LATER.rer
chmod 600 exports/LATER.rer
rer import --input /private/path/OLD.rer --journal exports/LATER.rer --yes
```

A containment error in this command refers to `--journal`: use the contained path shown above. A later journal fences erased identities; it does not merge the two archives or promise an older restore. An offline older backup can't know about a later erasure, so protect and retire old copies you no longer need. The documented `exports/` folder is ignored by Git; keep archives private wherever you store them.

## Start over

`rer reset --yes` deletes the local data and settings for this copy. Export first if you want to keep anything.

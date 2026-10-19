# Backup and restore

Strap exports the whole studio to one archive file and restores it into a fresh copy. Keep archives private: they hold
your members' details.

## Export

Stop Strap, then export:

```sh
rer dev --stop
rer export --output exports/strap.rer
```

The archive holds the owner and every member and instructor, classes, packs, bookings, payments, approvals, waiver
acknowledgements, members' check-in codes and phones, and the originals and journals of member imports. Sessions,
sign-in links, agent keys, paired kiosk devices, provider credentials and local mail are not included; you sign in
again after a restore, create new agent keys and pair your kiosks again.

## Restore

Restore into a fresh clone of the same version of Strap, before running setup or entering any data:

```sh
npx -y @runeditrun/rer install just-every/run-strap
cd run-strap
rer import --input /private/path/strap.rer --yes
rer setup --owner-email original-owner@example.com
rer dev
```

Use the same owner email the archive was made with. Strap refuses a damaged archive, and it refuses to restore over a
copy that already holds data.

## After erasing someone

If you erased a person after an older backup was made, pass the later archive as the journal so the erasure still holds:

```sh
rer import --input OLD.rer --journal LATER.rer --yes
```

An offline older backup can't know about a later erasure, so retire old copies you no longer need.

## Start over

`rer reset --yes` deletes the local data and settings for this copy. Export first if you want to keep anything.

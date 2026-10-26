# Waivers

A waiver is a short text members acknowledge before they book. You publish it in versions; members acknowledge the
current one.

## Publish a version

On **Classes**, open **Publish a new version** under **Waiver**, enter the full text and press **Publish
new waiver version**. The panel shows the current version number and its text.

## What members do

A member sees **Waiver** on their **Classes** screen with **I acknowledge this waiver version**. Until they
acknowledge the current version they can't book. When you publish a new version, each member acknowledges it before
their next booking; their existing bookings stay.

Strap records which person acknowledged which exact version, and when. That is a receipt of the text, not a signature.


## Personal typed signing

When publishing a version, choose **Require a personal typed signature** to require the member’s own recorded name and
explicit confirmation of that exact text. On **Classes**, the member reviews the document and chooses **Sign this document**.
A currently recorded guardian can complete it for a linked participant on **My household**. This records personal affirmation;
Strap does not assert legal enforceability or payment authorization. A replacement signing-required version needs fresh completion before another booking or check-in.

Members and current guardians can download the original version’s evidence from the completion screen. The JSON package
retains the exact text, its SHA-256 digest, version, signer, authority and completion time. The readable copy is a self-contained HTML document containing the same original evidence, without external assets or active content. Removing a guardian ends their download
access immediately. Earlier versions remain intact.

## Desk signing

The owner first grants member-record access in **People**, then separately grants **Signing check-in right** for named members
and locations. These staff doors require a second factor. On the member’s profile, open **Member waiver link** to request
the member’s secure sign-in link or **Launch locked signing tablet**. Link requests record staff provenance and do not confirm delivery.

Open the private handoff on a dedicated, signed-out tablet within 15 minutes. Pairing works once. Only that member’s current
document is shown, with no previous answers or other member records. The member enters their own name, confirms and chooses
**Sign and lock tablet**. The tablet then locks; private app routes and sign-in routes stay unavailable. A changed staff grant
invalidates an issued handoff. The tablet records self-affirmed identity, not independent identity verification. Never pass a staff
session to the member. Return the device to staff after completion.

## Service policies and expiry

On the same publication form, enter **Applies to service** to publish a policy for a named service. Leave it blank for the studio-wide waiver. Service policies require personal typed signing. Publishing another version for that service replaces only its current document; other services remain unchanged.

Set **Completion valid for days** from 1 to 3650, or leave it blank for no automatic expiry. Each completion retains its own expiry. Expired completion blocks the affected booking and check-in, including an existing booking. Re-signing creates a new receipt and preserves earlier evidence. Newly sold plans require current completion for their eligible services; a plan permitting every service requires every current signing policy.

Members complete service policies on **Classes**; current recorded guardians use **My household**. Staff launch the assigned service document from the member profile using the same scoped signing rights. Downloaded evidence preserves the displayed affirmation, document hash, signer channel, authority reference and device context. A tablet's device context remains self-affirmed.

Account-less guest signing, membership payment authorization, legal sufficiency, broader staff roles and used-record erasure remain incomplete.

## Portable copies

The portable exit includes exact JSON and readable HTML copies of every retained typed affirmation, with stable receipt and participant references, byte counts and SHA-256 integrity hashes. Native restore preserves those same copies and historical guardian attribution; ending guardian authority still refuses their next evidence download. These files do not certify legal execution or payment authorization.

A walk-in can complete the scoped tablet, desk booking and check-in without a native sign-in account. The locked tablet never becomes an evidence-reading door. A personally signing adult may separately request an emailed copy link after the MFA-cleared owner reviews the current member mail connection. The link expires after fifteen minutes and downloads the exact retained HTML evidence once on a personal device. Opening the neutral page does not consume it. The shared tablet never exposes the link or evidence. Known dependents are refused; no account or payment authority is created, and an uncertain send is not repeated automatically. This bounded consent default awaits ct approval. Guest-owned authorization, the full signed-agreement and recurring-payment flow, and broader legal authority and retention rules remain incomplete.

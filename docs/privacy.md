# Native privacy requests

The native owner records a member's access or erasure request through the authenticated command door, `POST /api/strap/command`, with a command `name` and an `input` object. Every privacy command requires the owner privacy right and a checked second factor. Managers, members, preparation keys and integrations cannot use it. No command sends an export externally or automatically deletes a used record.

1. `privacy.request.record`: provide `personId`, `type` (`access` or `erasure`), `channel` (`desk`, `phone` or `inbox`), a `sourceReference` and a unique `requestId`. Store a reference to the request, never a copied identity document.
2. `privacy.request.verify`: provide the returned request `id`, a `verificationReference`, `confirm: true`, `channel` and a new `requestId`. The owner verifies identity outside this command. Strap records that review; it does not perform identity verification itself. A changed member identity requires another verification.
3. `privacy.access.export`: provide the access request `id`, `channel` and a new `requestId`. The response's `bundle` contains the private native member copy for owner review. The response's `export` receipt records its digest and identity revision. Original import artifacts, shared household records, complete signed-document packages and external provider copies require separate review. Check that boundary before representing a request as complete.
4. After privately delivering the reviewed copy to the verified member, `privacy.access.fulfill` records `id`, `exportId`, `confirm: true`, `deliveryReference`, `channel` and a new `requestId`. This is an owner-recorded delivery outcome, not a mail-provider receipt.

The ordered staff history records the owner, privacy right, member, channel and before and after state. Repeating a request returns its receipt without another effect. An export replay returns only its receipt; request a new export with a new request identity if another private copy is needed. Export contents never enter the audit or replay cache.

The existing unused-identity erasure fence remains separate. Full used and imported member erasure, retention periods, document holds and disposal, provider deletion and complete access fulfillment remain unfinished. The owner-only conservative default awaits contract approval and is not legal certification.

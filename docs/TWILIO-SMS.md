# Twilio SMS connection test

Strap currently provides a Twilio TEST diagnostic, not studio SMS delivery.
The diagnostic uses Twilio's magic test phone for both sender and destination.
It cannot contact a handset, receive a real reply, establish a registered studio
sender or prove that a member received a message.

Supply `TWILIO_TEST_ACCOUNT_SID` and `TWILIO_TEST_AUTH_TOKEN` as private runtime
bindings. Keep them out of source, command arguments and exports. In **Studio**,
open **Twilio SMS test**, complete your second factor and choose **Review and
connect TEST account**. Submit a test message. A successful result says
**Submitted to Twilio TEST; no handset delivery**. Provider segments and price
are shown only when the response supplies them; missing price stays unavailable.
The provider's signed decimal price is preserved, including its currency.

Every request is claimed before submission. Replaying that request returns the
same observation; a changed message is refused. Refused or uncertain submissions
are not automatically retried. A credential change requires a fresh owner review.
Native archives and the portable exit keep the observations and review history,
but exclude connection authority. A restored installation needs a new review;
reviewing it never resubmits an old request.

Twilio TEST credentials do not generate status callbacks or inbound messages.
The development callback doors `/api/strap/sms/test/status` and
`/api/strap/sms/test/inbound` validate the exact request URL and all form fields
using the configured TEST token, and record **synthetic signed callbacks**.
They do not update member consent or claim provider-originated delivery.
The existing `/api/strap/consent/twilio` door uses its separate configured token
and destination for member consent. A shared-phone STOP suppresses every matching
member; a positive reply confirms nobody while the phone remains ambiguous.

The committed `tests/twilio-test-sandbox.mjs` journey makes one actual TEST API
submission through the ordinary owner command, checks replay, and separately
exercises signed synthetic callbacks and forged-callback rejection. The fleet
runs it only with held TEST credentials injected by name. The synthetic callback
result must never be presented as a real recipient's delivery or reply.

Real studio SMS still requires a verified sending identity and controlled real
recipient evidence, a Messaging Service connection, member delivery integration,
and provider cost reconciliation. SMS reminders, marketing sends, Mailchimp
synchronization and push remain unimplemented. Existing booking email and in-app
notices continue under their own configured rules.

Provider references: [Twilio TEST credentials](https://www.twilio.com/docs/iam/test-credentials),
[request signatures](https://www.twilio.com/docs/usage/security), and
[message resource fields](https://www.twilio.com/docs/messaging/api/message-resource).

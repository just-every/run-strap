// Domain records, original imports and their journals travel together. Credentials
// (agent keys, kiosk device tokens) do not: a restored studio re-pairs its kiosks.
export default {
  product: 'studio/strap',
  includeTables: ['oa_operators', 'oa_bootstrap', 'oa_invitation_cancellations'],
  excludeTables: ['st_agent_keys', 'st_kiosks'],
  replaceableTables: ['st_meta'],
  requiredConfiguration: ['OWNER_EMAIL', 'SESSION_SECRET', 'SETUP_TOKEN', 'AUTH_ORIGIN', 'MAIL_PROVIDER', 'MAIL_FROM'],
}

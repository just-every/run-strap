// Domain records, original imports and their journals travel together. Credentials
// (agent keys, kiosk device tokens, API-002 integration keys with their secrets, logs and
// rate counts) do not: a restored studio re-pairs its kiosks and recreates its integrations.
export default {
  product: 'studio/strap',
  includeTables: ['oa_operators', 'oa_bootstrap', 'oa_invitation_cancellations'],
  excludeTables: ['st_agent_keys', 'st_kiosks', 'st_waiver_launch_dispatches', 'st_integrations', 'st_integration_secrets', 'st_integration_requests', 'st_integration_rate'],
  replaceableTables: ['st_meta'],
  requiredConfiguration: ['OWNER_EMAIL', 'SESSION_SECRET', 'SETUP_TOKEN', 'AUTH_ORIGIN', 'MAIL_PROVIDER', 'MAIL_FROM'],
}

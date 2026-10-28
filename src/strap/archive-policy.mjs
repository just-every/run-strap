// Domain records, original imports and their journals travel together. Credentials
// (agent keys, kiosk device tokens, API-002 integration keys with their secrets, logs and
// rate counts) do not: a restored studio re-pairs its kiosks and recreates its integrations.
// Second factors (SEC-004: sealed authenticator secrets, passkey keys, recovery-code hashes, session checks)
// are credentials too: a restored studio sends every person back to enrollment.
export default {
  product: 'studio/strap',
  includeTables: ['oa_operators', 'oa_bootstrap', 'oa_invitation_cancellations'],
  excludeTables: ['st_invoice_dispatches', 'st_payment_control', 'st_evidence_copy_mail', 'st_evidence_copies', 'st_payment_connections', 'st_tax_connections', 'st_sms_connections', 'st_disclosure_connections', 'st_intake_tablets', 'st_contract_connections', 'st_agent_keys', 'st_kiosks', 'st_waiver_launch_dispatches', 'st_integrations', 'st_integration_secrets', 'st_integration_requests', 'st_integration_rate', 'st_mfa_factors', 'st_mfa_recovery', 'st_mfa_sessions', 'st_mfa_challenges'],
  replaceableTables: ['st_meta'],
  requiredConfiguration: ['OWNER_EMAIL', 'SESSION_SECRET', 'SETUP_TOKEN', 'AUTH_ORIGIN', 'MAIL_PROVIDER', 'MAIL_FROM'],
}

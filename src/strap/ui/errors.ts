// Translate refusals at the human-facing boundary; API error codes stay stable.
const messages: Record<string,string> = {
  mfa_enrollment_required: 'Add a second factor in Security before making this change. Then return and try again.',
  mfa_required: 'Confirm it is you in Security, then return to this change.',
  step_up_required: 'Confirm a fresh sign-in link in this browser, then try this change again.',
  already_decided: 'This draft has already been approved. Check Approval history for the recorded result.',
  payment_reference_used: 'This payment reference is already recorded. Check Payment history before recording another payment.',
  not_latest_version: 'The studio has published a newer waiver. Read and acknowledge the current version before booking.',
  waiver_acknowledgement_required: 'Read and acknowledge the current waiver on Classes before booking.',
  already_booked: 'You already have a booking or waitlist place for this class. Check your Classes page.',
  forbidden: 'You cannot change another member’s booking. Open your own booking, or ask the studio for help.',
  owner_required: 'Only the studio owner can make this change. Ask the owner for help.',
  instructor_required: 'Only the instructor assigned to this class can check attendance. Ask the assigned instructor or studio owner.',
  already_checked_in: 'This member is already checked in. Their attendance has been recorded.',
  already_cancelled: 'This booking is already cancelled. Check Classes for its current status.',
  eligible_credit_required: 'You need an available, unexpired credit for this class. Check My packs or ask the studio for a suitable pack.',
  conflict_refresh_and_retry: 'Another booking changed your available place or credit. Refresh Classes to see the current result before trying again.',
  balances_changed: 'The balance or member details changed after this reminder was prepared. Prepare a new reminder and review it before approval.',
  erased_identity: 'This person’s information was erased. Their identity cannot be added or imported again.',
}
export function errorText(message: string) {
  return messages[message] ?? message.replaceAll('_',' ')
}

import { staffHistory, historyFilters } from '../staff-history'
import { delivery } from './closures'
// STAFF-006 uses the existing member profile and the owner's command forms.
import { actionChannel } from './booking-rules'
import { waiverSigned } from './facts'
import { money, when } from './format'
import { body, cell, emptyLine, field, form, h, hidden, owner, panel, person, rows, select, table } from './shared'
import { profileText } from './profile'

/** One request identity per rendered form; submitting it again keeps that identity. */
export const staffRequestFields = (personId: string) => hidden('personId', personId)
  + hidden('requestId', crypto.randomUUID()) + actionChannel()

const launchStatus = (status: string) => ({
  requested: 'Request recorded; delivery not confirmed',
  not_sent: 'Not sent',
  uncertain: 'Outcome unknown; delivery not confirmed',
  sending: 'Outcome unknown; delivery not confirmed',
  queued: 'Request recorded; dispatch not confirmed',
} as Record<string, string>)[status] ?? status

const signingLocation=(s:any)=>select('locationId','Signing location',rows(s,'locations').map(l=>[l.id,l.name]),'studio');

export function waiverLaunch(s: any, p: any, back: string) {
  const documents=s.waivers ?? (s.waiver ? [s.waiver] : []);
  if(!documents.length)return emptyLine('The studio has not published a waiver.');
  return documents.map((w: any)=>launchDocument({...s,waiver:w},p,back)).join('');
}
function launchDocument(s: any,p: any,back: string) {
  const w = s.waiver
  const launches = rows(s, 'waiverLaunches').filter(l => l.personId === p.id && l.waiverId === w.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return `<p class="meta">${h(w.service ? w.service+' policy' : 'Current waiver')} · Version ${h(w.version)} · ${waiverSigned(s, p.id) ? 'Acknowledged by this member' : 'Awaiting member acknowledgement'}</p><p class="letter">${h(w.text)}</p>`
    + '<p class="meta">The member opens their own secure sign-in link and acknowledges this exact version. Only the member can complete it. A link request does not confirm delivery or acknowledgement.</p>'
    + (s.memberMail && s.memberMail.origin !== s.origin ? '<p class="notice">Member email is paused after restore. <a href="/app/studio#member-mail">Review and reconnect in Studio</a> before requesting a waiver link.</p>' : p.active ? form('waiver.launch', back, hidden('waiverId', w.id) + signingLocation(s) + staffRequestFields(p.id), 'Request a waiver sign-in link', 'quiet', 'small') : '<p class="meta">Activate this member before requesting a sign-in link.</p>')
    + (w.requiresSignature && p.active ? form('waiver.tablet.launch',back,hidden('waiverId',w.id)+signingLocation(s)+staffRequestFields(p.id),'Launch locked signing tablet','quiet','small') : '')
    + launches.map(l => `<p class="meta">${when(s, l.createdAt)} · ${h(launchStatus(l.status))}</p>`).join('')
}

function memberNotices(s: any, p: any, back: string) {
  const mailOf = (n: any) => rows(s,'noticeDeliveries').find(d => d.id === n.id.replace(/^notice:/,'mail:') || (n.closureId && d.sourceKind === 'closure' && d.sourceId === n.closureId && d.personId === n.personId))
  const notices = rows(s, 'staffNotices').filter(n => n.personId === p.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return notices.length ? notices.map(n => `<div class="notice"><p><strong>${h(n.subject)}</strong></p><p>${h(n.body)}</p><p class="meta">${when(s, n.createdAt)}${mailOf(n) ? ` · ${h(delivery(mailOf(n)))}` : ''}</p>${n.dismissedAt
    ? `<p class="meta">${n.dismissedByStaff ? 'Marked read by staff' : 'Read by member'} · ${when(s, n.dismissedAt)}</p>`
    : form('notice.dismiss.staff', back, hidden('id', n.id) + staffRequestFields(p.id), 'Mark read for this member', 'quiet', 'small')}</div>`).join('') : emptyLine('No notices for this member.')
}

/** These doors never acknowledge a waiver or change a notice's contents. */
export function staffProfileActions(s: any, p: any, back: string) {
  if (!owner(s) || p.role !== 'member') return ''
  return `<details class="more"><summary>Message preferences</summary><div class="panel-body"><p>The member signs in and changes their own booking email choice. Staff cannot opt them in or out.</p>${form('mail.preference.launch', back, staffRequestFields(p.id), 'Open member message preferences', 'quiet', 'small')}${rows(s,'messagePreferenceLaunches').some(l => l.personId === p.id) ? '<p><a href="/signin?returnTo=%2Fapp%23message-preferences">Member message sign-in</a> — open on the member’s device.</p>' : ''}</div></details>`
    + `<details class="more"><summary>Member waiver link</summary><div class="panel-body">${waiverLaunch(s, p, back)}</div></details>`
    + `<details class="more"><summary>Plan changes</summary><div class="panel-body"><p class="meta">Preview an upgrade or downgrade of this member’s pack. The member accepts the exact charge or credit themselves.</p><a class="btn-quiet" href="/app/packs?person=${encodeURIComponent(p.id)}#plan-changes">Change this member’s plan</a></div></details>`
    + `<details class="more"><summary>Membership freezes</summary><div class="panel-body"><a class="btn-quiet" href="/app/packs?person=${encodeURIComponent(p.id)}#freezes">Freeze this member’s plan</a><a class="btn-quiet" href="/app/packs?person=${encodeURIComponent(p.id)}#cancellations">End this member’s plan</a></div></details>`
    + `<details class="more"><summary>Member notices</summary><div class="panel-body"><p class="meta">Marking a notice read records who acted. The member can still see the notice in their read history.</p>${memberNotices(s, p, back)}</div></details>`
}

function effect(s: any, value: any) {
  if (!value) return 'No previous record'
  if(value.deliveryId && value.memberAddressOnFile)return 'Requested copy reserved for the member address on file; dispatch outcome is retained in copy history';
  if(value.invoiceId && 'receiptId' in value)return value.receiptId?'Requested original payment receipt':'Requested itemized invoice';
  if(value.courseId)return `Course ${h(value.status)} · ${value.creditCents !== undefined ? money(value.creditCents)+' tuition credit' : value.amountCents !== undefined ? money(value.amountCents)+' accepted tuition' : 'personal payer review'} · ${h(value.policy ?? 'No payer consent performed by staff')}`
  if(value.documentHash && 'financialHash' in value)return value.memberCommand
    ? 'Member personal billing step opened; no signature, payment consent or provider action performed'
    : `Exact membership agreement · ${h(value.status.replaceAll('-',' '))} · payment permission ${h(value.mandateStatus ?? 'not yet accepted')} · method ${value.methodAuthorized?'authorized':'not authorized'}`;
  if(value.documentHash && value.sellingStaffId)return 'Additional immutable membership agreement prepared; personal signature and separate payment permission pending';
  if(Array.isArray(value.choices)&&value.availabilityVersion)return `Attendance options · ${value.choices.length} cited classes · ${h(value.status)}`;
  if(value.status==='member_action_required' && value.path==='/app#attendance-plan')return 'Member availability step opened; staff set no preferences';
  if(value.dispatchConnectionId&&value.sendAt&&value.dueAt)return `${value.kind==='pack-expiry'?'Pack expiry notice':'Renewal disclosure'} · ${h(value.status)} · notice ${when(s,value.sendAt)} · term end ${when(s,value.dueAt)}${value.proposedAmountCents===null?'':' · proposed '+money(value.proposedAmountCents)} · no payment collection`;
  if(value.purpose==='renewal-price'&&value.status==='member_action_required')return 'Exact renewal price acceptance opened; the member must personally accept';
  if(value.waiverId && value.expiresAt)return 'Write-only signing tablet · '+h(value.status);
  if(value.formId && value.expiresAt && value.actorRole) return `Write-only tablet intake handoff · version ${h(value.version)} · ${h(value.status)} · expires ${when(s,value.expiresAt)}`;
  if(value.formId && value.answers) return `Intake version ${h(value.version)} · ${value.staffMade?'Staff-entered':'Member-entered'} · ${h(value.channel)} · ${value.complete?'Complete':'Required answers pending'}`;
  if (value.status === 'member_action_required' && value.url?.startsWith('/app/tuition')) return 'Payer tuition review opened; no bill accepted or payment collected';
  if (value.planId && value.month && Array.isArray(value.rows)) return `Family tuition ${h(value.month)} · ${value.rows.length} participant(s) · ${money(value.amountCents)} · ${h(value.status ?? 'accepted')}`;
  if (value.startsMonth && value.endsMonth && Array.isArray(value.rows)) return `Family tuition schedule · ${h(value.name)} · ${value.rows.length} participant(s) · ${h(value.startsMonth)} to ${h(value.endsMonth)} (exclusive)`;
  if (value.planId && value.effectiveMonth) return `Future tuition withdrawn from ${h(value.effectiveMonth)} · ${h(value.reason)} · past charges unchanged`;
  if (value.marketing && value.contactChannels) return `Preferences revision ${h(value.revision)} · email ${h(value.marketing.email)} · SMS ${h(value.marketing.sms)} · in-app ${h(value.marketing.inApp)}`;
  if (value.sourceId && value.targetId) return `Duplicate history link · ${h(value.status ?? 'confirmed')} · source ${h(value.sourceId)} · target ${h(value.targetId)} · original authority retained`;
  if (value.text && value.actorId) return `${h(value.staffMade === false ? 'Member message' : value.alert !== undefined ? 'Restricted note' : 'Staff message')}: ${h(value.text)}`;
  if (value.email && value.requestId && value.status) return `Account invitation · ${h(value.status)} · ${h(value.email)}`;
  if (value.name && value.email && value.role && !('emergencyContact' in value)) return `Created ${h(value.role)} profile · ${h(value.name)} · ${h(value.email)}`;
  if (value.householdChecked && value.verifiedBy) return `Intro identity and household verified · revision ${h(value.revision)} · ${h(value.reason)}`;
  if (Array.isArray(value.sales) && Array.isArray(value.packs)) return `Before intro sale: ${value.sales.length} intro purchase(s), ${value.packs.length} pack(s)`;
  if (value.offerId && value.offerName && value.days) return `Intro ${value.packId ? 'purchase' : 'preview'}: ${h(value.offerName)} · ${value.credits} visits for ${value.days} days · ${money(value.amountCents)} studio-balance charge${value.exceptionReason ? ` · eligibility exception: ${h(value.exceptionReason)}` : ''}${value.expiresAt ? ` · ends ${when(s,value.expiresAt)}` : ''}`;
  if (Array.isArray(value.occurrences)) return 'Private appointments · '+h(value.status)+'<br>'+value.occurrences.map((o: any)=>when(s,o.start,o.timeZone)+' · '+h(o.status)).join('<br>');
  if (Array.isArray(value.outcomes)) {
    const items = value.cancellationEffects ?? value.outcomes;
    return `Recurring reservation · ${h(value.status)}<br>` + items.map((o: any) => `${when(s, o.start, o.timeZone)} · ${h(value.status === 'cancelled' ? 'Cancelled' : value.operation === 'cancel' ? 'To cancel' : o.status)}${o.reason ? ` · ${h(o.reason.replace(/_/g,' '))}` : ''}${o.effect ? ` · ${o.effect.creditReturned ? 'credit returns' : 'no credit returned'} · ${money(o.effect.feeCents)} fee` : ''}`).join('<br>');
  }
  if (Array.isArray(value.guardianIds) && Array.isArray(value.participantIds)) return `Household ${h(value.name)} · ${value.guardianIds.length} guardian(s) · ${value.participantIds.length} participant(s) · ${value.contacts.length} contact(s) · payer ${value.payerId ? h(person(s,value.payerId)) : 'none'}${value.pendingPayer ? ` · waiting for ${h(person(s,value.pendingPayer.personId))} to accept` : ''}`
  if (value.status === 'member_action_required' && value.url === '/signin?returnTo=%2Fapp%2Fhousehold') return 'Payer acceptance door opened; no responsibility accepted for them'
  if ('emergencyContact' in value) return profileText(value)
  if (typeof value.issued === 'boolean') return value.issued ? `Check-in code revision ${h(value.codeRevision)}${value.codeIssuedAt ? ` · issued ${when(s,value.codeIssuedAt)}` : ''}` : 'No check-in code issued'
  if (typeof value.acknowledged === 'boolean') return value.acknowledged ? 'Current waiver acknowledged by the member' : 'Current waiver awaiting the member’s acknowledgement'
  if (value.waiverId && value.status) return 'Waiver sign-in link requested; delivery and acknowledgement not confirmed'
  if (value.preferenceDoor) return 'Member preference sign-in door opened; no consent granted'
  if ('dismissedAt' in value && !value.classId) return value.dismissedAt ? `Notice marked read ${when(s,value.dismissedAt)}` : 'Notice unread'
  if (value.status==='member_action_required' && value.url==='/signin?returnTo=%2Fapp%2Fpacks%23freezes') return 'Member freeze acceptance door opened; no consent made for them';
  if (value.freezeTypeId && value.startAt && !value.effects) return `Freeze request · ${h(value.status)} · ${h(value.reason)}`;
  if(value.status==='member_action_required'&&value.url==='/signin?returnTo=%2Fapp%2Fpacks%23cancellations')return 'Member contract consent or withdrawal door opened; no authority accepted for them';
  if(value.termsId&&value.digest&&value.deliveredAt)return `Full contract copy delivered ${when(s,value.deliveredAt)} · evidence ${h(value.evidenceReference)} · exact accepted copy retained`;
  if(value.region&&value.evidenceReference&&value.personId)return `Contract jurisdiction ${h(value.previousRegion??'not previously recorded')} → ${h(value.region)} · evidence ${h(value.evidenceReference)}`;
  if(value.delegateId&&value.kind)return `Contract ${h(value.kind)} authority · ${h(value.revokedAt?'revoked':value.delegateAcceptedAt?'delegate accepted':'awaiting acceptance')}`;
  if(value.bookingId&&value.evidenceReference&&value.amountCents!==undefined)return `Received service value ${money(value.amountCents)} · evidence ${h(value.evidenceReference)}`;
  if(value.paymentId&&value.chargeId)return `Actual external receipt allocated · ${money(value.amountCents)}`;
  if(value.refundId&&value.reference)return `External refund settlement recorded · ${money(value.amountCents)}`;
  if(value.cancellationId&&'settledCents' in value)return `Refund due · ${value.amountCents===null?'awaiting receipt allocation':money(value.amountCents)} · ${h(value.status)}`;
  if(value.documentedAt&&value.value)return `Statutory refund preview · ${h(value.reasonCode)} · documented ${when(s,value.documentedAt)} · ${value.value.amountCents===null?'awaiting receipt allocation':money(value.value.amountCents)} due · cancellation not submitted`;
  if(value.termsId&&value.effects&&value.effectiveAt)return `Membership cancellation · ${h(value.status)} · effective ${when(s,value.effectiveAt)} · ${value.effects.bookings.length} affected seats · no provider payment or refund`;
  if(value.termsId&&value.effectiveAt)return `Cancellation request · ${h(value.status)} · ${when(s,value.effectiveAt)}`;
  if(value.cancellationId&&value.requiresFreshAcceptance)return `Cancellation withdrawal · ${h(value.status)} · invoices stay stopped pending fresh member acceptance`;
  if(value.coolingOffDays)return `Statutory cancellation policy · ${h(value.coolingOffDays)} cooling-off days · relocation over ${h(value.relocationMiles)} miles`;
  if (value.connectionId && value.previousOrigin) return 'Recurring invoice origin reconnected; original member acceptances retained';
  if (value.status==='member_action_required' && value.url==='/signin?returnTo=%2Fapp%2Fpacks%23guests') return 'Member guest/payer consent door opened; no consent granted'
  if (value.status==='member_action_required' && value.url==='/signin?returnTo=%2Fapp%2Fmakeups') return 'Guardian/delegate sign-in door opened; no authority accepted for them'
  if (value.originalBookingId && value.cancellationEffect && value.status === 'preview') return 'Absence preview: original visit stays used; one separate expiring makeup credit';
  if (value.guardianId && value.relationship) return `${h(value.relationship)} for ${h(person(s,value.personId))} · ${h(person(s,value.guardianId))} · ${value.revokedAt ? 'revoked' : value.guardianAcceptedAt ? 'guardian accepted' : 'awaiting guardian acceptance'}${value.authorizationEvidence ? `<br>Verified authority: ${h(value.authorizationEvidence)}` : ''}`
  if (value.creditId && value.originalBookingId) return `Absence retained on the original booking; one linked makeup credit issued · ${h(value.reason)}`
  if (value.makeupCreditId && value.classId) return `Linked makeup · ${h(rows(s,'classes').find(c=>c.id===value.classId)?.title ?? 'Class')} · ${h(value.status)}`
  if (value.guestPackId || value.sponsorId && value.funding) return `Guest ${h(person(s,value.personId))} · ${h(value.status)} · ${(value.guestFunding ?? value.funding)==='pass' ? 'one separate guest pass' : money(value.guestPriceCents ?? value.amountCents)+' to the consenting payer balance'}`
  if (value.effects && value.startAt) return `Freeze ${h(value.status)} · ${when(s,value.startAt)} to ${value.endAt ? when(s,value.endAt) : 'an agreed later resumption'} · ${money(value.feeCents)} fee · ${value.effects.bookings.length} affected booking(s)`
  if (value.freezeId && value.revisedExpiresAt && value.endAt) return `Earlier resumption ${when(s,value.endAt)} · revised term ${when(s,value.revisedExpiresAt)} · ${h(value.status)}`
  if (value.intervalMonths && value.nextRenewalAt) return `Member-consented studio invoices · ${money(value.amountCents)} every ${value.intervalMonths} month(s) · ${h(value.status)} · next invoice ${when(s,value.nextRenewalAt)}`
  if (value.formula) return `Plan change preview: ${h(value.credits)} credits at ${money(value.amountCents)} · ${value.chargeCents < 0 ? `${money(-value.chargeCents)} balance credit` : `${money(value.chargeCents)} charge`} · effective ${when(s,value.effectiveAt)} · awaiting the member’s acceptance`
  if(value.friendEmail && value.personId)return `Referral recorded for owner review · ${h(value.friendEmail)} · ${h(value.source)}${value.verifiedAt?' · verified attribution':''}`;
  if(value.terms?.renewsAutomatically === false && value.terms?.collection === 'studio-balance-only')return `Finite membership offer ${h(value.terms.name)} · ${money(value.terms.amountCents)} · ${h(value.terms.days)} days · ${h(value.status)} · no automatic renewal`;
  if(value.lifecycleOfferId && value.entitlement?.kind === 'unlimited')return `Finite membership ${h(value.entitlement.name)} · unlimited eligible visits · ${money(value.amountCents)} studio-balance charge · ends ${when(s,value.expiresAt)} · no automatic renewal`;
  if ('credits' in value && 'remaining' in value && !value.classId) return `Pack: ${h(value.remaining)} of ${h(value.credits)} credits available · ${money(value.amountCents)} · ends ${when(s,value.expiresAt)}`
  if (['late_cancel_fee','no_show_fee'].includes(value.reason)) return `${money(value.amountCents)} attendance fee · ${h(value.status ?? 'pending')}${value.receipt ? ` · external receipt ${h(value.receipt.reference)}` : ''}${value.reversal ? ` · waived: ${h(value.reversal.note)}` : ''}`
  if (value.classId) {
    const c = rows(s,'classes').find(c => c.id === value.classId)
    return `${h(c?.title ?? 'Class booking')} · ${h(value.status)}${value.spot ? ` · ${h(value.spot)}` : ''}${value.cancellation ? ` · ${h(value.cancellation)}` : ''}${value.checkedInAt ? ` · checked in ${when(s,value.checkedInAt)}` : ''}`
  }
  throw new Error('Unsupported staff action effect')
}

const actionLabels: Record<string,string> = {'billing.receipt.send.staff':'Email requested invoice or receipt','course.enrollment.prepare':'Preview course enrollment','course.enrollment.launch':'Launch course payer review','course.enrollment.confirm':'Confirm course enrollment','course.withdraw.prepare':'Preview course withdrawal','course.withdraw.confirm':'Confirm course withdrawal','billing.agreement.prepare':'Prepare exact additional agreement','billing.agreement.accept.launch':'Open personal agreement signing','billing.setup.start.launch':'Open personal method authorization','billing.setup.complete.launch':'Open personal authorization status','billing.mandate.revoke.launch':'Open personal payment revocation','attendance.availability.launch':'Open member availability','attendance.plan.accept.staff':'Book accepted attendance option','appointment.save':'Private series reserved','appointment.move':'Private appointment moved','appointment.cancel':'Private appointments cancelled','appointment.restore':'Private appointments restored','appointment.restore.prepare':'Preview private restoration','appointment.reservation.prepare':'Preview private reservation','appointment.reservation.confirm':'Save private reservation','appointment.move.prepare':'Preview private move','appointment.cancel.prepare':'Preview private cancellations','appointment.change.confirm':'Confirm private change','plan.disclosure.accept.launch':'Open exact renewal price acceptance','plan.disclosure.schedule':'Schedule exact renewal disclosure','plan.disclosure.cancel':'Cancel scheduled disclosure','lead.referral.record':'Record member referral','lead.winback.purchase':'Accept exact win-back membership','lead.winback.reward':'Review attended referral reward','lead.nurture.purchase':'Accept exact intro membership offer','lead.empty.accept':'Accept approved class offer','lead.empty.settle':'Review attended class incentive','intake.tablet.launch':'Launch locked member intake','intake.submit.staff':'Enter member intake answers','family.tuition.save':'Set family tuition schedule','family.bill.preview':'Preview monthly family bill','family.bill.launch':'Open exact payer tuition review','family.participant.withdraw':'Withdraw future participant tuition','preferences.save.staff':'Record member preferences','member.message.send.staff':'Send in-app staff message','member.record.create':'Create member profile','member.record.invite':'Send member invitation','member.note.add':'Add restricted note','member.merge.prepare':'Review duplicate member identities','member.merge.confirm':'Link duplicate member history','household.save':'Save household','household.guardian.link':'Link household guardian','household.guardian.remove':'Remove household guardian','household.guardian.leave':'Guardian left household','household.participant.add':'Add household participant','household.participant.remove':'Remove household participant','household.contact.save':'Save household contact','household.contact.remove':'Remove household contact','household.payer.propose':'Ask a person to become household payer','household.payer.cancel':'Withdraw household payer request','household.payer.launch':'Open payer acceptance','household.payer.accept':'Household payer accepted','intro.identity.verify':'Verify intro eligibility identity','intro.preview':'Preview intro sale','intro.purchase':'Sell exact intro offer','contract.service-value.record':'Record received-service refund valuation','contract.copy.delivery.record':'Record full-contract copy delivery','contract.jurisdiction.save':'Record member contract jurisdiction','contract.authority.save':'Record verified contract authority','contract.authority.launch':'Open contract authority acceptance','contract.authority.revoke':'Revoke contract authority','contract.prepayment.record':'Allocate actual prepaid receipt','plan.cancellation.policy.save':'Set statutory cancellation policy','plan.cancellation.stop':'Stop renewal and end access at term end','plan.cancellation.statutory':'Record statutory cancellation','plan.cancellation.prepare':'Preview early termination','plan.cancellation.confirm':'Confirm exact early termination','plan.cancellation.withdraw.launch':'Open terminator withdrawal door','plan.cancellation.withdraw.prepare':'Preview cancellation withdrawal','plan.cancellation.withdraw.confirm':'Withdraw cancellation; invoices remain stopped','plan.cancellation.refund.reconcile':'Reconcile refund due','plan.cancellation.refund.settle':'Record external refund settlement','freeze.accept.launch':'Open exact freeze acceptance','freeze.end.accept.launch':'Open earlier-end acceptance','freeze.request.withdraw':'Withdraw freeze request','freeze.withdraw':'Withdraw scheduled freeze','freeze.decline':'Decline freeze request','plan.recurring.reconnect':'Reconnect invoice origin','freeze.prepare':'Preview membership freeze','freeze.confirm':'Approve membership freeze','freeze.end.prepare':'Preview earlier resumption','freeze.end.confirm':'Approve earlier resumption','plan.recurring.prepare':'Propose recurring invoices','plan.recurring.stop':'Stop future invoices','guest.preview':'Preview guest seat','guest.book':'Book guest seat','guest.consent.launch':'Open guest or payer consent','makeup.guardian.save':'Record makeup authority','makeup.guardian.launch':'Open guardian acceptance','makeup.guardian.revoke':'Revoke makeup authority','absence.preview':'Preview absence','absence.report':'Record absence','makeup.book':'Book linked makeup','reservation.prepare':'Preview recurring reservation','reservation.confirm':'Confirm recurring reservation','reservation.cancel.prepare':'Preview future cancellations','reservation.cancel.confirm':'Cancel future reservations','mail.preference.launch':'Open member message preferences','fee.collect':'Record fee receipt','fee.waive':'Waive attendance fee',schedule:'Change class schedule','booking.desk':'Book at desk','booking.cancel':'Cancel booking',cancel:'Cancel booking','booking.spot':'Move spot','booking.offer.accept':'Accept offer',accept:'Accept offer','booking.move':'Move booking',move:'Move booking','booking.restore':'Restore booking',restore:'Restore booking','booking.waitlist.position':'Change waitlist position',position:'Change waitlist position',waitlist:'Join waitlist','attendance.checkin':'Check in','checkin.code.staff':'Read or issue check-in code','checkin.rotate':'Replace check-in code','waiver.tablet.launch':'Launch locked signing tablet','waiver.launch':'Request waiver link','notice.dismiss.staff':'Mark notice read','recognition.launch':'Open member recognition preferences','plan.change.prepare':'Preview plan change','profile.save.staff':'Edit member profile','person.save':'Change name, email or phone'}
const actionLabel = (action: string) => { if (!actionLabels[action]) throw new Error('Staff action needs a display label'); return actionLabels[action] }

/** Screen and downloads share the same canonical staff-history projection. */
export function staffActionHistory(s: any, query = new URLSearchParams()) {
  if (!owner(s)) return ''
  const chosen = rows(s,'people').find(p => p.id === query.get('person'))
  const report = staffHistory(s,query), events = report.rows
  const options = (key: string) => [...new Set(rows(s,'staffActions').map(a => key === 'command' ? a.command ?? a.action : a[key]))].sort().map(value => [value,value] as [string,string])
  const preserved = [...query].filter(([key]) => !historyFilters.includes(key as any) || key === 'person').map(([key,value]) => hidden(key,value)).join('')
  const controls = `<form method="get" action="/app/people#staff-actions" class="form">${preserved}`
    + select('auditActor','Acting staff member',[['','All staff'],...options('actorId')],query.get('auditActor') ?? '', 'aria-label="Acting staff member"')
    + select('auditRight','Action right',[['','All rights'],...options('right')],query.get('auditRight') ?? '', 'aria-label="Action right"')
    + select('auditChannel','Action channel',[['','All channels'],...options('channel')],query.get('auditChannel') ?? '', 'aria-label="Action channel"')
    + select('auditCommand','Action command',[['','All commands'],...options('command')],query.get('auditCommand') ?? '', 'aria-label="Action command"')
    + field('auditFrom','Action from date',query.get('auditFrom'),'date') + field('auditTo','Action through date',query.get('auditTo'),'date')
    + '<button class="btn" type="submit">Filter staff actions</button></form>'
  const exportQuery = new URLSearchParams([...query].filter(([key]) => historyFilters.includes(key as any)))
  const downloads = `<p><a class="btn quiet" href="/api/strap/staff-history.csv?${h(exportQuery.toString())}">Download staff history CSV</a> <a href="/api/strap/staff-history?${h(exportQuery.toString())}">Open staff history JSON</a></p>`

  const list = events.map(a => `<tr data-staff-command="${h(a.command ?? a.action)}">${cell('When / member', `${when(s, a.at)}<small>${h(person(s, a.personId))}</small>`)}${cell('Staff / channel', `${h(a.actorId === s.actor.id ? s.displayName : a.actorId)}<small>${h(a.actorRole)} · ${h(a.channel)}</small>`)}${cell('Action', `${h(actionLabel(a.action))}<small>Right: ${h(a.right)}</small>${a.reason ? `<small>Reason: ${h(a.reason)}</small>` : ''}${a.comment ? `<small>Comment: ${h(a.comment)}</small>` : ''}`)}</tr>`
    + `<tr><td colspan="3"><details class="more"><summary>Recorded change</summary><div class="panel-body">${a.erased ? '<p class="meta">Values erased with the member’s personal data.</p>' : `<dl><dt>Before</dt><dd>${effect(s,a.before)}</dd><dt>After</dt><dd>${effect(s,a.after)}</dd></dl>`}</div></details></td></tr>`).join('')
  return panel('Staff action history', body(`<p class="meta">${chosen ? `Actions for ${h(chosen.name)}.` : 'Actions for all members. Select a person to focus their history.'}</p>`)
    + body(controls + downloads + `<p class="meta">${events.length} recorded actions. Newest first; date bounds include both days in ${h(report.timeZone)}. This is the existing staff-made history, not a complete studio audit.</p>`)
    + (list ? `<div class="table-wrap">${table(['When / member', 'Staff / channel', 'Action'], list)}</div>` : emptyLine('No staff actions recorded.')), { id: 'staff-actions', icon: 'users' })
}

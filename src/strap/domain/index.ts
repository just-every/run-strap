import { saveAbsencePolicy, saveMakeupGuardian, acceptMakeupGuardian, revokeMakeupGuardian, launchMakeupGuardian, reportAbsence, bookMakeup, makeupSnapshot } from './makeups';
import { previewGuestBooking, bookGuest, guestSnapshot } from './guest-bookings';
import { saveGuestConsent, revokeGuestConsent, launchGuestConsent } from './guest-consent';
import { createRenewalFollowup } from './renewals';
import { prepareReservations, confirmReservations, prepareReservationCancellation, confirmReservationCancellation, reservationSnapshot } from './reservations';
import { processClassReminders, saveReminderRule, completeReminderTask } from './class-reminders';
import { messagePreference, messageTemplates, saveMessagePreference, saveMessageTemplates, launchMessagePreference } from './message-settings';
import { demandEvidence, demandAvailability, prepareRecommendation, approveRecommendation, recommendationStale } from './demand';
import { collectFee, waiveFee, fees } from './fees';
import { saveQualification, requestSubstitution, prepareSubstitution, approveSubstitution, substitutionSnapshot } from './substitutions';
import { requestPlanChange, preparePlanChange, acceptPlanChange, applyDuePlanChanges, planChangeSnapshot } from './plan-changes';
import { createLead, updateLead, appendLeadNote, leadSnapshot } from './leads';
import { saveMilestone, saveRecognitionPreference, processRecognition, completeRecognition, recognitionSnapshot } from './recognition';
import { launchRecognition } from './recognition-launch';
import { savePayRule, adjustTeachingPay, teachingPay } from './teaching-pay';
import { defineCommand } from './command-catalogue';
import { dismissForMember, launchWaiver, priorStaffRequest, retainStaffAction, staffActions, staffBefore } from './staff-actions';
import { load, loadKiosk, loadSystem, Transaction } from './store';
import { DomainError, insist, list, shortName, type Actor, type Person, type RecordData, type State } from './types';
import { prepareClasses, publishClasses } from './classes';
import { prepareSeries, publishSeries, prepareSeriesChange, approveSeriesChange } from './series';
import { prepareSeriesCancellation, confirmSeriesCancellation, prepareScopedClosure, confirmScopedClosure } from './series-cancellation';
import { seriesBasis } from './series-model';
import { acknowledgeWaiver, book, bookingPack, cancel, latestWaiver, planRefused, publishWaiver } from './bookings';
import { moveBooking, restoreBooking, positionWaiter } from './booking-actions';
import { bookingActions, cancellationReasons, saveCancellationReasons } from './booking-history';
import { prepareBookingChange, approveBookingChange } from './booking-drafts';
import { deskBook } from './desk';
import { checkin, correctAttendance, markNoShow } from './attendance';
import { closureImpact, dismissNotice } from './closures';
import { confirmBooking, connectMemberMail, memberMail, type NoticeContext } from './notices';
import { acceptOffer, promoteAll, saveWaitlistPolicy, waitlistPolicy } from './waitlist';
import { checkinAlerts, staffCode, inWindow, kioskCheckin, kioskLookup, memberCheckin, ownCode, rotateCode, scanCheckin, selfCheckin } from './checkin';
import { adjustPack, approvePack, approveReminder, balance, preparePack, prepareReminder, recordPayment } from './money';
import { erasePerson, savePerson } from './people';
import { memberProfile, profileSnapshot, saveMemberProfile, saveOwnProfile } from './profiles';
import { saveStudio, studioSettings } from './studio';
import { packSummary } from './pack-credits';
import { classSpots, moveSpot, saveSpotLayout, seatCapacity, spotLayouts } from './spots';
import { saveUnavailability, removeUnavailability } from './scheduling';
import { bookingRules, bookingWindow, cancellationEffect, removeBookingRule, saveBookingRule } from './booking-policy';
export { actor } from './store';
export { DomainError } from './types';
export type { Actor, Person } from './types';

export const handlers = {
  'absence.policy.save':defineCommand(saveAbsencePolicy,['owner']),
  'makeup.guardian.save':defineCommand(saveMakeupGuardian,['owner'],{staffRight:'member-record'}),
  'makeup.guardian.accept':defineCommand(acceptMakeupGuardian,['member'],{member:{staff:'makeup.guardian.launch',right:'member-record',ownStep:true}}),
  'makeup.guardian.revoke':defineCommand(revokeMakeupGuardian,['owner','member'],{member:{staff:'makeup.guardian.revoke',right:'member-record'},staffRight:'member-record'}),
  'makeup.guardian.launch':defineCommand(launchMakeupGuardian,['owner'],{staffRight:'member-record'}),
  'absence.report':defineCommand(reportAbsence,['owner','member'],{member:{staff:'absence.report',right:'booking'},staffRight:'booking'}),
  'makeup.book':defineCommand(bookMakeup,['owner','member'],{member:{staff:'makeup.book',right:'booking'},staffRight:'booking'}),
  'guest.consent.save':defineCommand(saveGuestConsent,['member'],{member:{staff:'guest.consent.launch',right:'booking',ownStep:true}}),
  'guest.consent.revoke':defineCommand(revokeGuestConsent,['member'],{member:{staff:'guest.consent.launch',right:'booking',ownStep:true}}),
  'guest.consent.launch':defineCommand(launchGuestConsent,['owner'],{staffRight:'booking'}),
  'guest.preview':defineCommand(previewGuestBooking,['owner','member'],{member:{staff:'guest.preview',right:'booking'},staffRight:'booking'}),
  'guest.book':defineCommand(bookGuest,['owner','member'],{member:{staff:'guest.book',right:'booking'},staffRight:'booking'}),
  'renewal.followup.create':defineCommand(createRenewalFollowup,['owner']),
  'reservation.prepare':defineCommand(prepareReservations,['owner','member'],{member:{staff:'reservation.prepare',right:'booking'},staffRight:'booking'}),
  'reservation.confirm':defineCommand(confirmReservations,['owner','member'],{member:{staff:'reservation.confirm',right:'booking'},staffRight:'booking'}),
  'reservation.cancel.prepare':defineCommand(prepareReservationCancellation,['owner','member'],{member:{staff:'reservation.cancel.prepare',right:'booking'},staffRight:'booking'}),
  'reservation.cancel.confirm':defineCommand(confirmReservationCancellation,['owner','member'],{member:{staff:'reservation.cancel.confirm',right:'booking'},staffRight:'booking'}),
  'reminder.rule.save':defineCommand(saveReminderRule,['owner']),
  'reminder.task.complete':defineCommand(completeReminderTask,['owner']),
  'mail.preference.save':defineCommand(saveMessagePreference,['member'],{member:{staff:'mail.preference.launch',right:'member-record',ownStep:true}}),
  'mail.preference.launch':defineCommand(launchMessagePreference,['owner'],{staffRight:'member-record'}),
  'mail.templates.save':defineCommand(saveMessageTemplates,['owner']),
  'recommendation.prepare':defineCommand(prepareRecommendation,['owner','agent']),
  'recommendation.approve':defineCommand(approveRecommendation,['owner']),
  'substitution.qualification.save':defineCommand(saveQualification,['owner']),
  'substitution.request':defineCommand(requestSubstitution,['owner','instructor']),
  'substitution.prepare':defineCommand(prepareSubstitution,['owner']),
  'substitution.approve':defineCommand(approveSubstitution,['owner']),
  'plan.change.request':defineCommand(requestPlanChange,['member'],{member:{staff:'plan.change.prepare',right:'contract-change'}}),
  'plan.change.accept':defineCommand(acceptPlanChange,['member'],{member:{staff:'plan.change.prepare',right:'contract-change',ownStep:true}}),
  'plan.change.prepare':defineCommand(preparePlanChange,['owner'],{staffRight:'contract-change'}),
  'lead.create':defineCommand(createLead,['owner']),
  'lead.update':defineCommand(updateLead,['owner']),
  'lead.note':defineCommand(appendLeadNote,['owner']),
  'recognition.milestone.save':defineCommand(saveMilestone,['owner']),
  'recognition.preference.save':defineCommand(saveRecognitionPreference,['member'],{member:{staff:'recognition.launch',right:'member-record',ownStep:true}}),
  'recognition.launch':defineCommand(launchRecognition,['owner'],{staffRight:'member-record'}),
  'recognition.process':defineCommand((tx) => { insist(tx.who.role === 'owner' && tx.who.isOwner,'owner_required',403); return processRecognition(tx); },['owner']),
  'recognition.complete':defineCommand(completeRecognition,['owner']),
  'pay.rule.save':defineCommand(savePayRule,['owner']),
  'pay.adjust':defineCommand(adjustTeachingPay,['owner']),
  'person.save':defineCommand(savePerson,['owner']),
  'person.erase':defineCommand(erasePerson,['owner']),
  'profile.save':defineCommand(saveOwnProfile,['member'],{member:{staff:'profile.save.staff',right:'member-record'}}),
  'profile.save.staff':defineCommand(saveMemberProfile,['owner'],{staffRight:'member-record'}),
  'series.prepare':defineCommand(prepareSeries,['owner','agent']),
  'series.publish':defineCommand(publishSeries,['owner']),
  'series.change.prepare':defineCommand(prepareSeriesChange,['owner','agent']),
  'series.change.approve':defineCommand(approveSeriesChange,['owner']),
  'series.cancel.prepare':defineCommand(prepareSeriesCancellation,['owner']),
  'series.cancel.confirm':defineCommand(confirmSeriesCancellation,['owner']),
  'classes.prepare':defineCommand(prepareClasses,['owner','agent']),
  'classes.publish':defineCommand(publishClasses,['owner']),
  'scheduling.unavailable.save':defineCommand(saveUnavailability,['owner']),
  'scheduling.unavailable.remove':defineCommand(removeUnavailability,['owner']),
  'pack.prepare':defineCommand(preparePack,['owner','agent']),
  'pack.approve':defineCommand(approvePack,['owner']),
  'pack.adjust':defineCommand(adjustPack,['owner']),
  'fee.collect':defineCommand(collectFee,['owner'],{staffRight:'collection'}),
  'fee.waive':defineCommand(waiveFee,['owner'],{staffRight:'fee-waiver'}),
  'payment.record':defineCommand(recordPayment,['owner']),
  'reminder.prepare':defineCommand(prepareReminder,['owner','agent']),
  'reminder.approve':defineCommand(approveReminder,['owner']),
  'booking.change.prepare':defineCommand(prepareBookingChange,['owner','agent']),
  'booking.change.approve':defineCommand(approveBookingChange,['owner']),
  'booking.move':defineCommand(moveBooking,['owner','member','instructor'],{member:{staff:'booking.move',right:'booking'},staffRight:'booking'}),
  'booking.restore':defineCommand(restoreBooking,['owner'],{staffRight:'booking'}),
  'booking.waitlist.position':defineCommand(positionWaiter,['owner'],{staffRight:'booking'}),
  'cancellationReasons.save':defineCommand(saveCancellationReasons,['owner']),
  'booking.book':defineCommand((tx,input) => book(tx,input),['member','instructor'],{member:{staff:'booking.desk',right:'booking'}}),
  'booking.desk':defineCommand(deskBook,['owner'],{staffRight:'booking'}),
  'booking.cancel':defineCommand((tx,input) => cancel(tx,input),['owner','member','instructor'],{member:{staff:'booking.cancel',right:'booking'},staffRight:'booking'}),
  'attendance.checkin':defineCommand(checkin,['owner','instructor'],{staffRight:'check-in',denial:'instructor_required'}),
  'attendance.noshow':defineCommand(markNoShow,['owner','instructor'],{denial:'instructor_required'}),
  'attendance.correct':defineCommand(correctAttendance,['owner']),
  'closure.prepare':defineCommand(prepareScopedClosure,['owner','agent']),
  'closure.confirm':defineCommand(confirmScopedClosure,['owner']),
  'notice.dismiss':defineCommand(dismissNotice,['owner','member','instructor'],{member:{staff:'notice.dismiss.staff',right:'member-record'}}),
  'attendance.self':defineCommand(selfCheckin,['member'],{member:{staff:'attendance.checkin',right:'check-in'}}),
  'attendance.scan':defineCommand(scanCheckin,['owner','instructor'],{denial:'forbidden'}),
  'checkin.code':defineCommand(ownCode,['member'],{member:{staff:'checkin.code.staff',right:'check-in'}}),
  'checkin.rotate':defineCommand(rotateCode,['owner'],{staffRight:'check-in'}),
  'waiver.publish':defineCommand(publishWaiver,['owner']),
  'waiver.acknowledge':defineCommand(acknowledgeWaiver,['member','instructor'],{member:{staff:'waiver.launch',right:'check-in',ownStep:true}}),
  'studio.save':defineCommand(saveStudio,['owner']),
  'spots.save':defineCommand(saveSpotLayout,['owner']),
  'booking.spot':defineCommand(moveSpot,['owner','member','instructor'],{member:{staff:'booking.spot',right:'booking'},staffRight:'booking'}),
  'booking.offer.accept':defineCommand(acceptOffer,['owner','member','instructor'],{member:{staff:'booking.offer.accept',right:'booking'},staffRight:'booking'}),
  'waitlist.save':defineCommand(saveWaitlistPolicy,['owner']),
  'mail.connect':defineCommand(connectMemberMail,['owner']),
  'bookingRule.save':defineCommand(saveBookingRule,['owner']),
  'bookingRule.remove':defineCommand(removeBookingRule,['owner']),
  'checkin.code.staff':defineCommand(staffCode,['owner'],{staffRight:'check-in'}),
  'notice.dismiss.staff':defineCommand(dismissForMember,['owner'],{staffRight:'member-record'}),
  'waiver.launch':defineCommand(launchWaiver,['owner'],{staffRight:'check-in'}),
};
export const commandCatalogue = () => Object.entries(handlers).map(([name,spec]) => ({name,roles:spec.roles,memberDoor:spec.member ?? null,staffRight:spec.staffRight ?? null}));

export async function command(db: D1Database, who: Actor, name: string, input: Record<string,unknown>, context: NoticeContext = {}) {
  insist(input && typeof input === 'object' && !Array.isArray(input),'invalid_input');
  const loaded = await load(db,who), tx = new Transaction(db,loaded.state,loaded.who);
  tx.notices = context;
  if (who.role === 'agent') insist(['recommendation.prepare','classes.prepare','pack.prepare','reminder.prepare','booking.change.prepare','series.prepare','series.change.prepare'].includes(name),'agents_can_only_prepare',403);
  const spec = handlers[name as keyof typeof handlers];
  if (!spec) throw new DomainError('unknown_command',404);
  insist(who.role !== 'finance','owner_required',403);
  insist(who.role !== 'member' || spec.roles.includes('member'),spec.denial ?? 'owner_required',403);
  const staff = !!spec.staffRight && (tx.who.role === 'owner' || (name === 'attendance.checkin' && tx.who.role === 'instructor'));
  const replay = staff ? priorStaffRequest(tx,name,input) : null;
  if (replay) return replay;
  const before = staff ? staffBefore(tx,name,input) : null, priorIds = new Set([...list(tx.state,'bookingAction'),...list(tx.state,'profileChange')].map(a => a.id));
  applyDuePlanChanges(tx);
  const result = await spec.run(tx,input,context);
  if (name === 'booking.book' || (name === 'booking.desk' && result.status === 'booked')) confirmBooking(tx,result);
  if (staff) retainStaffAction(tx,name,spec.staffRight!,input,result,before,priorIds);
  processRecognition(tx);
  await tx.commit(); return result;
}
/** Runs every minute (Cron Trigger): expires unclaimed MSG-004 offers and
 * moves each freed seat on. Returns the emails it reserved, to send after commit. */
export async function sweep(db: D1Database, context: NoticeContext) {
  const loaded = await loadSystem(db), tx = new Transaction(db,loaded.state,loaded.who);
  tx.notices = context; applyDuePlanChanges(tx); promoteAll(tx); processRecognition(tx); processClassReminders(tx);
  if (tx.sql.length) await tx.commit();
}
/** The kiosk's whole surface: look up, check in a found seat, or scan a code. */
export async function kioskRead(db: D1Database, kioskId: string, query: unknown) {
  const {state} = await loadKiosk(db,kioskId); return kioskLookup(state,query);
}
export async function kioskCommand(db: D1Database, kioskId: string, name: 'checkin' | 'scan', input: Record<string,unknown>) {
  const loaded = await loadKiosk(db,kioskId), tx = new Transaction(db,loaded.state,loaded.who);
  const result = name === 'scan' ? scanCheckin(tx,input) : kioskCheckin(tx,input);
  processRecognition(tx);
  await tx.commit();
  const person = loaded.state.people.find(p => p.id === result.personId)!, entry = loaded.state.records.get(result.classId)!.data;
  return {name:shortName(person.name),classTitle:String(entry.title).split(' · ')[0],start:entry.start};
}
/** A finance user reads the revenue and collections inputs and nothing else: the owner's view, cut down to them. */
const financeKeys = ['balances','bookingActions','bookings','charges','packs','payments','studio','version'];
export async function financeSnapshot(db: D1Database, who: Actor) {
  const loaded = await load(db,who);
  insist(loaded.who.role === 'finance','owner_required',403);
  const full = await snapshotFor(loaded.state,{...loaded.who,role:'owner',isOwner:true}) as Record<string,unknown>;
  return {actor:loaded.who,people:(full.people as Person[]).map(p => ({id:p.id,name:p.name,role:p.role,active:p.active})),...Object.fromEntries(financeKeys.map(key => [key,full[key]]))};
}
export async function snapshot(db: D1Database, who: Actor) {
  const loaded = await load(db,who);
  return snapshotFor(loaded.state,loaded.who);
}
async function snapshotFor(state: State, who: Actor) {
  const owner = who.role === 'owner' || who.role === 'agent';
  const allClasses = list(state,'class');
  const classes = owner || who.role === 'member' ? allClasses : allClasses.filter(c => c.instructorId === who.personId);
  const assigned = new Set(classes.map(c => c.id));
  const classOf = new Map(allClasses.map(c => [c.id,c])), at = new Date().toISOString();
  // The cancellation effect is shown to the member and to staff, never to an instructor.
  const bookings = list(state,'booking').filter(b => owner || b.personId === who.personId || (who.role === 'instructor' && assigned.has(b.classId)))
    .map(b => b.status !== 'cancelled' && (owner || b.personId === who.personId) && classOf.get(b.classId)?.start > at ? {...b,cancelEffect:cancellationEffect(b,classOf.get(b.classId)!,at)} : b)
    .map(b => b.moveFromBookingId && b.status === 'offered' ? {...b,moveEffect:state.records.get(b.moveFromBookingId)?.data.status === 'booked' ? cancellationEffect(state.records.get(b.moveFromBookingId)!.data,classOf.get(state.records.get(b.moveFromBookingId)!.data.classId)!,at) : null} : b)
    .map(b => b.status !== 'booked' ? b : {...b,checkinOpen:inWindow(state,classOf.get(b.classId)!),...(who.role === 'owner' || who.role === 'instructor' ? {alerts:checkinAlerts(state,b,who)} : {})});
  const visibleIds = new Set([who.personId,...(who.role === 'instructor' ? bookings.map(b => b.personId) : [])]);
  const people = state.people.filter(p => !p.erasedAt && (owner || visibleIds.has(p.id))).map(p =>
    owner || p.id === who.personId ? {...p,phone:memberCheckin(state,p.id)?.phone ?? null,emergencyContact:memberProfile(state,p.id)?.emergencyContact ?? null,profileRevision:memberProfile(state,p.id)?.revision ?? 0} : {id:p.id,name:p.name,role:p.role,active:p.active});
  const own = (kind: string) => list(state,kind).filter(r => owner || r.personId === who.personId);
  const timetableBasis = owner ? await seriesBasis(state) : null;
  const timetableDraft = (d: any) => ({...d,stale:d.status === 'draft' && d.basis !== timetableBasis});
  const pay = who.role === 'owner' || who.role === 'instructor' ? teachingPay(state,who.role === 'instructor' ? who.personId : undefined) : null;
  return {makeups:makeupSnapshot(state,who),guests:guestSnapshot(state,who),...reservationSnapshot(state,who),profileChanges:profileSnapshot(state,who),classReminderRules:who.role === 'owner' ? list(state,'classReminderRule') : [],reminderTasks:who.role === 'owner' ? list(state,'reminderTask') : [],messagePreferenceLaunches:who.role === 'owner' ? list(state,'messagePreferenceLaunch') : [],messagePreference:who.role === 'member' ? messagePreference(state,who.personId!) : null,messageTemplates:who.role === 'owner' ? messageTemplates(state) : null,planChanges:planChangeSnapshot(state,who),substitutions:substitutionSnapshot(state,who),pipeline:who.role === 'owner' ? leadSnapshot(state,who) : null,recognition:recognitionSnapshot(state,who),teachingPay:pay,payRules:who.role === 'owner' ? list(state,'payRule') : who.role === 'instructor' ? list(state,'payRule').filter(r => pay?.rows.some(row => row.ruleId === r.id)) : [],series:owner ? list(state,'series') : [],seriesChanges:owner ? list(state,'draft').filter(d => ['series','series-change'].includes(d.type)).map(timetableDraft) : [],seriesCancellations:who.role === 'owner' ? list(state,'seriesCancellation').map(timetableDraft) : [],staffActions:who.role === 'owner' ? staffActions(state) : [],staffNotices:who.role === 'owner' ? list(state,'notice') : [],waiverLaunches:who.role === 'owner' ? list(state,'waiverLaunch') : [],bookingActions:who.role === 'owner' ? bookingActions(state) : [],cancellationReasons:who.role === 'owner' ? cancellationReasons(state) : [],actor:who,version:state.version,people,classes:classes.map(c => ({...c,occupancy:seatCapacity(state,c),spots:classSpots(state,c),bookingWindow:bookingWindow(state,c,who.personId && !owner ? bookingPack(state,who.personId,c) ?? planRefused(state,who.personId,c)?.pack : null)})),bookingRules:bookingRules(state),waitlistPolicy:waitlistPolicy(state),memberMail:who.role === 'owner' ? memberMail(state) : null,bookings,packs:own('pack').map(pack => ({...pack,summary:packSummary(state,pack)})),packCreditEvents:own('packCreditEvent'),fees:fees(state).filter(f => owner || f.personId === who.personId),payments:own('payment'),charges:own('charge'),
    demand:owner ? {classes:demandEvidence(state),availability:demandAvailability(state)} : null,drafts:owner?await Promise.all(list(state,'draft').map(async (d): Promise<RecordData> => ({...d,...(d.recommendation ? {stale:await recommendationStale(state,d)} : {})}))):[],approvals:owner?list(state,'approval'):[],unavailability:who.role === 'owner'?list(state,'unavailability'):[],spotLayouts:who.role === 'owner'?spotLayouts(state):[],waiver:latestWaiver(state),studio:studioSettings(state),acknowledgements:own('acknowledgement'),
    closures:who.role === 'owner' ? list(state,'closure').map(c => c.status === 'draft' ? {...c,stale:closureImpact(state,c).key !== c.impact.key} : c) : [],notices:who.role === 'member' || who.role === 'instructor' ? own('notice') : [],
    checkinCodes:who.role === 'owner' || who.role === 'member' ? own('memberCheckin').filter(r => r.code).map(r => ({personId:r.personId,code:r.code,codeRevision:r.codeRevision,codeIssuedAt:r.codeIssuedAt})) : [],
    balances:state.people.filter(p => !p.erasedAt && (owner || p.id === who.personId)).map(p => ({personId:p.id,balanceCents:balance(state,p.id)}))};
}

import { createLeadCampaign, appendLeadCampaignCost, leadCampaignSnapshot } from './lead-campaigns';
import { publishCourse, prepareEnrollment, launchCourseAcceptance, acceptCourse, confirmEnrollment, recordCoursePayment, prepareWithdrawal, confirmWithdrawal, courseAttendance, coursesSnapshot, coursePublicResult } from './courses';
import { saveAppointmentPrice } from './appointment-funding';
import { staffDeskSnapshot } from './staff-snapshot';
import { grantStaffAccess, staffAccess, legacyStaffGrants, legacyStaffGrant, hasStaffRight } from './staff-rights';
import { delegatedCommandRight, authorizeStaffCommand } from './staff-command-access';
import { currentWaivers, assertSigningEnrollments } from './bookings';
import { requireSigningLaunch, grantSigningLaunch } from './signing-access';
import { launchSigningTablet } from '../signing-tablet';
import { grantAttendanceBooking, requireAttendanceBooking } from './attendance-access';
import { saveAttendanceAvailability, prepareAttendancePlan, acceptAttendancePlan, attendancePlanSnapshot, launchAttendanceAvailability, acceptAttendancePlanForMember } from './attendance-plan';
import { grantAppointmentBooking, appointmentBookingGrant } from './appointment-access';
import { authorizeAppointmentCommand, prepareAppointmentReservation, confirmAppointmentReservation, prepareAppointmentMove, prepareAppointmentRestore, prepareAppointmentCancellation, confirmAppointmentChange, appointmentSnapshot } from './appointments';
import { saveAppointmentOffer, previewAppointmentOffer, saveAppointmentSeriesOffer, previewAppointmentSeriesOffer } from './appointment-offers';
import { previewRetentionHistory, importRetentionHistory } from './retention-history';
import { scheduleRenewalDisclosure, cancelRenewalDisclosure, launchDisclosureAcceptance, acceptDisclosurePrice, deliverRenewalDisclosures, renewalDisclosuresSnapshot } from './renewal-disclosures';
import { grantRetailStaff, retailGrant, requireRetail } from './retail-records';
import { clockIn, clockStep, requestHoursCorrection, approveHours, grantClockApprover, timeSnapshot } from './time-clock';
import { issueGift, adjustGift, savePromotion, giftSnapshot, refundGiftFunding } from './gift-cards';
import { saveSupplier, saveSku, receiveStock, countStock, transferStock, sellRetail, returnRetail, inventorySnapshot } from './inventory';
import { openDrawer, closeDrawer, drawerCash, adjustDrawer, reopenDrawer, drawerSnapshot } from './drawer';
import { launchIntakeTablet } from '../intake-tablet';
import { publishIntakeForm, submitIntake, grantSensitiveIntake, intakeSnapshot, intakeEnrollmentBasis, assertIntakeEnrollments, authorizeIntakeSubmission } from './intake';
import { saveFamilyTuition, previewFamilyBill, launchFamilyAcceptance, acceptFamilyBill, withdrawFamilyParticipant, familyTuitionSnapshot } from './family-tuition';
import { prepareRenewalSequence, approveRenewalSequence, setRenewalSequence, enrollRenewalSequence, reviewRenewalQueue } from './renewal-sequences';
import { preferencesOf, preferenceExport, saveOwnPreferences, saveStaffPreferences } from './preferences';
import { sendMemberMessage, addMemberNote, createDeskMember, grantMemberRecord, memberHistory, memberRecordGrant, requireMemberRecord, prepareMemberMerge, confirmMemberMerge } from './member-records';
import { verifyIntroIdentity, saveIntroOffer, closeIntroOffer, previewIntro, purchaseIntro, introSnapshot } from './intro-offers';
import { recordCoolingServiceValue } from './cooling-refunds';
import { recordContractDelivery, saveContractRegion } from './contract-copies';
import { requestCancellation, prepareCancellation, confirmCancellation, prepareWithdrawCancellation, confirmWithdrawCancellation, applyDueCancellations, cancellationsSnapshot, stopCancellation, statutoryCancellation, saveCancellationPolicy, cancellationBlocks, launchCancellationWithdrawal } from './contract-cancellations';
import { saveContractAuthority, acceptContractAuthority, revokeContractAuthority, launchContractAuthority } from './contract-authority';
import { recordContractPrepayment, reconcileCancellationRefund, settleCancellationRefund } from './cancellation-value';
import { acceptFreeze, acceptFreezeEnd, launchFreezeAcceptance, launchFreezeEndAcceptance, declineFreezeRequest, withdrawFreezeRequest, withdrawFreeze, freezeWithdrawal } from './freeze-lifecycle';
import { requestFreeze, prepareFreeze, confirmFreeze, prepareEndFreeze, confirmEndFreeze, saveFreezeType, applyDueFreezes, freezesSnapshot } from './freezes';
import { prepareRecurringTerms, acceptRecurringTerms, stopRecurringTerms, reconnectRecurringBilling, applyDueRecurringInvoices, recurringSnapshot, recurringForPack } from './contract-billing';
import { saveMakeupGuardian, acceptMakeupGuardian, revokeMakeupGuardian, launchMakeupGuardian } from './makeup-authority';
import { saveAbsencePolicy, previewAbsence, reportAbsence, bookMakeup, makeupSnapshot } from './makeups';
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
import { createLead, updateLead, appendLeadNote, leadSnapshot, saveRecoveryRule, processRecovery, completeRecovery, prepareEmptyPlaces, approveEmptyPlaces, acceptEmptyPlace, settleEmptyPlace, emptyPlaceSnapshot, saveNurtureSequence, pauseNurtureSequence, reviewNurture, purchaseNurture, suppressNurture, nurtureSnapshot, recordReferral, prepareWinback, approveWinback, purchaseWinback, reviewReferralReward, suppressWinback, winbackSnapshot } from './leads';
import { saveMilestone, saveRecognitionPreference, processRecognition, completeRecognition, recognitionSnapshot } from './recognition';
import { launchRecognition } from './recognition-launch';
import { savePayRule, adjustTeachingPay, teachingPay } from './teaching-pay';
import { defineCommand } from './command-catalogue';
import { dismissForMember, launchWaiver, priorStaffRequest, retainStaffAction, staffActions, staffBefore } from './staff-actions';
import { load, loadKiosk, loadSystem, Transaction } from './store';
import { DomainError, insist, list, record, shortName, type Actor, type Person, type RecordData, type State } from './types';
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
import { profileOf as profileOfForDesk, memberProfile, profileSnapshot, saveMemberProfile, saveOwnProfile } from './profiles';
import { saveStudio, studioSettings } from './studio';
import { locations, placed, saveLocation } from './locations';
import { ledgerLocation } from '../location-scope';
import { setPackLocations } from './pack-locations';
import { acceptPayer, addParticipant, cancelPayerProposal, householdSnapshot, launchPayerAcceptance, leaveGuardianship, linkGuardian, proposePayer, removeContact, removeGuardian, removeParticipant, saveContact, saveHousehold, wardsOf } from './households';
import { packSummary } from './pack-credits';
import { classSpots, moveSpot, saveSpotLayout, seatCapacity, spotLayouts } from './spots';
import { saveUnavailability, removeUnavailability } from './scheduling';
import { bookingRules, bookingWindow, cancellationEffect, removeBookingRule, saveBookingRule } from './booking-policy';
export { actor } from './store';
export { DomainError } from './types';
export type { Actor, Person } from './types';

export const handlers = {
  'course.publish':defineCommand(publishCourse,['owner']),
  'course.enrollment.prepare':defineCommand(prepareEnrollment,['owner','front-desk'],{staffRight:'sale'}),
  'course.enrollment.launch':defineCommand(launchCourseAcceptance,['owner','front-desk'],{staffRight:'sale'}),
  'course.accept':defineCommand(acceptCourse,['member'],{member:{staff:'course.enrollment.launch',right:'sale',ownStep:true},denial:'payer_acceptance_required'}),
  'course.enrollment.confirm':defineCommand(confirmEnrollment,['owner','front-desk'],{staffRight:'sale'}),
  'course.payment.record':defineCommand(recordCoursePayment,['owner']),
  'course.withdraw.prepare':defineCommand(prepareWithdrawal,['owner','front-desk'],{staffRight:'contract-change'}),
  'course.withdraw.confirm':defineCommand(confirmWithdrawal,['owner','front-desk'],{staffRight:'contract-change'}),
  'course.attendance':defineCommand(courseAttendance,['owner']),
  'staff.access.grant':defineCommand(grantStaffAccess,['owner']),
  'retention.history.preview':defineCommand(previewRetentionHistory,['owner']),
  'retention.history.import':defineCommand(importRetentionHistory,['owner']),
  'clock.in':defineCommand(clockIn,['owner','instructor']),
  'clock.out':defineCommand((tx,input)=>clockStep(tx,input,'out'),['owner','instructor']),
  'clock.break.start':defineCommand((tx,input)=>clockStep(tx,input,'break.start'),['owner','instructor']),
  'clock.break.end':defineCommand((tx,input)=>clockStep(tx,input,'break.end'),['owner','instructor']),
  'clock.correction.request':defineCommand(requestHoursCorrection,['owner','instructor']),
  'clock.approve':defineCommand(approveHours,['owner','manager']),
  'clock.approver.grant':defineCommand(grantClockApprover,['owner']),
  'retail.staff.grant':defineCommand(grantRetailStaff,['owner']),
  'retail.gift.refund':defineCommand(refundGiftFunding,['owner','front-desk'],{staffRight:'refund'}),
  'retail.gift.issue':defineCommand(issueGift,['owner','front-desk'],{staffRight:'sale'}),
  'retail.gift.adjust':defineCommand(adjustGift,['owner','front-desk'],{staffRight:'refund'}),
  'retail.promotion.add':defineCommand(savePromotion,['owner']),
  'retail.supplier.add':defineCommand(saveSupplier,['owner']),
  'retail.sku.add':defineCommand(saveSku,['owner']),
  'retail.receive':defineCommand(receiveStock,['owner']),
  'retail.count':defineCommand(countStock,['owner']),
  'retail.transfer':defineCommand(transferStock,['owner']),
  'retail.sell':defineCommand(sellRetail,['owner','front-desk'],{staffRight:'sale'}),
  'retail.return':defineCommand(returnRetail,['owner']),
  'drawer.open':defineCommand(openDrawer,['owner']),
  'drawer.close':defineCommand(closeDrawer,['owner']),
  'drawer.cash':defineCommand(drawerCash,['owner']),
  'drawer.adjust':defineCommand(adjustDrawer,['owner']),
  'drawer.reopen':defineCommand(reopenDrawer,['owner']),
  'intake.tablet.launch':defineCommand(launchIntakeTablet,['owner','front-desk'],{staffRight:'member-record'}),
  'intake.form.publish':defineCommand(publishIntakeForm,['owner']),
  'intake.sensitive.grant':defineCommand(grantSensitiveIntake,['owner']),
  'intake.submit':defineCommand((tx,input) => submitIntake(tx,input),['member'],{member:{staff:'intake.submit.staff',right:'member-record'}}),
  'intake.submit.staff':defineCommand((tx,input) => submitIntake(tx,input,true),['owner','front-desk'],{staffRight:'member-record'}),
  'family.tuition.save':defineCommand(saveFamilyTuition,['owner'],{staffRight:'membership-sale'}),
  'family.bill.preview':defineCommand(previewFamilyBill,['owner'],{staffRight:'collection'}),
  'family.bill.launch':defineCommand(launchFamilyAcceptance,['owner'],{staffRight:'collection'}),
  'family.bill.accept':defineCommand(acceptFamilyBill,['member'],{member:{staff:'family.bill.launch',right:'collection',ownStep:true}}),
  'family.participant.withdraw':defineCommand(withdrawFamilyParticipant,['owner'],{staffRight:'contract-change'}),
  'renewal.sequence.prepare':defineCommand(prepareRenewalSequence,['owner']),
  'renewal.sequence.approve':defineCommand(approveRenewalSequence,['owner']),
  'renewal.sequence.set':defineCommand(setRenewalSequence,['owner']),
  'renewal.sequence.enroll':defineCommand(enrollRenewalSequence,['owner']),
  'renewal.queue.review':defineCommand(reviewRenewalQueue,['owner']),
  'preferences.save':defineCommand(saveOwnPreferences,['member'],{member:{staff:'preferences.save.staff',right:'member-record'}}),
  'preferences.save.staff':defineCommand(saveStaffPreferences,['owner','front-desk'],{staffRight:'member-record'}),
  'member.message.send':defineCommand((tx,input) => { insist(tx.who.role === 'member','member_required',403);return sendMemberMessage(tx,input); },['member'],{member:{staff:'member.message.send.staff',right:'member-record'}}),
  'member.message.send.staff':defineCommand((tx,input) => { requireMemberRecord(tx.state,tx.who,input.personId);return sendMemberMessage(tx,input); },['owner','front-desk'],{staffRight:'member-record'}),
  'member.record.grant':defineCommand(grantMemberRecord,['owner']),
  'member.record.invite':defineCommand(() => { throw new DomainError('native_invitation_door_required',403); },['owner','front-desk'],{staffRight:'member-record'}),
  'member.record.create':defineCommand(createDeskMember,['owner','front-desk'],{staffRight:'member-record'}),
  'member.note.add':defineCommand(addMemberNote,['owner'],{staffRight:'member-record'}),
  'member.merge.prepare':defineCommand(prepareMemberMerge,['owner'],{staffRight:'member-record'}),
  'member.merge.confirm':defineCommand(confirmMemberMerge,['owner'],{staffRight:'member-record'}),
  'intro.identity.verify':defineCommand(verifyIntroIdentity,['owner'],{staffRight:'member-record'}),
  'intro.offer.save':defineCommand(saveIntroOffer,['owner']),
  'intro.offer.close':defineCommand(closeIntroOffer,['owner']),
  'intro.preview':defineCommand(previewIntro,['owner','member'],{member:{staff:'intro.preview',right:'sale'},staffRight:'sale'}),
  'intro.purchase':defineCommand(purchaseIntro,['owner','member'],{member:{staff:'intro.purchase',right:'sale'},staffRight:'sale'}),
  'contract.copy.delivery.record':defineCommand(recordContractDelivery,['owner'],{staffRight:'contract-change'}),
  'contract.jurisdiction.save':defineCommand(saveContractRegion,['owner'],{staffRight:'member-record'}),
  'plan.cancellation.policy.save':defineCommand(saveCancellationPolicy,['owner'],{staffRight:'contract-change'}),
  'contract.authority.save':defineCommand(saveContractAuthority,['owner'],{staffRight:'member-record'}),
  'contract.authority.launch':defineCommand(launchContractAuthority,['owner'],{staffRight:'member-record'}),
  'plan.cancellation.withdraw.launch':defineCommand(launchCancellationWithdrawal,['owner'],{staffRight:'contract-change'}),
  'contract.authority.accept':defineCommand(acceptContractAuthority,['member'],{member:{staff:'contract.authority.launch',right:'member-record',ownStep:true}}),
  'contract.authority.revoke':defineCommand(revokeContractAuthority,['owner','member'],{member:{staff:'contract.authority.revoke',right:'member-record'},staffRight:'member-record'}),
  'contract.service-value.record':defineCommand(recordCoolingServiceValue,['owner'],{staffRight:'contract-change'}),
  'contract.prepayment.record':defineCommand(recordContractPrepayment,['owner'],{staffRight:'collection'}),
  'plan.cancellation.stop':defineCommand(stopCancellation,['owner','member'],{member:{staff:'plan.cancellation.stop',right:'contract-change'},staffRight:'contract-change'}),
  'plan.cancellation.statutory':defineCommand(statutoryCancellation,['owner','member'],{member:{staff:'plan.cancellation.statutory',right:'contract-change'},staffRight:'contract-change'}),
  'plan.cancellation.request':defineCommand(requestCancellation,['member'],{member:{staff:'plan.cancellation.prepare',right:'contract-change'}}),
  'plan.cancellation.prepare':defineCommand(prepareCancellation,['owner'],{staffRight:'contract-change'}),
  'plan.cancellation.confirm':defineCommand(confirmCancellation,['owner'],{staffRight:'contract-change'}),
  'plan.cancellation.withdraw.prepare':defineCommand(prepareWithdrawCancellation,['owner','member'],{member:{staff:'plan.cancellation.withdraw.launch',right:'contract-change',ownStep:true},staffRight:'contract-change'}),
  'plan.cancellation.withdraw.confirm':defineCommand(confirmWithdrawCancellation,['owner','member'],{member:{staff:'plan.cancellation.withdraw.launch',right:'contract-change',ownStep:true},staffRight:'contract-change'}),
  'plan.cancellation.refund.reconcile':defineCommand(reconcileCancellationRefund,['owner'],{staffRight:'refund'}),
  'plan.cancellation.refund.settle':defineCommand(settleCancellationRefund,['owner'],{staffRight:'refund'}),
  'freeze.type.save':defineCommand(saveFreezeType,['owner']),
  'freeze.request':defineCommand(requestFreeze,['member'],{member:{staff:'freeze.prepare',right:'contract-change'}}),
  'freeze.accept':defineCommand(acceptFreeze,['member'],{member:{staff:'freeze.accept.launch',right:'contract-change',ownStep:true}}),
  'freeze.accept.launch':defineCommand(launchFreezeAcceptance,['owner'],{staffRight:'contract-change'}),
  'freeze.end.accept':defineCommand(acceptFreezeEnd,['member'],{member:{staff:'freeze.end.accept.launch',right:'contract-change',ownStep:true}}),
  'freeze.end.accept.launch':defineCommand(launchFreezeEndAcceptance,['owner'],{staffRight:'contract-change'}),
  'freeze.decline':defineCommand(declineFreezeRequest,['owner'],{staffRight:'contract-change'}),
  'freeze.request.withdraw':defineCommand(withdrawFreezeRequest,['owner','member'],{member:{staff:'freeze.request.withdraw',right:'contract-change'},staffRight:'contract-change'}),
  'freeze.withdraw':defineCommand(withdrawFreeze,['owner','member'],{member:{staff:'freeze.withdraw',right:'contract-change'},staffRight:'contract-change'}),
  'freeze.prepare':defineCommand(prepareFreeze,['owner'],{staffRight:'contract-change'}),
  'freeze.confirm':defineCommand(confirmFreeze,['owner'],{staffRight:'contract-change'}),
  'freeze.end.prepare':defineCommand(prepareEndFreeze,['owner'],{staffRight:'contract-change'}),
  'freeze.end.confirm':defineCommand(confirmEndFreeze,['owner'],{staffRight:'contract-change'}),
  'plan.disclosure.accept':defineCommand(acceptDisclosurePrice,['member'],{member:{staff:'plan.disclosure.accept.launch',right:'contract-change',ownStep:true}}),
  'plan.disclosure.accept.launch':defineCommand(launchDisclosureAcceptance,['owner'],{staffRight:'contract-change'}),
  'plan.disclosure.schedule':defineCommand(scheduleRenewalDisclosure,['owner'],{staffRight:'contract-change'}),
  'plan.disclosure.cancel':defineCommand(cancelRenewalDisclosure,['owner'],{staffRight:'contract-change'}),
  'plan.recurring.reconnect':defineCommand(reconnectRecurringBilling,['owner'],{staffRight:'contract-change'}),
  'plan.recurring.prepare':defineCommand(prepareRecurringTerms,['owner'],{staffRight:'membership-sale'}),
  'plan.recurring.accept':defineCommand(acceptRecurringTerms,['member'],{member:{staff:'plan.recurring.prepare',right:'membership-sale',ownStep:true}}),
  'plan.recurring.stop':defineCommand((tx,input)=>{const terms=record(tx.state,input.id,'recurringTerms');return terms.acceptedAt&&terms.currentPackId ? stopCancellation(tx,{...input,packId:terms.currentPackId}) : stopRecurringTerms(tx,input);},['owner','member'],{member:{staff:'plan.recurring.stop',right:'contract-change'},staffRight:'contract-change'}),
  'absence.policy.save':defineCommand(saveAbsencePolicy,['owner']),
  'makeup.guardian.save':defineCommand(saveMakeupGuardian,['owner'],{staffRight:'member-record'}),
  'makeup.guardian.accept':defineCommand(acceptMakeupGuardian,['member'],{member:{staff:'makeup.guardian.launch',right:'member-record',ownStep:true}}),
  'makeup.guardian.revoke':defineCommand(revokeMakeupGuardian,['owner','member'],{member:{staff:'makeup.guardian.revoke',right:'member-record'},staffRight:'member-record'}),
  'makeup.guardian.launch':defineCommand(launchMakeupGuardian,['owner'],{staffRight:'member-record'}),
  'absence.preview':defineCommand(previewAbsence,['owner','member'],{member:{staff:'absence.preview',right:'booking'},staffRight:'booking'}),
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
  'attendance.availability.save':defineCommand(saveAttendanceAvailability,['member'],{member:{staff:'attendance.availability.launch',right:'member-record',ownStep:true}}),
  'attendance.availability.launch':defineCommand(launchAttendanceAvailability,['owner','front-desk'],{staffRight:'member-record'}),
  'attendance.booking.grant':defineCommand(grantAttendanceBooking,['owner']),
  'attendance.plan.prepare':defineCommand(prepareAttendancePlan,['owner','agent','front-desk']),
  'attendance.plan.accept':defineCommand(acceptAttendancePlan,['member'],{member:{staff:'attendance.plan.accept.staff',right:'booking'}}),
  'attendance.plan.accept.staff':defineCommand(acceptAttendancePlanForMember,['owner','front-desk'],{staffRight:'booking'}),
  'plan.change.request':defineCommand(requestPlanChange,['member'],{member:{staff:'plan.change.prepare',right:'contract-change'}}),
  'plan.change.accept':defineCommand(acceptPlanChange,['member'],{member:{staff:'plan.change.prepare',right:'contract-change',ownStep:true}}),
  'plan.change.prepare':defineCommand(preparePlanChange,['owner'],{staffRight:'contract-change'}),
  'lead.recovery.rule.save':defineCommand(saveRecoveryRule,['owner']),
  'lead.recovery.process':defineCommand(processRecovery,['owner']),
  'lead.recovery.complete':defineCommand(completeRecovery,['owner']),
  'lead.empty.prepare':defineCommand(prepareEmptyPlaces,['owner']),
  'lead.empty.approve':defineCommand(approveEmptyPlaces,['owner']),
  'lead.empty.accept':defineCommand(acceptEmptyPlace,['owner','member'],{member:{staff:'lead.empty.accept',right:'booking'},staffRight:'booking'}),
  'lead.empty.settle':defineCommand(settleEmptyPlace,['owner'],{staffRight:'price'}),
  'lead.nurture.save':defineCommand(saveNurtureSequence,['owner']),
  'lead.nurture.pause':defineCommand(pauseNurtureSequence,['owner']),
  'lead.nurture.review':defineCommand(reviewNurture,['owner']),
  'lead.nurture.purchase':defineCommand(purchaseNurture,['owner','member'],{member:{staff:'lead.nurture.purchase',right:'membership-sale'},staffRight:'membership-sale'}),
  'lead.referral.record':defineCommand(recordReferral,['owner','front-desk','member'],{member:{staff:'lead.referral.record',right:'member-record'},staffRight:'member-record'}),
  'lead.winback.prepare':defineCommand(prepareWinback,['owner']),
  'lead.winback.approve':defineCommand(approveWinback,['owner']),
  'lead.winback.purchase':defineCommand(purchaseWinback,['owner','member'],{member:{staff:'lead.winback.purchase',right:'membership-sale'},staffRight:'membership-sale'}),
  'lead.winback.reward':defineCommand(reviewReferralReward,['owner'],{staffRight:'price'}),
  'lead.campaign.create':defineCommand(createLeadCampaign,['owner']),
  'lead.campaign.cost':defineCommand(appendLeadCampaignCost,['owner']),
  'lead.create':defineCommand(createLead,['owner']),
  'lead.update':defineCommand(updateLead,['owner']),
  'lead.note':defineCommand(appendLeadNote,['owner']),
  'recognition.milestone.save':defineCommand(saveMilestone,['owner']),
  'recognition.preference.save':defineCommand(saveRecognitionPreference,['member'],{member:{staff:'recognition.launch',right:'member-record',ownStep:true}}),
  'recognition.launch':defineCommand(launchRecognition,['owner'],{staffRight:'member-record'}),
  'recognition.process':defineCommand((tx) => { insist(tx.who.role === 'owner' && tx.who.isOwner,'owner_required',403); return processRecognition(tx); suppressNurture(tx); suppressWinback(tx); },['owner']),
  'recognition.complete':defineCommand(completeRecognition,['owner']),
  'pay.rule.save':defineCommand(savePayRule,['owner']),
  'pay.adjust':defineCommand(adjustTeachingPay,['owner']),
  'person.save':defineCommand(savePerson,['owner']),
  'person.erase':defineCommand(erasePerson,['owner']),
  'profile.save':defineCommand(saveOwnProfile,['member'],{member:{staff:'profile.save.staff',right:'member-record'}}),
  'profile.save.staff':defineCommand(saveMemberProfile,['owner','front-desk'],{staffRight:'member-record'}),
  'series.prepare':defineCommand(prepareSeries,['owner','agent']),
  'series.publish':defineCommand(publishSeries,['owner']),
  'series.change.prepare':defineCommand(prepareSeriesChange,['owner','agent']),
  'series.change.approve':defineCommand(approveSeriesChange,['owner']),
  'series.cancel.prepare':defineCommand(prepareSeriesCancellation,['owner']),
  'series.cancel.confirm':defineCommand(confirmSeriesCancellation,['owner']),
  'classes.prepare':defineCommand(prepareClasses,['owner','agent']),
  'classes.publish':defineCommand(publishClasses,['owner']),
  'appointment.price.save':defineCommand(saveAppointmentPrice,['owner']),
  'appointment.booking.grant':defineCommand(grantAppointmentBooking,['owner']),
  'appointment.reservation.prepare':defineCommand(prepareAppointmentReservation,['owner','front-desk'],{staffRight:'booking'}),
  'appointment.reservation.confirm':defineCommand(confirmAppointmentReservation,['owner','front-desk'],{staffRight:'booking'}),
  'appointment.move.prepare':defineCommand(prepareAppointmentMove,['owner','front-desk'],{staffRight:'booking'}),
  'appointment.restore.prepare':defineCommand(prepareAppointmentRestore,['owner','front-desk'],{staffRight:'booking'}),
  'appointment.cancel.prepare':defineCommand(prepareAppointmentCancellation,['owner','front-desk'],{staffRight:'booking'}),
  'appointment.change.confirm':defineCommand(confirmAppointmentChange,['owner','front-desk'],{staffRight:'booking'}),
  'appointment.series.offer.save':defineCommand(saveAppointmentSeriesOffer,['owner']),
  'appointment.series.offer.preview':defineCommand(previewAppointmentSeriesOffer,['owner']),
  'appointment.offer.save':defineCommand(saveAppointmentOffer,['owner']),
  'appointment.offer.preview':defineCommand(previewAppointmentOffer,['owner']),
  'scheduling.unavailable.save':defineCommand(saveUnavailability,['owner']),
  'scheduling.unavailable.remove':defineCommand(removeUnavailability,['owner']),
  'pack.prepare':defineCommand(preparePack,['owner','agent']),
  'pack.approve':defineCommand(approvePack,['owner']),
  'pack.adjust':defineCommand(adjustPack,['owner']),
  'pack.locations.set':defineCommand(setPackLocations,['owner']),
  'location.save':defineCommand(saveLocation,['owner']),
  'household.save':defineCommand(saveHousehold,['owner'],{staffRight:'member-record'}),
  'household.guardian.link':defineCommand(linkGuardian,['owner'],{staffRight:'member-record'}),
  'household.guardian.remove':defineCommand(removeGuardian,['owner'],{staffRight:'member-record'}),
  'household.guardian.leave':defineCommand(leaveGuardianship,['owner','member'],{member:{staff:'household.guardian.remove',right:'member-record'}}),
  'household.participant.add':defineCommand(addParticipant,['owner'],{staffRight:'member-record'}),
  'household.participant.remove':defineCommand(removeParticipant,['owner'],{staffRight:'member-record'}),
  'household.contact.save':defineCommand(saveContact,['owner'],{staffRight:'member-record'}),
  'household.contact.remove':defineCommand(removeContact,['owner'],{staffRight:'member-record'}),
  'household.payer.propose':defineCommand(proposePayer,['owner'],{staffRight:'member-record'}),
  'household.payer.cancel':defineCommand(cancelPayerProposal,['owner'],{staffRight:'member-record'}),
  'household.payer.launch':defineCommand(launchPayerAcceptance,['owner'],{staffRight:'member-record'}),
  'household.payer.accept':defineCommand(acceptPayer,['owner','member'],{member:{staff:'household.payer.launch',right:'member-record',ownStep:true}}),
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
  'waiver.signing.grant':defineCommand(grantSigningLaunch,['owner']),
  'waiver.tablet.launch':defineCommand(launchSigningTablet,['owner','front-desk'],{staffRight:'check-in'}),
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
  'waiver.launch':defineCommand(launchWaiver,['owner','front-desk'],{staffRight:'check-in'}),
};
export const commandCatalogue = () => Object.entries(handlers).map(([name,spec]) => ({name,roles:spec.roles,memberDoor:spec.member ?? null,staffRight:spec.staffRight ?? null}));

export async function command(db: D1Database, who: Actor, name: string, input: Record<string,unknown>, context: NoticeContext = {}) {
  insist(input && typeof input === 'object' && !Array.isArray(input),'invalid_input');
  const loaded = await load(db,who), tx = new Transaction(db,loaded.state,loaded.who);
  tx.notices = context;
  if (who.role === 'agent') insist(['attendance.plan.prepare','recommendation.prepare','classes.prepare','pack.prepare','reminder.prepare','booking.change.prepare','series.prepare','series.change.prepare'].includes(name),'agents_can_only_prepare',403);
  const spec = handlers[name as keyof typeof handlers];
  if (name.startsWith('booking.')) {
    const target = tx.state.records.get(String(input.id))?.data;
    const entry = tx.state.records.get(String(input.classId ?? target?.classId))?.data;
    const source = tx.state.records.get(String(target?.classId))?.data;
    insist(!entry?.privatePersonId && !source?.privatePersonId,'private_appointment_desk_review_required',403);
  }
  if (!spec) throw new DomainError('unknown_command',404);
  const delegatedRight = delegatedCommandRight(name), commonAccess = staffAccess(tx.state,tx.who);
  const delegatedStaff = !!delegatedRight && !!commonAccess && who.role !== 'member';
  if (delegatedStaff) authorizeStaffCommand(tx,name,input,delegatedRight!);
  if (who.role === 'front-desk' && !delegatedStaff) { insist(spec.roles.includes('front-desk'),'member_record_right_required',403);if (!name.startsWith('retail.') && !name.startsWith('attendance.')) requireMemberRecord(tx.state,tx.who,input.personId); }
  insist(who.role !== 'finance' && (who.role !== 'manager' || name === 'clock.approve' || delegatedStaff || (!!commonAccess?.enabled && (name.startsWith('appointment.') || spec.roles.includes('front-desk')))),'owner_required',403);
  insist(who.role !== 'member' || spec.roles.includes('member'),spec.denial ?? 'owner_required',403);
  if(name==='plan.recurring.prepare' && !delegatedStaff)insist(tx.who.role==='owner'&&tx.who.isOwner,'owner_required',403);
  if(name==='plan.recurring.accept'){insist(tx.who.role==='member','member_acceptance_required',403);const proposal=record(tx.state,input.id,'recurringTerms');insist(proposal.personId===tx.who.personId,'recurringTerms_not_found',404);}
  if(['plan.recurring.prepare','plan.recurring.accept'].includes(name)){const packId=String(input.packId??tx.state.records.get(String(input.id))?.data.packId??'');insist(!cancellationBlocks(tx.state,packId,'9999-12-31T00:00:00.000Z'),'withdraw_cancellation_before_new_agreement',409);}
  if (name.startsWith('plan.change.')) {
    const packId=String(input.packId ?? tx.state.records.get(String(input.id))?.data.packId ?? '');
    insist(!recurringForPack(tx.state,packId),'stop_recurring_invoices_before_plan_change',409);
    insist(!list(tx.state,'freeze').some(f=>f.packId===packId&&['scheduled','active'].includes(f.status)),'end_freeze_before_plan_change',409);
  }
  const staff = !!spec.staffRight && (['owner','front-desk','manager'].includes(tx.who.role) || (tx.who.staffAccess && tx.who.role === 'instructor') || (name === 'attendance.checkin' && tx.who.role === 'instructor'));
  if(name === 'intake.submit.staff') authorizeIntakeSubmission(tx,input);
  const enrollmentBasis = intakeEnrollmentBasis(tx.state);
  const signingEnrollmentBasis=new Set(list(tx.state,'pack').map(p=>p.id));
  if (name.startsWith('retail.') && ['front-desk','manager'].includes(who.role)) requireRetail(tx, name === 'retail.sell' ? 'sale' : name.slice(7), input);
  if (name.startsWith('appointment.') && !name.includes('.offer.') && !['appointment.booking.grant','appointment.price.save'].includes(name)) authorizeAppointmentCommand(tx,input);
  if(tx.who.role==='front-desk' && name.startsWith('attendance.') && !delegatedStaff) {const offer=tx.state.records.get(String(input.id))?.data,personId=String(input.personId ?? offer?.personId ?? '');const grant=legacyStaffGrant(tx.state,tx.who,'attendance-plan');const entry=tx.state.records.get(String(input.classId))?.data;requireAttendanceBooking(tx,personId,entry?[entry.locationId ?? 'studio']:grant?.locationIds ?? []);}
  if(name === 'waiver.launch' || name === 'waiver.tablet.launch') requireSigningLaunch(tx.state,tx.who,input.personId,String(input.locationId??'studio'));
  const replay = staff ? priorStaffRequest(tx,name,input) : null;
  if (replay) return name.startsWith('course.') ? coursePublicResult(tx.who,replay) : replay;
  const before = staff ? staffBefore(tx,name,input) : null, priorIds = new Set([...list(tx.state,'bookingAction'),...list(tx.state,'profileChange')].map(a => a.id));
  const privateAppointmentOffer = ['appointment.offer.save','appointment.offer.preview','appointment.series.offer.save','appointment.series.offer.preview'].includes(name);
  // A private offer must not execute unrelated due billing, notices or entitlements.
  if (!privateAppointmentOffer && !name.startsWith('appointment.')) {
    applyDueCancellations(tx); applyDueFreezes(tx); await deliverRenewalDisclosures(tx); if(!['plan.recurring.stop','plan.cancellation.stop','plan.cancellation.statutory'].includes(name)) await applyDueRecurringInvoices(tx); applyDuePlanChanges(tx);
  }
  const result = await spec.run(tx,input,context);
  assertIntakeEnrollments(tx.state,enrollmentBasis);
  assertSigningEnrollments(tx.state,signingEnrollmentBasis);
  if (name === 'freeze.confirm' || name === 'freeze.end.confirm') promoteAll(tx);
  if ((['attendance.plan.accept','attendance.plan.accept.staff'].includes(name) && !tx.state.records.has('notice:confirmation:'+result.id)) || name === 'booking.book' || (name === 'booking.desk' && result.status === 'booked')) confirmBooking(tx,result);
  const introException = (name === 'intro.preview' || name === 'intro.purchase') && !!result.exceptionReason;
  if (staff) retainStaffAction(tx,name,introException ? 'price' : spec.staffRight!,input,result,before,priorIds);
  if (!privateAppointmentOffer && !name.startsWith('appointment.')) { processRecognition(tx); suppressNurture(tx); suppressWinback(tx); }
  await tx.commit(); return name.startsWith('course.') ? coursePublicResult(tx.who,result) : result;
}
/** Runs every minute (Cron Trigger): expires unclaimed MSG-004 offers and
 * moves each freed seat on. Returns the emails it reserved, to send after commit. */
export async function sweep(db: D1Database, context: NoticeContext) {
  const loaded = await loadSystem(db), tx = new Transaction(db,loaded.state,loaded.who);
  tx.notices = context; applyDueCancellations(tx); applyDueFreezes(tx); await deliverRenewalDisclosures(tx); await applyDueRecurringInvoices(tx); applyDuePlanChanges(tx); promoteAll(tx); processRecognition(tx); suppressNurture(tx); suppressWinback(tx); processClassReminders(tx);
  if (tx.sql.length) await tx.commit();
}
/** The kiosk's whole surface: look up, check in a found seat, or scan a code. */
export async function kioskRead(db: D1Database, kioskId: string, query: unknown) {
  const {state} = await loadKiosk(db,kioskId); return kioskLookup(state,query);
}
export async function kioskCommand(db: D1Database, kioskId: string, name: 'checkin' | 'scan', input: Record<string,unknown>) {
  const loaded = await loadKiosk(db,kioskId), tx = new Transaction(db,loaded.state,loaded.who);
  const result = name === 'scan' ? scanCheckin(tx,input) : kioskCheckin(tx,input);
  processRecognition(tx); suppressNurture(tx); suppressWinback(tx);
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
  if (loaded.who.staffAccess) {
    const scope=new Set(loaded.who.locationIds),ledger={classes:full.classes as RecordData[],bookings:full.bookings as RecordData[],packs:full.packs as RecordData[],charges:full.charges as RecordData[]};
    for (const key of ['charges','payments','packs']) full[key]=(full[key] as RecordData[]).filter(row=>hasStaffRight(loaded.state,loaded.who,'exports',row.personId,ledgerLocation(row,ledger)));
    const charges=full.charges as RecordData[],payments=full.payments as RecordData[],visible=new Set([...charges,...payments].map(row=>row.personId));
    full.people=(full.people as Person[]).filter(p=>visible.has(p.id));
    full.balances=[...visible].map(personId=>({personId,balanceCents:charges.filter(r=>r.personId===personId).reduce((n,r)=>n+r.amountCents,0)-payments.filter(r=>r.personId===personId).reduce((n,r)=>n+r.amountCents,0)}));
    full.bookings=[];full.bookingActions=[];
  }
  full.bookings = (full.bookings as RecordData[]).filter(b=>!loaded.state.records.get(b.classId)?.data.privatePersonId);
  full.bookingActions = (full.bookingActions as RecordData[]).filter(a=>!String(a.command ?? a.action).startsWith('appointment.'));
  return {actor:loaded.who,people:(full.people as Person[]).map(p => ({id:p.id,name:p.name,role:p.role,active:p.active})),...Object.fromEntries(financeKeys.map(key => [key,full[key]]))};
}
/** STUDIO-002: a manager reads the revenue and attendance inputs of their locations only: classes, bookings, sales and receipts
 * attributed to those locations, and balances recomputed from those rows, never a member's whole studio balance. */
const managerKeys = ['bookingActions','bookings','charges','classes','packs','payments','studio','version'];
export async function managerSnapshot(db: D1Database, who: Actor) {
  const loaded = await load(db,who);
  insist(loaded.who.role === 'manager','owner_required',403);
  const full = await snapshotFor(loaded.state,{...loaded.who,role:'owner',isOwner:true}) as unknown as Record<string,any[]>;
  const scope = new Set(loaded.who.locationIds), ledger = {classes:full.classes,bookings:full.bookings,packs:full.packs,charges:full.charges};
  const own = (row: RecordData) => loaded.who.staffAccess ? hasStaffRight(loaded.state,loaded.who,'exports',row.personId,ledgerLocation(row,ledger)) : scope.has(ledgerLocation(row,ledger));
  const classes = full.classes.filter(c => !c.privatePersonId && (loaded.who.staffAccess ? hasStaffRight(loaded.state,loaded.who,'exports',undefined,c.locationId) : scope.has(c.locationId))), classIds = new Set(classes.map(c => c.id));
  const charges = full.charges.filter(own), payments = full.payments.filter(own), packs = full.packs.filter(p => own(p));
  const visible = new Set([...charges,...payments].map(r => r.personId));
  const balances = [...visible].sort().map(personId => ({personId,balanceCents:charges.filter(r => r.personId === personId).reduce((n,r) => n+r.amountCents,0)-payments.filter(r => r.personId === personId).reduce((n,r) => n+r.amountCents,0)}));
  const people = (full.people as unknown as Person[]).filter(p => visible.has(p.id) || packs.some(pack => pack.personId === p.id)).map(p => ({id:p.id,name:p.name,role:p.role,active:p.active}));
  const places = (full.locations as unknown as {id:string;name:string;timeZone:string}[]).filter(l => scope.has(l.id));
  // The business's own identity and clock, never the original location's address, phone or hours unless it is one of theirs.
  const studio = {id:'studio',location:places.map(l => l.name).join(' · '),timeZone:places[0]?.timeZone ?? 'UTC',legalName:(full.studio as unknown as {legalName?:string}|null)?.legalName ?? null};
  return {actor:loaded.who,people,locations:places,studio,timeClock:timeSnapshot(loaded.state,loaded.who),version:full.version,classes,packs,charges,payments,balances,
    bookings:full.bookings.filter(b => classIds.has(b.classId) && (!loaded.who.staffAccess || hasStaffRight(loaded.state,loaded.who,'exports',b.personId,loaded.state.records.get(b.classId)?.data.locationId ?? 'studio'))),bookingActions:full.bookingActions.filter(a => classIds.has(a.classId) && (!loaded.who.staffAccess || hasStaffRight(loaded.state,loaded.who,'exports',a.personId,loaded.state.records.get(a.classId)?.data.locationId ?? 'studio')))};
}
export async function snapshot(db: D1Database, who: Actor, origin?: string, operational = true) {
  const loaded = await load(db,who);
  const connection=await db.prepare("SELECT connection_id,origin FROM st_contract_connections WHERE id='billing'").first<{connection_id:string;origin:string}>();
  return {...await snapshotFor(loaded.state,loaded.who,connection,origin,operational),renewalDisclosures:await renewalDisclosuresSnapshot(db,loaded.state,loaded.who)};
}
async function snapshotFor(state: State, who: Actor, connection?: {connection_id:string;origin:string}|null, origin?: string, operational = true) {
  if (who.role === 'front-desk' || operational && who.staffAccess && ['manager','instructor'].includes(who.role)) {
    const grant = memberRecordGrant(state,who);
    const members = grant?.enabled ? state.people.filter(p => !p.erasedAt && grant.memberIds.includes(p.id)) : [];
    const appointmentGrant = appointmentBookingGrant(state,who);
    const savedSigningGrant=state.records.get('signing-checkin-grant:'+who.personId)?.data;
    const signingGrant=grant?.enabled && savedSigningGrant?.enabled && savedSigningGrant.recordGrantVersion===grant.version && savedSigningGrant.memberIds.some((id: string)=>grant.memberIds.includes(id)) && savedSigningGrant.locationIds.length ? savedSigningGrant : null;
    return {leadCampaigns:leadCampaignSnapshot(state,who),courseTuition:coursesSnapshot(state,who),attendancePlans:attendancePlanSnapshot(state,who),...deskRetailSnapshot(state,who),...appointmentSnapshot(state,who),appointmentGrant,appointmentInstructors:appointmentGrant?.enabled ? state.people.filter(p=>p.role === 'instructor' && p.active).map(p=>({id:p.id,name:p.name})) : [],signingGrant,locations:locations(state).filter(l=>appointmentGrant?.enabled && appointmentGrant.locationIds.includes(l.id) || signingGrant?.enabled && signingGrant.locationIds.includes(l.id)),winback:winbackSnapshot(state,who),intake:intakeSnapshot(state,who),actor:who,version:state.version,studio:studioSettings(state),people:members.map(p => ({...p,...profileOfForDesk(state,p)})),
      memberRecords:members.map(p => memberHistory(state,who,p.id)),recordGrant:grant,bookingActions:[],staffActions:[],waiver:signingGrant?latestWaiver(state):null,waivers:signingGrant?currentWaivers(state):[],drafts:[],profileChanges:[],charges:[],payments:[],waiverLaunches:[],...reservationSnapshot(state,who),...staffDeskSnapshot(state,who)};
  }
  const owner = who.role === 'owner' || who.role === 'agent';
  const allClasses = list(state,'class');
  const classes = (owner || who.role === 'member' ? allClasses : allClasses.filter(c => c.instructorId === who.personId)).filter(c => !c.privatePersonId || who.role === 'owner' || c.privatePersonId === who.personId || (who.role === 'instructor' && c.instructorId === who.personId));
  const assigned = new Set(classes.map(c => c.id));
  const classOf = new Map(allClasses.map(c => [c.id,c])), at = new Date().toISOString();
  // MEM-002: a guardian reaches the participants they book and sign for, and nothing else of the household.
  const wards = who.role === 'member' ? wardsOf(state,who.personId) : new Set<string>();
  // The cancellation effect is shown to the member and to staff, never to an instructor.
  const bookings = list(state,'booking').filter(b=>who.role !== 'agent' || !classOf.get(b.classId)?.privatePersonId).filter(b => owner || b.personId === who.personId || wards.has(b.personId) || (who.role === 'instructor' && assigned.has(b.classId)))
    .map(b => b.status !== 'cancelled' && (owner || b.personId === who.personId || wards.has(b.personId)) && classOf.get(b.classId)?.start > at ? {...b,cancelEffect:cancellationEffect(b,classOf.get(b.classId)!,at)} : b)
    .map(b => b.moveFromBookingId && b.status === 'offered' ? {...b,moveEffect:state.records.get(b.moveFromBookingId)?.data.status === 'booked' ? cancellationEffect(state.records.get(b.moveFromBookingId)!.data,classOf.get(state.records.get(b.moveFromBookingId)!.data.classId)!,at) : null} : b)
    .map(b => b.status !== 'booked' ? b : {...b,checkinOpen:inWindow(state,classOf.get(b.classId)!),...(who.role === 'owner' || who.role === 'instructor' ? {alerts:checkinAlerts(state,b,who)} : {})});
  const visibleIds = new Set([who.personId,...wards,...(who.role === 'instructor' ? bookings.map(b => b.personId) : [])]);
  const people = state.people.filter(p => !p.erasedAt && (owner || visibleIds.has(p.id))).map(p =>
    owner || p.id === who.personId ? {...p,phone:memberCheckin(state,p.id)?.phone ?? null,emergencyContact:memberProfile(state,p.id)?.emergencyContact ?? null,profileRevision:memberProfile(state,p.id)?.revision ?? 0} : {id:p.id,name:p.name,role:p.role,active:p.active});
  const own = (kind: string) => list(state,kind).filter(r => owner || r.personId === who.personId);
  const withWards = (kind: string) => list(state,kind).filter(r => owner || r.personId === who.personId || wards.has(r.personId));
  const timetableBasis = owner ? await seriesBasis(state) : null;
  const timetableDraft = (d: any) => ({...d,stale:d.status === 'draft' && d.basis !== timetableBasis});
  const pay = who.role === 'owner' || who.role === 'instructor' ? teachingPay(state,who.role === 'instructor' ? who.personId : undefined) : null;
  const frozen=freezesSnapshot(state,who);frozen.freezes=frozen.freezes.map(f=>({...f,withdrawal:freezeWithdrawal(state,record(state,f.id,'freeze'))}));
  return {leadCampaigns:leadCampaignSnapshot(state,who),courseTuition:coursesSnapshot(state,who),staffAccessGrants:who.role==='owner'?list(state,'staffAccess'):[],attendanceBookingGrants:who.role==='owner'?legacyStaffGrants(state,'attendanceBookingGrant'):[],attendancePlans:attendancePlanSnapshot(state,who),timeClock:timeSnapshot(state,who),gifts:who.role==='owner' ? giftSnapshot(state) : null,retail:who.role==='owner' ? inventorySnapshot(state) : null,drawers:who.role==='owner' ? drawerSnapshot(state) : null,intake:intakeSnapshot(state,who),familyTuition:familyTuitionSnapshot(state,who),renewalSequences:who.role === 'owner' ? list(state,'renewalSequence') : [],renewalSequencePreviews:who.role === 'owner' ? list(state,'renewalSequencePreview') : [],marketingMessages:who.role === 'owner' ? list(state,'marketingMessage') : [],memberPreferences:who.role === 'member' ? preferenceExport(state,who,who.personId!) : null,memberMessages:who.role === 'member' ? list(state,'memberMessage').filter(m => m.personId === who.personId) : [],memberRecords:who.role === 'owner' ? state.people.filter(p => p.role === 'member' && !p.erasedAt).map(p => memberHistory(state,who,p.id)) : [],memberRecordGrants:who.role === 'owner' ? legacyStaffGrants(state,'memberRecordGrant') : [],memberMergePreviews:who.role === 'owner' ? list(state,'memberMergePreview') : [],intros:introSnapshot(state,who),cancellations:await cancellationsSnapshot(state,who),freezes:frozen,recurring:recurringSnapshot(state,who,connection,origin),makeups:makeupSnapshot(state,who),guests:guestSnapshot(state,who),...reservationSnapshot(state,who),...appointmentSnapshot(state,who),profileChanges:profileSnapshot(state,who),classReminderRules:who.role === 'owner' ? list(state,'classReminderRule') : [],reminderTasks:who.role === 'owner' ? list(state,'reminderTask') : [],messagePreferenceLaunches:who.role === 'owner' ? list(state,'messagePreferenceLaunch') : [],messagePreference:who.role === 'member' ? messagePreference(state,who.personId!) : null,messageTemplates:who.role === 'owner' ? messageTemplates(state) : null,planChanges:planChangeSnapshot(state,who),substitutions:substitutionSnapshot(state,who),winback:winbackSnapshot(state,who),nurture:nurtureSnapshot(state,who),emptyPlaces:emptyPlaceSnapshot(state,who),pipeline:who.role === 'owner' ? leadSnapshot(state,who) : null,recognition:recognitionSnapshot(state,who),teachingPay:pay,payRules:who.role === 'owner' ? list(state,'payRule') : who.role === 'instructor' ? list(state,'payRule').filter(r => pay?.rows.some(row => row.ruleId === r.id)) : [],series:owner ? list(state,'series') : [],seriesChanges:owner ? list(state,'draft').filter(d => ['series','series-change'].includes(d.type)).map(timetableDraft) : [],seriesCancellations:who.role === 'owner' ? list(state,'seriesCancellation').map(timetableDraft) : [],staffActions:who.role === 'owner' ? staffActions(state) : [],staffNotices:who.role === 'owner' ? list(state,'notice') : [],waiverLaunches:who.role === 'owner' ? list(state,'waiverLaunch') : [],bookingActions:who.role === 'owner' ? bookingActions(state) : [],cancellationReasons:who.role === 'owner' ? cancellationReasons(state) : [],actor:who,version:state.version,people,classes:classes.map(c => ({...c,...placed(state,c),occupancy:seatCapacity(state,c),spots:classSpots(state,c),bookingWindow:bookingWindow(state,c,who.personId && !owner ? bookingPack(state,who.personId,c) ?? planRefused(state,who.personId,c)?.pack : null)})),bookingRules:bookingRules(state),waitlistPolicy:waitlistPolicy(state),memberMail:who.role === 'owner' ? memberMail(state) : null,bookings,packs:withWards('pack').map(pack => ({...pack,summary:packSummary(state,pack)})),packCreditEvents:withWards('packCreditEvent').filter(e=>who.role !== 'agent' || !classOf.get(e.classId)?.privatePersonId),fees:fees(state).filter(f => owner || f.personId === who.personId),payments:own('payment'),charges:own('charge'),
    demand:owner ? {classes:demandEvidence(state),availability:demandAvailability(state)} : null,drafts:owner?await Promise.all(list(state,'draft').map(async (d): Promise<RecordData> => ({...d,...(d.recommendation ? {stale:await recommendationStale(state,d)} : {})}))):[],approvals:owner?list(state,'approval'):[],unavailability:who.role === 'owner'?list(state,'unavailability'):[],spotLayouts:who.role === 'owner'?spotLayouts(state):[],waiver:latestWaiver(state),waivers:currentWaivers(state),studio:studioSettings(state),households:householdSnapshot(state,who),householdPayerChanges:who.role === 'owner' ? list(state,'householdPayerChange') : [],locations:locations(state),packLocationChanges:who.role === 'owner' ? list(state,'packLocationChange') : [],acknowledgements:withWards('acknowledgement').map(a=>who.role==='agent'||who.role==='instructor'?{id:a.id,personId:a.personId,waiverId:a.waiverId,createdAt:a.createdAt}:a),
    closures:who.role === 'owner' ? list(state,'closure').map(c => c.status === 'draft' ? {...c,stale:closureImpact(state,c).key !== c.impact.key} : c) : [],notices:who.role === 'member' || who.role === 'instructor' ? withWards('notice') : [],
    checkinCodes:who.role === 'owner' || who.role === 'member' ? own('memberCheckin').filter(r => r.code).map(r => ({personId:r.personId,code:r.code,codeRevision:r.codeRevision,codeIssuedAt:r.codeIssuedAt})) : [],
    balances:state.people.filter(p => !p.erasedAt && (owner || p.id === who.personId)).map(p => ({personId:p.id,balanceCents:balance(state,p.id)}))};
}

export function deskRetailSnapshot(state: State, who: Actor) {
  const grant = retailGrant(state,who);
  if (!['front-desk','manager'].includes(who.role)) return {};
  if (!grant?.enabled || (!grant.sale && !grant.refund)) return {};
  const inventory = inventorySnapshot(state), all = giftSnapshot(state);
  const visible = (c: RecordData) => hasStaffRight(state,who,'sale',c.personId,c.locationId,'retail') || hasStaffRight(state,who,'refund',c.personId,c.locationId,'retail');
  const cards = all.cards.filter(visible);
  const gifts = {cards:cards.map(({id,personId,locationId,balanceCents}: any) => ({id,personId,locationId,balanceCents})),entries:[],promotions:all.promotions,uses:[],refunds:[],liabilityCents:cards.reduce((n,c) => n+c.balanceCents,0)};
  const retail = {...inventory,suppliers:[],receipts:[],returns:[],movements:[],actions:[],sales:inventory.sales.filter(c => visible(c)),stock:inventory.stock.filter(c => grant.locationIds.includes(c.locationId))};
  return {saleGrant:grant,gifts,retail,drawers:{sessions:[],adjustments:[]},locations:locations(state).filter(l => grant.locationIds.includes(l.id)),retailPeople:state.people.filter(p => grant.memberIds.includes(p.id)).map(p => ({id:p.id,name:p.name,role:p.role,active:p.active}))};
}

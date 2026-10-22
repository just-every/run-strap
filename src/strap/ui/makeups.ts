import { classService } from '../domain/booking-policy';
import { serviceKey } from '../domain/pack-credits';
import { body, emptyLine, field, form, h, hidden, owner, panel, rows, select } from './shared';
import { effectText } from './booking-rules';
import { bookingControls } from './booking-actions';
import { when, whenLabel } from './format';

const path = '/app/makeups';
const request = () => hidden('requestId',crypto.randomUUID());
const channel = () => select('channel','Reported by',[['desk','At the desk'],['phone','Phone'],['inbox','Inbox']]);
/** Only the explicitly scoped makeup snapshot is used for guardian records. */
export function makeupsPanel(s: any) {
  const data = s.makeups ?? {policies:[],guardians:[],credits:[],absences:[],bookings:[]};
  const participantName = (id: string) => data.participants?.find((p: any)=>p.id===id)?.name ?? 'Participant';
  const staff = owner(s), classes = rows(s,'classes'), classLabel = (classId: string) => {
    const entry = classes.find(c => c.id === classId);
    return entry ? `${entry.title} · ${whenLabel(s, entry.start, entry.timeZone)}` : 'Original class';
  };
  const report = data.bookings.filter((b: any) => b.status === 'booked' && b.packId && !b.attendance && !b.makeupCreditId).map((b: any) =>
    `<div data-absence-booking="${h(b.id)}"><h3>${h(participantName(b.personId))} · ${h(classLabel(b.classId))}</h3>` + form('absence.preview',path,hidden('id',b.id)+request()+field('reason','Absence reason','','text','required maxlength="500"')+(staff ? channel() : ''),'Review absence')+'</div>').join('');
  const previews = (data.previews ?? []).filter((p: any) => p.status === 'preview' && p.expiresAt > new Date().toISOString()).map((p: any) =>
    `<article data-absence-preview="${h(p.id)}"><h3>Review absence · ${h(participantName(p.personId))}</h3><p>${h(classLabel(data.bookings.find((b: any)=>b.id===p.originalBookingId)?.classId))}</p><p>${h(effectText(p.cancellationEffect,false))} Recording an absence keeps the original visit used and grants a separate makeup credit.</p><p>${h(p.reason)}</p>`
    + form('absence.report',path,hidden('id',p.originalBookingId)+hidden('previewId',p.id)+hidden('key',p.key)+hidden('reason',p.reason)+request()+(staff ? hidden('channel',p.channel) : ''),'Confirm absence')+'</article>').join('');
  const credits = data.credits.map((credit: any) => {
    const booking = data.bookings.find((b: any) => b.id === credit.bookingId);
    const originalClassId = data.absences.find((a: any)=>a.id===credit.absenceId)?.classId;
    const choices = classes.filter(c => c.id!==originalClassId && serviceKey(classService(c))===serviceKey(credit.service) && c.status === 'published' && c.start > new Date().toISOString() && c.start < credit.expiresAt).map(c => [c.id,classLabel(c.id)] as [unknown,unknown]);
    if (credit.voidedAt) return `<div data-makeup-credit="${h(credit.id)}"><h3>${h(participantName(credit.personId))} · Makeup voided</h3><p>The original absence was restored. This credit can no longer be used.</p></div>`;
    return `<div data-makeup-credit="${h(credit.id)}"><h3>${h(participantName(credit.personId))} · Makeup · ${h(credit.service)}</h3><p>Original: ${h(classLabel(data.absences.find((a: any) => a.id === credit.absenceId)?.classId))}. Expires ${when(s,credit.expiresAt)}. ${booking ? 'Reserved for '+h(classLabel(booking.classId)) : 'One visit available.'}</p>`
      + (!credit.bookingId && credit.expiresAt > new Date().toISOString() && choices.length ? form('makeup.book',path,hidden('creditId',credit.id)+request()+select('classId','Replacement class',choices)+(staff ? channel() : ''),'Book makeup') : '')
      + (booking?.status==='booked' && booking.cancelEffect ? `<p>${h(effectText(booking.cancelEffect,false))}</p>`+form('booking.cancel',path,hidden('id',booking.id)+hidden('terms',booking.cancelEffect.key)+request()+(staff ? hidden('channel','desk')+hidden('cancelReason','Other')+hidden('mode','late') : ''),'Cancel makeup','quiet')
        + (staff ? bookingControls(s,classes.find(c=>c.id===booking.classId),booking,path) : `<details><summary>Move makeup</summary>${form('booking.move',path,hidden('id',booking.id)+hidden('terms',booking.cancelEffect.key)+request()+select('classId','Move to class',choices.filter(([key]: any)=>key!==booking.classId)),'Move makeup','quiet')}</details>`) : '')+'</div>';
  }).join('');
  const relationships = data.guardians.map((r: any) => {
    const legal = r.relationship === 'legal-guardian', expired = legal && (!r.adultAt || r.adultAt <= new Date().toISOString());
    const ownGuardian = s.actor.personId === r.guardianId, ownParticipant = s.actor.personId === r.personId;
    const mayAccept = !staff && !r.revokedAt && !expired && ((ownGuardian && !r.guardianAcceptedAt) || (!legal && ownParticipant && !r.participantAcceptedAt));
    return `<div><p>${h(participantName(r.personId))} · ${h(legal ? 'Verified legal guardian' : 'Adult delegate')} · ${r.revokedAt ? 'Revoked' : expired ? 'Expired' : r.guardianAcceptedAt && (legal || r.participantAcceptedAt) ? 'Accepted' : 'Awaiting acceptance'}${legal && r.adultAt ? ' · Ends '+when(s,r.adultAt) : ''}</p>`
      + (mayAccept ? form('makeup.guardian.accept',path,hidden('id',r.id),'Accept makeup authority','quiet') : '')
      + (!r.revokedAt && (staff || ownGuardian || (!legal && ownParticipant)) ? form('makeup.guardian.revoke',path,hidden('id',r.id)+(staff ? field('reason','Reason for revoking authority','','text','required maxlength="500"') : ''),'Revoke makeup authority','quiet') : '')+'</div>';
  }).join('');
  const undo = staff ? data.absences.filter((a: any) => !a.restoredAt && data.credits.some((c: any)=>c.id===a.creditId && !c.bookingId && !c.reservedAt && !c.voidedAt) && classes.some(c=>c.id===a.classId && c.start>new Date().toISOString())).map((a: any) =>
    `<div data-absence-restore="${h(a.originalBookingId)}"><h3>${h(participantName(a.personId))} · ${h(classLabel(a.classId))}</h3><p>Restore the original seat and void the unused makeup credit.</p>`+form('booking.restore',path,hidden('id',a.originalBookingId)+request()+field('reason','Reason for restoring absence','','text','required maxlength="500"')+channel(),'Restore absence','quiet')+'</div>').join('') : '';
  const offers=data.bookings.filter((b: any)=>b.status==='offered'&&b.moveFromBookingId).map((b: any)=>form('booking.offer.accept',path,hidden('id',b.id)+hidden('terms',data.bookings.find((source: any)=>source.id===b.moveFromBookingId)?.cancelEffect?.key ?? '')+request()+(staff ? hidden('channel','desk')+hidden('cancelReason','Other')+hidden('mode','late') : ''),'Confirm offered makeup move','quiet')).join('');
  const settings = staff ? form('absence.policy.save',path,field('service','Eligible class service','','text','required')+field('noticeHours','Minimum notice in hours',0,'number','required min="0" max="8760"')+field('expiryDays','Makeup expires days after original class',30,'number','required min="1" max="365"')+field('maxCredits','Maximum makeup credits (optional)','','number','min="1"')+field('capDays','Rolling elapsed days for the cap (optional)','','number','min="1"')+'<p>Enter both cap fields, or leave both blank for no cap.</p>','Save absence policy')
    + form('makeup.guardian.save',path,select('personId','Participant',rows(s,'people').filter(p => p.role === 'member' && p.active).map(p => [p.id,p.name]))+select('guardianId','Guardian or adult delegate',rows(s,'people').filter(p => p.role === 'member' && p.active).map(p => [p.id,p.name]))+select('relationship','Verified authority',[['legal-guardian','Legal guardian of a verified youth'],['adult-delegate','Adult delegate (participant must also accept)']])+field('authorizationEvidence','Verified youth status and legal authority, or adult delegation evidence','','text','required maxlength="500"')+field('adultOn','Date participant turns 18 (legal guardian only)','','date'),'Record makeup authority') : '';
  return panel('Absences and makeups',body('<p>An eligible absence keeps the original visit used and grants one separately expiring makeup. Replacement classes use the same service and available seats. Comp, unpaid and guest seats, no-shows, late cancels and makeup bookings never earn a credit.</p>'+settings+relationships+previews+report+undo+offers+(credits || emptyLine('No makeup credits.'))),{id:'makeups'});
}

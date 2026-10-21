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
    return entry ? `${entry.title} · ${whenLabel(s,entry.start)}` : 'Original class';
  };
  const report = data.bookings.filter((b: any) => b.status === 'booked' && b.packId && !b.attendance && !b.makeupCreditId).map((b: any) =>
    `<div data-absence-booking="${h(b.id)}"><h3>${h(participantName(b.personId))} · ${h(classLabel(b.classId))}</h3>` + form('absence.report',path,hidden('id',b.id)+request()+field('reason','Absence reason','','text','required maxlength="500"')+(staff ? channel() : ''),'Report absence')+'</div>').join('');
  const credits = data.credits.map((credit: any) => {
    const booking = data.bookings.find((b: any) => b.id === credit.bookingId);
    const originalClassId = data.absences.find((a: any)=>a.id===credit.absenceId)?.classId;
    const choices = classes.filter(c => c.id!==originalClassId && serviceKey(classService(c))===serviceKey(credit.service) && c.status === 'published' && c.start > new Date().toISOString() && c.start < credit.expiresAt).map(c => [c.id,classLabel(c.id)] as [unknown,unknown]);
    return `<div data-makeup-credit="${h(credit.id)}"><h3>${h(participantName(credit.personId))} · Makeup · ${h(credit.service)}</h3><p>Original: ${h(classLabel(data.absences.find((a: any) => a.id === credit.absenceId)?.classId))}. Expires ${when(s,credit.expiresAt)}. ${booking ? 'Reserved for '+h(classLabel(booking.classId)) : 'One visit available.'}</p>`
      + (!credit.bookingId && credit.expiresAt > new Date().toISOString() && choices.length ? form('makeup.book',path,hidden('creditId',credit.id)+request()+select('classId','Replacement class',choices)+(staff ? channel() : ''),'Book makeup') : '')
      + (booking?.status==='booked' && booking.cancelEffect ? `<p>${h(effectText(booking.cancelEffect,false))}</p>`+form('booking.cancel',path,hidden('id',booking.id)+hidden('terms',booking.cancelEffect.key)+request()+(staff ? hidden('channel','desk')+hidden('cancelReason','Other')+hidden('mode','late') : ''),'Cancel makeup','quiet')
        + (staff ? bookingControls(s,classes.find(c=>c.id===booking.classId),booking,path) : `<details><summary>Move makeup</summary>${form('booking.move',path,hidden('id',booking.id)+hidden('terms',booking.cancelEffect.key)+request()+select('classId','Move to class',choices.filter(([key]: any)=>key!==booking.classId)),'Move makeup','quiet')}</details>`) : '')+'</div>';
  }).join('');
  const relationships = data.guardians.map((r: any) => `<div><p>${h(participantName(r.personId))} · ${h(r.relationship === 'legal-guardian' ? 'Verified legal guardian' : 'Adult delegate')} · ${r.revokedAt ? 'Revoked' : r.guardianAcceptedAt && (r.relationship === 'legal-guardian' || r.participantAcceptedAt) ? 'Accepted' : 'Awaiting acceptance'}</p>`
    + (!r.revokedAt && !staff ? form('makeup.guardian.accept',path,hidden('id',r.id),'Accept makeup authority','quiet') : '')
    + (!r.revokedAt ? form('makeup.guardian.revoke',path,hidden('id',r.id),'Revoke makeup authority','quiet') : '')+'</div>').join('');
  const offers=data.bookings.filter((b: any)=>b.status==='offered'&&b.moveFromBookingId).map((b: any)=>form('booking.offer.accept',path,hidden('id',b.id)+hidden('terms',data.bookings.find((source: any)=>source.id===b.moveFromBookingId)?.cancelEffect?.key ?? '')+request()+(staff ? hidden('channel','desk')+hidden('cancelReason','Other')+hidden('mode','late') : ''),'Confirm offered makeup move','quiet')).join('');
  const settings = staff ? form('absence.policy.save',path,field('service','Eligible class service','','text','required')+field('noticeHours','Minimum notice in hours',0,'number','required min="0" max="8760"')+field('expiryDays','Makeup expires days after original class',30,'number','required min="1" max="365"'),'Save absence policy')
    + form('makeup.guardian.save',path,select('personId','Participant',rows(s,'people').filter(p => p.role === 'member' && p.active).map(p => [p.id,p.name]))+select('guardianId','Guardian or adult delegate',rows(s,'people').filter(p => p.role === 'member' && p.active).map(p => [p.id,p.name]))+select('relationship','Verified authority',[['legal-guardian','Legal guardian of a verified youth'],['adult-delegate','Adult delegate (participant must also accept)']])+field('authorizationEvidence','Verified youth status and legal authority, or adult delegation evidence','','text','required maxlength="500"'),'Record makeup authority') : '';
  return panel('Absences and makeups',body('<p>An eligible absence keeps the original visit used and grants one separately expiring makeup. Replacement classes use the same service and available seats.</p>'+settings+relationships+report+offers+(credits || emptyLine('No makeup credits.'))),{id:'makeups'});
}

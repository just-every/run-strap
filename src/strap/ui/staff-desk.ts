import { reservationsPanel } from './reservations';
import { when } from './format';
import { body, field, form, h, hidden, panel, rows, select } from './shared';
import { cancellationReason, actionChannel } from './booking-rules';

export function staffDeskPanel(s: any, personId: string, back: string) {
  const rights = new Set(s.staffPermissions ?? []), classes = rows(s,'classes').filter(c => !c.privatePersonId && c.status === 'published' && Date.parse(c.start) > Date.now());
  const identity = () => hidden('personId',personId)+hidden('requestId',crypto.randomUUID())+actionChannel();
  const picker = (name: string,label: string) => select(name,label,classes.map(c => [c.id,c.title+' · '+when(s,c.start,c.timeZone).replace(/<[^>]*>/g,'')]));
  const book = rights.has('booking') && classes.length ? form('booking.desk',back,identity()+picker('classId','Class')+select('pay','Funding',[['auto','Available pack or plan'],['unpaid','Unpaid visit']])+(rights.has('override')?field('override','Override reason','','text','maxlength="500"') : ''),'Book at desk') : '';
  const bookings = rows(s,'bookings').filter(b => b.personId === personId).map(b => {
    const c = classes.find(c => c.id === b.classId);if(!c)return '';
    const label = h(c.title)+' · '+when(s,c.start,c.timeZone)+' · '+h(b.status);
    const cancel = rights.has('booking') && b.status !== 'cancelled' ? form('booking.cancel',back,identity()+hidden('id',b.id)+hidden('terms',b.cancelEffect?.key)+cancellationReason(s)+select('mode','Cancellation choice',[['late','Apply disclosed policy'],...(rights.has('fee-waiver')? [['early','Early cancel with waiver'] as [string,string]] : [])])+field('reason','Waiver reason','','text','maxlength="500"'),'Cancel booking','quiet') : '';
    const restore = rights.has('booking') && b.status === 'cancelled' ? form('booking.restore',back,identity()+hidden('id',b.id)+field('reason','Restore reason','','text','required maxlength="500"')+(rights.has('override')?field('override','Override reason') : ''),'Restore booking','quiet') : '';
    const checkin = rights.has('check-in') && b.status === 'booked' && !b.checkedInAt ? form('attendance.checkin',back,identity()+hidden('id',b.id),'Check in member','quiet') : '';
    return '<article data-staff-booking="'+h(b.id)+'"><details class="more"><summary>'+label+'</summary><div class="panel-body">'+cancel+restore+checkin+'</div></details></article>';
  }).join('');
  return (book || bookings ? panel('Bookings at the desk',body(book+bookings),{id:'staff-bookings',icon:'calendar'}) : '')+(rights.has('booking') ? reservationsPanel(s,personId,back) : '');
}

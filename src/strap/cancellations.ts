import type { RecordData } from './domain/types';

export function filteredCancellations(actions: RecordData[], timeZone: string, query: URLSearchParams) {
  const day = (at: string) => new Intl.DateTimeFormat('en-CA',{timeZone}).format(new Date(at));
  return actions.filter(a => a.action === 'cancel')
    .filter(a => !query.get('date') || day(a.at) === query.get('date'))
    .filter(a => !query.get('classId') || a.classId === query.get('classId'))
    .filter(a => !query.get('staffId') || a.actorId === query.get('staffId'))
    .filter(a => !query.get('type') || a.type === query.get('type'))
    .sort((a,b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}
export function cancellationsCsv(s: any, query: URLSearchParams) {
  const columns = ['id','bookingId','member','class','sessionStart','cancelledAt','actorId','actorRole','channel','type','feeCents','creditReturned','reason','waiverReason','notice','mail','suppressionReason','restoredAt'];
  const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g,'""')}"`;
  const rows = filteredCancellations(s.bookingActions,s.studio?.timeZone ?? 'UTC',query).map(a => {
    const entry = s.classes.find((c: any) => c.id === a.classId), member = s.people.find((p: any) => p.id === a.personId);
    return [a.id,a.bookingId,member?.name ?? a.personId,entry?.title ?? a.classId,entry?.start,a.at,a.actorId,a.actorRole,a.channel,a.type,a.feeCents,a.creditReturned,a.reason,a.waiver?.reason,a.notice?.status,a.notice?.mailStatus,a.notice?.suppressionReason,a.restoredAt];
  });
  // Match the portable exit's cell representation: every data value is JSON
  // before CSV quoting, so names, nulls, cents and booleans remain distinct.
  return [columns.map(quote).join(','),...rows.map(row => row.map(value => quote(JSON.stringify(value ?? null))).join(','))].join('\r\n')+'\r\n';
}

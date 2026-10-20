import { money, when } from './format';
import { body, cell, emptyLine, field, form, h, hidden, owner, panel, person, rows, table } from './shared';

/** The same fee facts appear on the profile and both packs doors. */
export function feesPanel(s: any, personId?: string, back = '/app/packs') {
  const fees = rows(s,'fees').filter(f => !personId || f.personId === personId);
  const pending = fees.filter(f => f.status === 'pending').reduce((n,f) => n+f.amountCents,0);
  const collected = fees.filter(f => f.status === 'collected').reduce((n,f) => n+f.amountCents,0);
  const line = (f: any) => {
    const label = f.reason === 'no_show_fee' ? 'No-show' : 'Late cancel';
    const collect = f.status === 'pending' ? form('fee.collect',back,hidden('id',f.id)+field('reference','External receipt reference','','text','required maxlength="160"'),'Record fee receipt','quiet','small') : '';
    const controls = owner(s) && f.status !== 'waived' ? `<details class="more"><summary>Record receipt or waive</summary>${collect}${f.status === 'collected' ? '<p class="meta">Waiving this collected fee leaves the received money as member credit; no refund is sent.</p>' : ''}${form('fee.waive',back,hidden('id',f.id)+field('reason','Fee waiver reason','','text','required maxlength="500"'),'Waive fee','quiet','small')}</details>` : '';
    return `<tr>${owner(s) && !personId ? cell('Member',h(person(s,f.personId))) : ''}${cell('Fee',`${h(label)}<small>${when(s,f.createdAt)}</small>`)}${cell('Amount',money(f.amountCents))}${cell('Status',`${h(f.status)}${f.receipt ? `<small>External receipt: ${h(f.receipt.reference)}</small>` : ''}${f.reversal ? `<small>${h(f.reversal.note ?? 'Attendance correction')}</small>` : ''}${controls}`)}</tr>`;
  };
  return panel('Attendance fees',body(`<p class="meta">${money(pending)} pending · ${money(collected)} collected. Fees add to the studio balance; card charging is not configured. Collection records money already received outside Strap.</p>`)+(fees.length ? `<div class="table-wrap">${table([...(owner(s)&&!personId ? ['Member'] : []),'Fee','Amount','Status'],fees.map(line).join(''))}</div>` : emptyLine('No attendance fees.')),{icon:'card',id:'attendance-fees'});
}

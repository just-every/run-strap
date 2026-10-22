import { money } from './format';
import { h } from './shared';

/** Show the recorded inputs as well as the result before a statutory submission. */
export function coolingRefundCalculation(value:any){
  if(!value.formula?.kind)return '';
  const rules=value.formula.rules.map((r:any)=>{
    const facts=r.id==='GA'?`${r.bookingIds.length} attended service(s); documented fair-market value ${money(r.valueCents)}, cap ${money(r.capCents)}.`
      :r.id==='FL'?r.days.map((d:any)=>d.sessions?`${money(d.totalPriceCents)} ÷ ${d.sessions} contracted sessions × ${d.renderedSessions} attended sessions.`:`${money(d.totalPriceCents)} ÷ ${d.durationDays} complete term days × ${d.elapsedDays} complete elapsed days.`).join(' ')
      :r.id==='CA'?r.terms.map((t:any)=>`${((t.durationMs-t.unusedMs)/86_400_000).toFixed(3)} available days of ${(t.durationMs/86_400_000).toFixed(3)} paid term days, confirmed freezes excluded.`).join(' '):'';
    return `<li>${h(r.explanation)} ${h(facts)}</li>`;
  }).join('');
  return `<p data-cooling-refund-calculation>${h(value.formula.explanation)} Paid ${money(value.paidCents)}; permitted deduction ${money(value.formula.deductionCents)}; refund due ${value.amountCents===null?'awaiting allocation':money(value.amountCents)}.</p><ul>${rules}</ul>`;
}

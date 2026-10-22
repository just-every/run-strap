import { body, cell, emptyLine, field, form, h, hidden, owner, panel, person, rows, select, table, textarea } from './shared'
import { money, when } from './format'

const path = '/app/teaching-pay'
const modes: [string,string][] = [['flat-class','Per class'],['hourly','Per teaching hour'],['per-attendee','Per attendee'],['tiered','Marginal attendance tiers'],['per-appointment','Per appointment (available when appointments ship)']]

function ruleForm(s: any) {
  return form('pay.rule.save',path,
    select('instructorId','Instructor',[['','All instructors'],...rows(s,'people').filter(p=>p.role==='instructor').map(p=>[p.id,p.name] as [string,string])],'','')
    + field('service','Service (blank for all)','','text','maxlength="160"')
    + field('effectiveAt','Effective from (UTC)','','datetime-local','required step="1"')
    + select('mode','Calculation',modes,'flat-class')
    + field('rate','Rate in USD','0.00','text','inputmode="decimal" required')
    + textarea('tiers','Attendance tiers: inclusive limit, USD per attendee; * for the remainder','10, 5.00\n*, 3.00')
    + field('minimum','Guaranteed minimum in USD','0.00','text','inputmode="decimal" required')
    + select('cancellation','Canceled class pay',[['none','No pay'],['full','Normal calculated pay'],['flat','Fixed canceled-class pay']],'none')
    + field('cancellationAmount','Fixed canceled-class pay in USD','0.00','text','inputmode="decimal"')
    + field('substituteRate','Substitute flat class rate in USD (optional)','','text','inputmode="decimal"')
    + '<p class="meta">Rules are immutable. A new version applies only from its future effective instant. Instructor-specific rules take precedence over studio rules; service-specific rules take precedence within the same instructor scope. Hourly pay uses elapsed teaching time, rounded to cents. Tier rates apply only to attendees in each band.</p>',
    'Publish pay rule')
}

const rateText = (r: any): string => !r ? 'No applicable rule' : r.mode === 'tiered' ? r.tiers.map((t: any)=>`${t.upTo === null ? 'remaining' : 'through attendee '+t.upTo}: ${money(t.rateCents)} each`).join('; ') : `${money(r.rateCents)} ${({'flat-class':'per class',hourly:'per hour','per-attendee':'per attendee','per-appointment':'per appointment'} as Record<string,string>)[r.mode]}`
const durationText = (r: any) => r.calculation ? `${new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(r.calculation.elapsedMinutes)} min` : 'Duration not calculated'
const cancellationText = (r: any) => r.cancellation.treatment === 'flat' ? money(r.cancellation.amountCents)+' for a canceled class' : r.cancellation.treatment === 'full' ? 'Normal pay for a canceled class' : 'No pay for a canceled class'

export function teachingPayPage(s: any) {
  const pay = s.teachingPay, rules = rows(s,'payRules')
  const lines = pay.rows.map((r: any)=>`<tr data-pay-class="${h(r.classId)}">`
    + cell('Class',`${h(r.title)}<small>${when(s, r.start, r.timeZone)} · ${h(person(s,r.instructorId))}</small>`)
    + cell('Calculation',`${h(r.status)}<small>${h(r.attendees)} attended · ${h(durationText(r))}</small><small>${h(rateText(r.substitute ? r.rule?.substitute : r.rule))}${r.substitute ? ' · approved substitute' : ''}${r.rule ? ' · version '+h(r.ruleVersion) : ''}</small>${r.calculation ? `<small>Gross ${money(r.calculation.grossCents)} · minimum uplift ${money(r.calculation.minimumAppliedCents)}${r.classStatus === 'cancelled' ? ' · '+h(cancellationText(r.rule)) : ''}</small>` : ''}${r.adjustments.map((a: any)=>`<small>Adjustment ${money(a.amountCents)}: ${h(a.reason)} · ${when(s,a.createdAt)}</small>`).join('')}`)
    + cell('Teaching pay',r.totalCents == null ? 'Unavailable' : money(r.totalCents))
    + cell('Sources',`<a href="/app?class=${encodeURIComponent(r.classId)}#class-${h(r.classId)}">Roster</a>${owner(s) && r.ruleId ? `<details><summary>Reasoned adjustment</summary>${form('pay.adjust',path,hidden('classId',r.classId)+hidden('instructorId',r.instructorId)+hidden('requestId',crypto.randomUUID())+field('adjustment','Adjustment in USD','','text','required inputmode="decimal"')+field('reason','Reason','','text','required maxlength="500"'),'Record adjustment','quiet')}</details>` : ''}`)+'</tr>').join('')
  const history = rules.map(r=>`<p class="meta"><strong>${h(r.instructorId ? person(s,r.instructorId) : 'All instructors')} · ${h(r.service || 'All services')} · version ${h(r.version)}</strong><br>${h(rateText(r))} · minimum ${money(r.minimumCents)} · ${h(cancellationText(r))}<br>Effective ${when(s,r.effectiveAt)}${r.substitute ? '<br>Substitute: '+h(rateText(r.substitute)) : ''}</p>`).join('')
  return `<div class="page"><div class="page-main"><div class="page-title"><h1>Teaching pay</h1><p>Calculated teaching compensation. This report does not run payroll or transfer funds. See <a href="https://github.com/just-every/run-envelope">Envelope</a> for payroll.</p></div>`
    + panel('Pay summary',body(`<p>${pay.totalCents == null ? 'Some classes have no applicable pay rule. Total unavailable.' : `Total ${money(pay.totalCents)}`}</p>${owner(s) ? '<p><a href="/api/strap/teaching-pay.csv">Download pay CSV</a> · <a href="/api/strap/teaching-pay.xlsx">Download pay XLSX</a></p>' : ''}<p class="meta">Only ended or canceled classes appear. Corrected attendance updates the calculation; immutable adjustments remain attributable.</p>`))
    + panel('Class breakdown',`<div class="table-wrap">${table(['Class','Calculation','Teaching pay','Sources'],lines || '<tr><td colspan="4">No ended or canceled classes.</td></tr>')}</div>`)
    + panel('Rule history',body(history || emptyLine('No pay rules configured.')))
    + '</div>'+(owner(s)?`<aside class="rail">${panel('New pay rule',body(ruleForm(s)))}</aside>`:'')+'</div>'
}

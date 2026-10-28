import { body, field, form, h, hidden, owner, panel } from './shared';
import { money, when } from './format';

const request=()=>hidden('requestId',crypto.randomUUID());
const confirm=(label: string)=>`<label class="check"><input type="checkbox" name="confirm" value="yes" required>${h(label)}</label>`;

export function paymentConnectionPanel(s: any) {
  if(!owner(s))return '';
  const b=s.billing,back='/app/studio#payment-connection';
  if(!b)return panel('Stripe test connection',body('<p>Complete second-factor verification to review billing settings.</p>'),{id:'payment-connection'});
  const review=b.connection?.review;
  return panel('Stripe test connection',body(`<p>${b.connected?'Connected':'Disconnected'}${b.connection?' · merchant '+h(b.connection.accountId):''}. Credentials stay in this installation’s secret configuration.</p>`
    +(review?`<p data-payment-readiness>${review.ready?'Ready for test card payments':'Readiness incomplete'} · charges ${review.chargesEnabled?'enabled':'unavailable'} · payouts ${review.payoutsEnabled?'enabled':'unavailable'} · details ${review.detailsSubmitted?'submitted':'needed'} · card payments ${h(review.cardPayments)}.</p><p>Webhook signing ${review.webhookConfigured?'configured':'not configured'}.</p>`:'')
    +'<p>Review the merchant ID against your own Stripe dashboard. Rotating the configured test credential for the same merchant requires a fresh review here. History remains attached to the merchant. Restored installations remain disconnected until you review them.</p>'
    +(b.configured?form('billing.connect',back,request()+hidden('mode','test')+field('accountId','Stripe test account ID',b.connection?.accountId ?? b.reviews.at(-1)?.accountId ?? '','text','required maxlength="100"')+confirm('I reviewed my merchant identity and authorize this test connection.'),'Review and connect test account'):'<p>The test payment credential is not configured for this installation.</p>')
    +(b.connected?form('billing.disconnect',back,confirm('Disconnect billing now. Retain payment history.'),'Disconnect billing','quiet'):'')
    +(b.reviews.length?`<details><summary>Connection review history</summary>${b.reviews.map((r: any)=>`<p>${h(r.accountId)} · ${r.ready?'ready':'readiness incomplete'} · ${when(s,r.approvedAt)}</p>`).join('')}</details>`:'')
    +'<p><a href="/app/packs#payments">Open plan payments and reconciliation</a></p>'),{id:'payment-connection'});
}

export function planPaymentsPanel(s: any) {
  const b=s.billing;
  if(!b || !owner(s))return '';
  const back='/app/packs#payments';
  const eligible=s.packs.filter((p: any)=>!b.invoices.some((i: any)=>i.packId===p.id) && p.expiresAt>new Date().toISOString());
  const start=b.connected && b.connection?.review?.ready ? eligible.map((p: any)=>form('billing.checkout.start',back,request()+hidden('packId',p.id)+confirm(`Collect ${money(p.amountCents+(p.initiationFeeCents ?? 0))} for ${s.people.find((m: any)=>m.id===p.personId)?.name ?? 'member'}’s approved plan. The payer enters their own test card with Stripe.`),'Start hosted test payment')).join('') : '<p>Review a ready Stripe test connection in Studio settings before collecting a plan payment.</p>';
  const invoices=b.invoices.map((i: any)=>`<section data-stripe-invoice="${h(i.id)}"><h3>${h(s.people.find((p: any)=>p.id===i.personId)?.name ?? 'Retained member')} · ${money(i.amountCents)}</h3><p>Invoice ${h(i.id)} · ${h(i.status)} · merchant ${h(i.accountId)}.</p><p>Stripe invoice ${h(i.providerInvoiceId ?? 'not yet issued')} · payment ${h(i.paymentIntentId ?? 'not yet confirmed')}.</p><p>Studio balance ${money(i.balanceCents)} · plan credits ${h(i.access ?? 'unchanged')}.</p>`
    +(b.connected?form('billing.reconcile',back,hidden('id',i.id)+request(),'Reconcile with Stripe','quiet'):'<p>Historical evidence. Review the connection before reconciling.</p>')+'</section>').join('');
  const exceptions=b.exceptions.map((e: any)=>`<p data-billing-exception="${h(e.id)}">${h(e.code.replaceAll('_',' '))} · ${h(e.status)} · ${h(e.invoiceId ?? e.eventId ?? 'unmatched event')}</p>`).join('');
  const reconciliations=b.reconciliations.map((r: any)=>`<p>${h(r.invoiceId)} · ${h(r.status ?? r.outcome ?? r.code ?? 'compared')} · ${when(s,r.createdAt ?? r.at)}</p>`).join('');
  return panel('Plan payments and reconciliation',body('<p>One-time USD test card payment for an approved plan. The payer personally completes Stripe checkout. This does not enable recurring autopay.</p><p><a href="/app/studio#payment-connection">Review Stripe connection in Studio settings</a></p>'
    +(eligible.length?`<details><summary>Collect an approved plan</summary>${start}</details>`:'')+(invoices||'<p>No hosted plan payments yet.</p>')
    +`<h3>Exception queue</h3>${exceptions||'<p>No exceptions.</p>'}<details><summary>Reconciliation history</summary>${reconciliations||'<p>No comparisons yet.</p>'}</details>`
    +`<details><summary>Signed event history</summary>${b.events.map((e: any)=>`<p>${h(e.providerEventId)} · ${h(e.eventType)} · ${h(e.status)}</p>`).join('')||'<p>No signed events yet.</p>'}</details>`),{id:'payments'});
}

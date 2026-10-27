import { body, field, form, h, hidden, owner, panel, person, select, textarea } from './shared'
import { money, when } from './format'

const back='/app/packs#billing'
const request=()=>hidden('requestId',crypto.randomUUID())
const check=(name: string,label: string)=>`<label class="check"><input type="checkbox" name="${name}" value="yes" required>${h(label)}</label>`

/** Personal agreement and payment consent remain separate from staff preparation. */
export function billingPanel(s: any) {
  if(!['owner','member'].includes(s.actor.role))return ''
  if(!s.billing)return panel('Membership agreements',body('<p><a href="/app/security">Complete second-factor verification</a> to open membership agreements.</p>'),{id:'billing'})
  const b=s.billing,mine=!owner(s)
  const terms=(s.recurring?.terms ?? []).filter((t: any)=>t.status==='active'&&t.acceptedAt&&!b.agreements.some((a: any)=>a.termsId===t.id&&a.status!=='payment-permission-revoked'))
  const prepare=!mine&&terms.length ? `<details><summary>Prepare an additional membership agreement</summary><p>The member must already have accepted their studio invoice terms. Preparing this document does not sign for them or authorize a payment.</p>`
    +form('billing.agreement.prepare',back,request()+select('termsId','Accepted membership',[['','Choose a membership'],...terms.map((t: any)=>[t.id,person(s,t.personId)+' · '+money(t.amountCents)+' every '+t.intervalMonths+' month(s)'])],'','required')
      +field('title','Agreement title','','text','required maxlength="160"')+textarea('documentText','Exact additional agreement text','','required maxlength="20000"')
      +field('adultEvidenceReference','Adult eligibility evidence reference','','text','required maxlength="200"')+check('adultVerified','I verified this member is an adult signing for themselves.'),'Prepare for personal signing')+'</details>' : ''
  const connect=!mine ? `<details><summary>${b.connected?'Review test payment connection':'Connect test payment setup'}</summary><p>Connect your Stripe test account to let members authorize a card through Stripe. This does not collect money.</p>`
    +(b.configured ? form('billing.connect',back,request()+hidden('mode','test')+field('accountId','Stripe test account ID',b.connection?.accountId ?? '','text','required maxlength="100"')+check('confirm','I reviewed this test account and authorize this connection.'),'Connect test account') : '<p>The test payment connection is not configured for this installation.</p>')+'</details>' : ''
  const agreements=b.agreements.map((a: any)=>{
    const mandate=b.mandates.find((m: any)=>m.agreementId===a.id),setups=b.setups.filter((v: any)=>v.agreementId===a.id),methods=b.methods.filter((m: any)=>m.agreementId===a.id)
    const financial=a.financialTerms
    const latest=b.operations.filter((o: any)=>o.agreementId===a.id).sort((a: any,b: any)=>a.createdAt.localeCompare(b.createdAt)).at(-1)
    const outcome=latest?.status==='incomplete' ? '<p class="notice" role="status">Stripe has not confirmed this card setup yet. Finish the hosted form, then check again.</p>' : latest&&['pending','uncertain','failed'].includes(latest.status) ? `<p class="notice" role="status">Payment setup is ${h(latest.status)}. Ask the studio to review the provider outcome before starting another setup.</p>` : ''
    const signature=mine&&!a.signature ? form('billing.agreement.accept',back,hidden('id',a.id)+hidden('documentHash',a.documentHash)+hidden('financialHash',a.financialHash)
      +field('signerName','Your full name','','text','required maxlength="160" autocomplete="name"')+check('adultConfirmed','I confirm I am an adult signing for myself.')
      +check('confirm',a.agreementAffirmation)+check('authorizeRecurring',a.mandateAffirmation),'Sign and authorize') : ''
    const setup=mine&&mandate?.status==='accepted'&&!mandate.methodAuthorized&&b.connected ? (!setups.length ? form('billing.setup.start',back,hidden('id',a.id)+request(),'Authorize a test card with Stripe')
      : setups.filter((v: any)=>v.status!=='completed').map((v: any)=>form('billing.setup.complete',back,hidden('id',a.id)+hidden('setupId',v.id)+request(),'Check Stripe authorization')).join('')) : ''
    const replacement=mine&&mandate?.status==='accepted'&&mandate.methodAuthorized&&b.connected ? setups.some((v: any)=>v.status!=='completed') ? setups.filter((v: any)=>v.status!=='completed').map((v: any)=>form('billing.setup.complete',back,hidden('id',a.id)+hidden('setupId',v.id)+request(),'Check replacement authorization')).join('') : form('billing.setup.start',back,hidden('id',a.id)+hidden('replaceMethodId',mandate.methodId)+request(),'Replace test card with Stripe') : ''
    const revoke=mine&&mandate?.status==='accepted' ? form('billing.mandate.revoke',back,hidden('id',a.id),'Revoke future payment permission','quiet') : ''
    const launch=(command: string,label: string)=>form(command+'.launch',back,hidden('id',a.id)+request()+hidden('channel','desk'),label,'quiet')
    const personalSteps=mine ? '' : (!a.signature ? launch('billing.agreement.accept','Open personal signing') : mandate?.status==='accepted' ?
      (!mandate.methodAuthorized&&b.connected ? !setups.length ? launch('billing.setup.start','Open method authorization') : setups.some((v: any)=>v.status!=='completed') ? launch('billing.setup.complete','Open authorization status') : '' : '')
      +launch('billing.mandate.revoke','Open payment revocation') : '')
    return `<section id="billing-${h(a.id)}" data-billing-agreement="${h(a.id)}"><h3>${h(a.title)}${mine?'':' · '+h(person(s,a.personId))}</h3><p>${h(a.status.replaceAll('-',' '))}</p>`
      +`<p><strong>${money(financial.amountCents)} USD every ${h(financial.intervalMonths)} month(s)</strong> · first due ${when(s,financial.firstDueAt)}</p><p>Original service period: ${when(s,financial.servicePeriod.startAt)} to ${when(s,financial.servicePeriod.endAt)}.</p>`
      +`<details><summary>Read the exact agreement and payment permission</summary><div class="record"><div class="record-body"><p class="letter">${h(a.documentText)}</p></div></div><p>Document version ${h(a.documentVersion)} · SHA-256 <code>${h(a.documentHash)}</code></p></details>`
      +(a.signature?`<p>Personally affirmed by ${h(a.signature.signerName)} ${when(s,a.signature.completedAt)}.</p>`:'')
      +methods.map((m: any)=>`<p>${h(m.brand)} ending ${h(m.last4)} · ${m.available?'authorized in the reviewed test connection':m.status==='superseded'?'replaced historical method':mandate?.status==='revoked'?'historical method; future payment permission revoked':'historical method; connection review required'}</p>`).join('')
      +(mandate?.revokedAt?`<p>Future payment permission revoked ${when(s,mandate.revokedAt)}. The original studio agreement and balance remain unchanged.</p>`:'')
      +outcome+signature+setup+replacement+revoke+(personalSteps?`<details><summary>Member personal steps</summary><p>Open the sign-in link on the member’s own device. Only they can sign, authorize or revoke.</p>${personalSteps}</details>`:'')+`<p><a href="/api/strap/billing/agreement.json?id=${encodeURIComponent(a.id)}">Download exact agreement evidence</a> · <a href="/api/strap/billing/agreement.html?id=${encodeURIComponent(a.id)}">Download readable agreement</a></p></section>`
  }).join('')
  const history=b.operations.length?`<details><summary>Payment setup history</summary>${b.operations.map((o: any)=>`<p>${h(o.type)} · ${h(o.status)}${o.errorCode?' · '+h(o.errorCode.replaceAll('_',' ')):''} · ${when(s,o.createdAt)}</p>`).join('')}</details>`:''
  return panel('Membership agreements',body('<p>Personal typed agreements and separate recurring-payment permission. Stripe test card setup collects no payment; automatic collection is not available.</p>'+connect+prepare+(agreements||'<p>No additional membership agreements yet.</p>')+history),{id:'billing'})
}

import { purchaseConsentText } from '../billing/purchase-consent';
import { planPaymentsPanel } from './payment-connection';
import { body, field, form, h, hidden, owner, panel, person, select, textarea } from './shared'
import { money, when } from './format'

const back='/app/packs#billing'
const request=()=>hidden('requestId',crypto.randomUUID())
const removalMeaning='This ends use of this card in Strap. Masked history, original debt and payment consent remain. This does not delete or detach the card at Stripe.'
const removeForm=(r: any,back: string,staff=false)=>form(staff?'billing.method.remove.staff':'billing.method.remove',back,hidden('id',r.id)+request()+(staff?hidden('channel','desk'):'')+check('confirm',`End Strap use of ${r.brand} ending ${r.last4}, as personally requested.`),staff?'Remove requested card':'End Strap use now','quiet')
const defaultMeaning='This selects an already personally authorized card for this agreement in Strap. It does not charge the card or change the original payment permission.'
const defaultForm=(r: any,back: string,staff=false)=>form(staff?'billing.method.default.staff':'billing.method.default',back,hidden('id',r.id)+request()+(staff?hidden('channel','desk'):'')+check('confirm',`Use ${r.brand} ending ${r.last4} as the default, as personally requested.`),staff?'Select requested default':'Set default card','quiet')
const check=(name: string,label: string)=>`<label class="check"><input type="checkbox" name="${name}" value="yes" required>${h(label)}</label>`

/** Personal agreement and payment consent remain separate from staff preparation. */
export function billingPanel(s: any) {
  if(!['owner','member'].includes(s.actor.role))return ''
  if(!s.billing)return planPaymentsPanel(s)+panel('Membership agreements',body('<p><a href="/app/security">Complete second-factor verification</a> to open membership agreements.</p>'),{id:'billing'})
  const b=s.billing,mine=!owner(s)
  const terms=(s.recurring?.terms ?? []).filter((t: any)=>t.status==='active'&&t.acceptedAt&&!b.agreements.some((a: any)=>a.termsId===t.id&&a.status!=='payment-permission-revoked'))
  const prepare=!mine&&terms.length ? `<details><summary>Prepare an additional membership agreement</summary><p>The member must already have accepted their studio invoice terms. Preparing this document does not sign for them or authorize a payment.</p>`
    +form('billing.agreement.prepare',back,request()+select('termsId','Accepted membership',[['','Choose a membership'],...terms.map((t: any)=>[t.id,person(s,t.personId)+' · '+money(t.amountCents)+' every '+t.intervalMonths+' month(s)'])],'','required')
      +field('title','Agreement title','','text','required maxlength="160"')+textarea('documentText','Exact additional agreement text','','required maxlength="20000"')
      +field('adultEvidenceReference','Adult eligibility evidence reference','','text','required maxlength="200"')+check('adultVerified','I verified this member is an adult signing for themselves.'),'Prepare for personal signing')+'</details>' : ''
  const agreements=b.agreements.map((a: any)=>{
    const mandate=b.mandates.find((m: any)=>m.agreementId===a.id),setups=b.setups.filter((v: any)=>v.agreementId===a.id),methods=b.methods.filter((m: any)=>m.agreementId===a.id)
    const financial=a.financialTerms
    const latest=b.operations.filter((o: any)=>o.agreementId===a.id).sort((a: any,b: any)=>a.createdAt.localeCompare(b.createdAt)).at(-1)
    const outcome=latest?.status==='incomplete' ? '<p class="notice" role="status">Stripe has not confirmed this card setup yet. Finish the hosted form, then check again.</p>' : latest&&['pending','uncertain','failed'].includes(latest.status) ? `<p class="notice" role="status">Payment setup is ${h(latest.status)}. Ask the studio to review the provider outcome before starting another setup.</p>` : ''
    const signature=mine&&!a.signature ? form('billing.agreement.accept',back,hidden('id',a.id)+hidden('documentHash',a.documentHash)+hidden('financialHash',a.financialHash)
      +field('signerName','Your full name','','text','required maxlength="160" autocomplete="name"')+check('adultConfirmed','I confirm I am an adult signing for myself.')
      +check('confirm',a.agreementAffirmation)+check('authorizeRecurring',a.mandateAffirmation),'Sign and authorize') : ''
    const pendingSetups=setups.filter((v: any)=>v.status==='awaiting-member'),currentMethod=methods.find((m: any)=>m.id===mandate?.methodId&&m.available)
    const setup=mine&&mandate?.status==='accepted'&&b.connected ? (pendingSetups.length ? pendingSetups.map((v: any)=>form('billing.setup.complete',back,hidden('id',a.id)+hidden('setupId',v.id)+request(),'Check Stripe authorization')).join('')
      : !mandate.methodAuthorized ? form('billing.setup.start',back,hidden('id',a.id)+request(),'Authorize a test card with Stripe')
      : currentMethod ? `<details><summary>Replace test card</summary><p>Your current card stays authorized until Stripe confirms the replacement. Your membership terms and payment permission stay unchanged.</p>`+form('billing.setup.start',back,hidden('id',a.id)+hidden('replaceMethodId',currentMethod.id)+request()+check('confirmReplacement','I personally request a replacement card under my existing payment permission.'),'Authorize replacement with Stripe')+'</details>' : '') : ''
    const revoke=mine&&mandate?.status==='accepted' ? form('billing.mandate.revoke',back,hidden('id',a.id),'Revoke future payment permission','quiet') : ''
    const launch=(command: string,label: string)=>form(command+'.launch',back,hidden('id',a.id)+request()+hidden('channel','desk'),label,'quiet')
    const personalSteps=mine ? '' : (!a.signature ? launch('billing.agreement.accept','Open personal signing') : mandate?.status==='accepted' ?
      (!mandate.methodAuthorized&&b.connected ? !setups.length ? launch('billing.setup.start','Open method authorization') : setups.some((v: any)=>v.status!=='completed') ? launch('billing.setup.complete','Open authorization status') : '' : '')
      +launch('billing.mandate.revoke','Open payment revocation') : '')
    return `<section id="billing-${h(a.id)}" data-billing-agreement="${h(a.id)}"><h3>${h(a.title)}${mine?'':' · '+h(person(s,a.personId))}</h3><p>${h(a.status.replaceAll('-',' '))}</p>`
      +`<p><strong>${money(financial.amountCents)} USD every ${h(financial.intervalMonths)} month(s)</strong> · first due ${when(s,financial.firstDueAt)}</p><p>Original service period: ${when(s,financial.servicePeriod.startAt)} to ${when(s,financial.servicePeriod.endAt)}.</p>`
      +`<details><summary>Read the exact agreement and payment permission</summary><div class="record"><div class="record-body"><p class="letter">${h(a.documentText)}</p></div></div><p>Document version ${h(a.documentVersion)} · SHA-256 <code>${h(a.documentHash)}</code></p></details>`
      +(a.signature?`<p>Personally affirmed by ${h(a.signature.signerName)} ${when(s,a.signature.completedAt)}.</p>`:'')
      +methods.map((m: any)=>`<div data-stored-method="${h(m.id)}"><p>${h(m.brand)} ending ${h(m.last4)} · ${m.available?'current default in the reviewed test connection':m.status==='removed'?'Strap use ended; masked history retained':m.status==='superseded'?'historical method; replaced':mandate?.status==='revoked'?'historical method; future payment permission revoked':'historical method; connection review required'}</p>`+(mine&&m.status!=='removed'?`<details><summary>Remove card ending ${h(m.last4)}</summary><p>${h(removalMeaning)}</p>`+form('billing.method.removal.request',back,hidden('methodId',m.id)+request()+check('confirm','I personally request removal of this exact card from Strap.'),'Record removal request','quiet')+'</details>':'')+'</div>').join('')
      +methods.map((m: any)=>{
        const consent=(b.purchaseConsents ?? []).find((r: any)=>r.methodId===m.id),revision=consent?.revision??0
        const label=consent?.status==='authorized' ? 'Personal purchase permission: '+consent.contexts.join(' and ')+(consent.available?'. Recording permission makes no purchase or payment.':'. Historical only; execution is disconnected.') : 'Staff purchase permission not granted.'
        const consentFields=hidden('methodId',m.id)+hidden('revision',revision)+request()
        const grant=mine&&m.selectable ? form('billing.purchase-consent.set',back,consentFields+hidden('enabled','yes')+`<label class="check"><input type="checkbox" name="context_in-person" value="yes">In-person purchases I request</label><label class="check"><input type="checkbox" name="context_phone" value="yes">Phone purchases I request</label>`+check('confirm','I personally grant this separate purchase permission for the selected channels.'),'Save purchase permission','quiet') : ''
        const withdraw=mine&&consent?.status==='authorized' ? form('billing.purchase-consent.set',back,consentFields+hidden('enabled','no')+hidden('confirm','yes'),'Withdraw purchase permission','quiet') : ''
        return consent||grant ? `<details data-purchase-method="${h(m.id)}"><summary>Purchase permission for card ending ${h(m.last4)}</summary><p role="status">${h(label)}</p><p>${h(purchaseConsentText)}</p>${grant}${withdraw}</details>` : ''
      }).join('')
      +(mine?methods.filter((m: any)=>m.selectable&&!m.available).map((m: any)=>`<details data-default-method="${h(m.id)}"><summary>Use card ending ${h(m.last4)} as default</summary><p>${h(defaultMeaning)}</p>`+form('billing.method.default.request',back,hidden('methodId',m.id)+request()+check('confirm','I personally request this exact card as my default for this agreement.'),'Record default request','quiet')+'</details>').join(''):'')
      +(b.defaultRequests ?? []).filter((r: any)=>r.agreementId===a.id&&r.status==='requested'&&r.sourceMethodId===(mandate?.methodId??null)&&r.methodEpoch===(mandate?.methodEpoch??0)&&methods.some((m: any)=>m.id===r.methodId&&m.selectable&&m.defaultRequestId===r.id)).map((r: any)=>`<div data-default-request="${h(r.id)}"><p>Member requested ${h(r.brand)} ending ${h(r.last4)} as default ${when(s,r.requestedAt)}. ${h(defaultMeaning)}</p>`+defaultForm(r,back,!mine)+'</div>').join('')
      +(b.removalRequests ?? []).filter((r: any)=>r.agreementId===a.id&&r.status==='requested'&&methods.some((m: any)=>m.id===r.methodId&&m.removalRequestId===r.id&&m.status!=='removed')).map((r: any)=>`<div data-removal-request="${h(r.id)}"><p>Member requested removal of ${h(r.brand)} ending ${h(r.last4)} ${when(s,r.requestedAt)}. ${h(removalMeaning)}</p>`+removeForm(r,back,!mine)+'</div>').join('')
      +(mandate?.revokedAt?`<p>Future payment permission revoked ${when(s,mandate.revokedAt)}. The original studio agreement and balance remain unchanged.</p>`:'')
      +outcome+signature+setup+revoke+(personalSteps?`<details><summary>Member personal steps</summary><p>Open the sign-in link on the member’s own device. Only they can sign, authorize or revoke.</p>${personalSteps}</details>`:'')+`<p><a href="/api/strap/billing/agreement.json?id=${encodeURIComponent(a.id)}">Download exact agreement evidence</a> · <a href="/api/strap/billing/agreement.html?id=${encodeURIComponent(a.id)}">Download readable agreement</a></p></section>`
  }).join('')
  const history=b.operations.length?`<details><summary>Payment setup history</summary>${b.operations.map((o: any)=>`<p>${h(o.type)} · ${h(o.status)}${o.errorCode?' · '+h(o.errorCode.replaceAll('_',' ')):''} · ${when(s,o.createdAt)}</p>`).join('')}</details>`:''
  return planPaymentsPanel(s)+panel('Membership agreements',body('<p>Personal typed agreements and separate recurring-payment permission. Stripe test card setup collects no payment; automatic collection is not available.</p>'+prepare+(agreements||'<p>No additional membership agreements yet.</p>')+history),{id:'billing'})
}

export function billingStaffControls(s: any,personId: string,back: string) {
  const handoffs=(s.billingHandoffs ?? []).filter((a: any)=>a.personId===personId);
  if(!handoffs.length)return '';
  const labels: Record<string,string>={'billing.agreement.accept':'Open personal signing','billing.setup.start':'Open card setup','billing.setup.complete':'Open authorization status','billing.mandate.revoke':'Open payment revocation','billing.method.removal.request':'Open card removal request','billing.method.default.request':'Open default card request','billing.purchase-consent.set':'Open purchase permission'};
  return panel('Member payment handoff',body('<p>The member signs in on their own device. Only they can sign, authorize or replace a card. No payment details or completed agreement are shown here.</p>'+handoffs.map((a: any)=>a.actions.map((command: string)=>form(command+'.launch',back,hidden('id',a.id)+request()+hidden('channel','desk'),labels[command],'quiet')).join('')+(a.defaultRequests ?? []).map((r: any)=>`<div data-default-request="${h(r.id)}"><p>Member requested ${h(r.brand)} ending ${h(r.last4)} as default ${when(s,r.requestedAt)}. ${h(defaultMeaning)}</p>`+defaultForm(r,back,true)+'</div>').join('')+(a.defaultChanges ?? []).map((r: any)=>`<p role="status" data-default-change="${h(r.id)}">Default card selected: ${h(r.brand)} ending ${h(r.last4)} ${when(s,r.at)}. No payment was collected.</p>`).join('')+(a.removalRequests ?? []).map((r: any)=>`<div data-removal-request="${h(r.id)}"><p>Member requested removal of ${h(r.brand)} ending ${h(r.last4)} ${when(s,r.requestedAt)}. ${h(removalMeaning)}</p>`+removeForm(r,back,true)+'</div>').join('')+(a.removals ?? []).map((r: any)=>`<p role="status" data-removed-method="${h(r.methodId)}">Strap use ended for ${h(r.brand)} ending ${h(r.last4)} ${when(s,r.at)}. ${h(removalMeaning)}</p>`).join('')).join('')),{id:'billing-handoff'});
}

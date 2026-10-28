// Browser forms speak the studio's language: dollars, calendar dates and wall
// times in the studio's zone, an instructor picked by name. This turns one
// posted form into the same command input the JSON API takes.
import { fail } from './credentials'
import { addDays, localInstant } from './zone'

const date = /^\d{4}-\d\d-\d\d$/, clock = /^\d\d:\d\d$/

/** "$1,234.50", "180" or "180.5" → whole cents. */
export function cents(value: unknown, label: string) {
  const text = String(value ?? '').trim().replace(/^\$/, '').replace(/,/g, '')
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(text)) fail(`Enter ${label} in dollars, such as 180.00`)
  const [whole, part = ''] = text.split('.')
  return Number(whole) * 100 + Number(part.padEnd(2, '0'))
}

function zoneOf(timeZone: string | undefined) {
  if (!timeZone) fail('Set your studio’s time zone in Studio settings first')
  return timeZone!
}

/** One class row of the week editor: day of the week, start time, length, title, room, spots and instructor. */
function classRow(input: Record<string, unknown>, i: number, week: string, zoneAt: (locationId: unknown) => string) {
  const get = (key: string) => String(input[`c${i}_${key}`] ?? '').trim()
  if (!get('title')) return null
  const day = Number(get('day')), minutes = Number(get('minutes'))
  if (!Number.isInteger(day) || day < 0 || day > 6) fail(`Choose a day for class ${i + 1}`)
  if (!clock.test(get('time'))) fail(`Choose a start time for class ${i + 1}`)
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 600) fail(`Enter a length in minutes for class ${i + 1}`)
  const locationId = get('locationId'), start = localInstant(addDays(week, day), get('time'), zoneAt(locationId))
  return {
    ...(locationId ? { locationId } : {}), title: get('title'), service: get('service') || get('title'), room: get('room'), equipment: get('equipment').split(/\r?\n/).map(value => value.trim()).filter(Boolean),
    bufferBeforeMinutes: Number(get('bufferBeforeMinutes')), bufferAfterMinutes: Number(get('bufferAfterMinutes')),
    start, end: new Date(Date.parse(start) + minutes * 60_000).toISOString(),
    capacity: Number(get('capacity')), ...(get('onlineCapacity') ? { onlineCapacity: Number(get('onlineCapacity')) } : {}), instructorId: get('instructorId'),
  }
}

export function formInput(name: string, raw: Record<string, unknown>, timeZone: string | undefined, locations: { id: string; timeZone: string }[] = []): Record<string, unknown> {
  const input = { ...raw }
  if(name.startsWith('billing.')) {
    if(['billing.line.refund','billing.receipt.allocate'].includes(name) && 'amount' in input){input.amountCents=cents(input.amount,'the amount');delete input.amount;}
    if('requested' in input)input.requested=input.requested==='true' || input.requested==='yes';
    for(const key of ['confirm','adultVerified','adultConfirmed','authorizeRecurring','confirmReplacement'])if(key in input)input[key]=input[key]==='yes' || input[key]==='true'
    return input
  }
  if(name === 'tax.config.save') {
    const products=JSON.parse(String(input.products ?? '[]')),exemptions=JSON.parse(String(input.exemptions ?? '[]'))
    const address=input.originAddress ? JSON.parse(String(input.originAddress)) : {line1:input.originLine1,line2:input.originLine2,city:input.originCity,state:input.originState,postalCode:input.originPostalCode,country:'US'}
    if(input.productSource){const [kind,sourceId]=String(input.productSource).split(':');const id=kind+':'+sourceId;const next={id,kind,sourceId,label:input.productLabel,taxCode:input.taxCode};const i=products.findIndex((p: any)=>p.id===id);if(i<0)products.push(next);else products[i]=next}
    if(input.exemptionPersonId){const id='exemption:'+input.exemptionPersonId;const next={id,personId:input.exemptionPersonId,reference:input.exemptionReference,reason:input.exemptionReason};const i=exemptions.findIndex((e: any)=>e.id===id);if(i<0)exemptions.push(next);else exemptions[i]=next}
    return {requestId:input.requestId,consent:input.consent==='yes',originAddress:address,registeredStates:String(input.registeredStates).split(',').map(v=>v.trim().toUpperCase()).filter(Boolean),products,exemptions}
  }
  if(name === 'tax.calculate') {
    const [chargeId,productId]=JSON.parse(String(input.taxSale))
    return {requestId:input.requestId,chargeId,productId,address:{line1:input.customerLine1,line2:input.customerLine2,city:input.customerCity,state:input.customerState,postalCode:input.customerPostalCode,country:'US'},...(input.exemptionId ? {exemptionId:input.exemptionId} : {})}
  }
  if(name === 'tax.confirm')return {...input,expectedTaxCents:Number(input.expectedTaxCents)}
  if(name === 'tax.refund') {
    const [invoiceId,retailReturnId]=JSON.parse(String(input.taxReturn))
    return {requestId:input.requestId,invoiceId,retailReturnId,expectedTaxCents:cents(input.expectedTaxCents,'the expected tax credit'),reference:input.reference,reason:input.reason}
  }

  if(name === 'waiver.signing.grant')return {personId:input.personId,enabled:input.enabled==='true',memberIds:Object.keys(input).filter(k=>k.startsWith('member_')&&input[k]==='true').map(k=>k.slice(7)),locationIds:Object.keys(input).filter(k=>k.startsWith('location_')&&input[k]==='true').map(k=>k.slice(9))};
  if(name === 'waiver.publish') return {...input,validDays:input.validDays ? Number(input.validDays) : undefined,requiresSignature:input.requiresSignature === 'yes'};
  if(name === 'waiver.copy.mail.review') return {...input,confirm:input.confirm==='yes'};
  if(name === 'waiver.acknowledge') return {...input,...(input.confirm !== undefined ? {confirm:input.confirm === 'yes'} : {})};
  if(name === 'attendance.availability.save') {
    const convert = (value: unknown) => {const [date,time]=String(value).split('T');return localInstant(date,time,zoneOf(timeZone));};
    return {version:Number(input.version),windows:[{start:convert(input.availabilityStart),end:convert(input.availabilityEnd)}],locationIds:[input.locationId]};
  }
  if (name === 'appointment.booking.grant' || name === 'attendance.booking.grant') {
    input.enabled = input.enabled === 'true'
    input.memberIds = Object.keys(input).filter(k=>k.startsWith('member_') && input[k] === 'true').map(k=>k.slice(7))
    input.locationIds = Object.keys(input).filter(k=>k.startsWith('loc_') && input[k] === 'true').map(k=>k.slice(4))
    for (const key of Object.keys(input)) if (key.startsWith('member_') || key.startsWith('loc_')) delete input[key]
  }
  if (name === 'appointment.reservation.prepare' && !input.offerId) {
    if (input.proposal) { const source = JSON.parse(String(input.proposal)); delete input.proposal; Object.assign(input,{...source,...input}) }
    if (input.fundingKind) {input.funding=input.fundingKind === 'pay-per-visit' ? {kind:'pay-per-visit',priceId:input.appointmentPriceId} : {kind:'entitlement'};delete input.fundingKind;delete input.appointmentPriceId;}
    input.minutes = Number(input.minutes)
    const choices = new Map((Array.isArray(input.choices) ? input.choices : []).map((c: any)=>[c.date,c]))
    for (const key of Object.keys(input)) if (key.startsWith('alt_')) {if(input[key]) choices.set(key.slice(4),input[key] === 'skip' ? {date:key.slice(4),skip:true,reason:input['skipReason_'+key.slice(4)]} : {date:key.slice(4),start:input[key]});delete input[key]}
    for (const key of Object.keys(input)) if (key.startsWith('skipReason_')) delete input[key]
    input.choices = [...choices.values()]
  }
  if (name === 'appointment.move.prepare') return input
  if(name==='plan.recurring.prepare'&&input.noticeLeadDays!==undefined)input.noticeLeadDays=Number(input.noticeLeadDays)
  if(name === 'clock.approver.grant') input.enabled = input.enabled === 'true';
  if(name.startsWith('clock.')) {for(const key of ['revision','breakMinutes'])if(key in input)input[key]=Number(input[key]);for(const key of ['startAt','endAt'])if(input[key])input[key]=String(input[key])+'Z';}
  if(name.startsWith('retail.') || name.startsWith('drawer.')) {
    for(const key of ['quantity','count','lowStock','maxUses','perMember']) if(key in input) input[key]=Number(input[key]);
    for(const [key,target] of [['price','priceCents'],['expected','expectedCents'],['float','floatCents'],['counted','countedCents']]) if(key in input) {input[target]=cents(input[key],key);delete input[key];}
    if(name==='retail.gift.adjust') {const amount=String(input.adjustment ?? '').trim(),negative=amount.startsWith('-');input.amountCents=cents(negative?amount.slice(1):amount,'gift adjustment')*(negative?-1:1);delete input.adjustment;}
    if(name==='retail.promotion.add') {input.stackable=input.stackable==='true';input.startsAt=String(input.startsAt)+'Z';input.endsAt=String(input.endsAt)+'Z';if(input.skuId==='')delete input.skuId;}
    if(name==='retail.sell') {input.promoCodes=String(input.promoCodes ?? '').split(',').map(c=>c.trim()).filter(Boolean);if(input.giftCardId==='')delete input.giftCardId;}
    if(name==='retail.return') input.restock=input.restock==='true';
    if(name==='drawer.close') {input.denominations=Object.keys(input).filter(k=>k.startsWith('denom_')).map(k=>({cents:Number(k.slice(6)),count:Number(input[k])}));for(const k of Object.keys(input))if(k.startsWith('denom_'))delete input[k];}
    if(input.sessionId==='') delete input.sessionId;
  }
  if(name === 'intake.form.publish') {
    input.required=input.required === 'true';
    input.questions=Array.from({length:20},(_,i) => ({label:String(input['question'+i] ?? '').trim(),required:input['required'+i] === 'true',sensitive:input['sensitive'+i] === 'true'})).filter(q => q.label);
    for(let i=0;i<20;i++)for(const prefix of ['question','required','sensitive'])delete input[prefix+i];
  }
  if(name.startsWith('intake.submit')) {
    input.answers=Object.fromEntries(Object.keys(input).filter(k => k.startsWith('answer_')).map(k => [k.slice(7),input[k]]));
    for(const key of Object.keys(input))if(key.startsWith('answer_'))delete input[key];
  }
  if(name === 'intake.sensitive.grant') {
    input.enabled=input.enabled === 'true';input.memberIds=Object.keys(input).filter(k => k.startsWith('member_') && input[k] === 'true').map(k => k.slice(7));
    for(const key of Object.keys(input))if(key.startsWith('member_'))delete input[key];
  }
  if(name === 'family.tuition.save') {
    const percent = String(input.discountPercent ?? '');
    if(!/^\d{1,3}(?:\.\d{1,2})?$/.test(percent)) fail('Enter a sibling discount from 0 to 100 percent');
    input.discountBps = Math.round(Number(percent)*100); delete input.discountPercent;
    input.rows = Object.keys(input).filter(key => key.startsWith('participant_') && input[key] === 'true').map(key => {const personId = key.slice(12);return {personId,amountCents:cents(input['rate_'+personId],'monthly tuition'),credits:Number(input['visits_'+personId])}});
    for(const key of Object.keys(input))if(/^(participant_|rate_|visits_)/.test(key)) delete input[key];
  }
  if(name === 'family.bill.accept') input.confirm = input.confirm === 'true';
  if(name === 'renewal.sequence.prepare') input.maxMessages=Number(input.maxMessages);
  if(name === 'renewal.sequence.set') input.enabled=input.enabled === 'true';
  if (name.startsWith('preferences.save')) {
    input.revision=Number(input.revision ?? 0);
    for(const key of ['marketingEmail','marketingSms','marketingInApp','contactEmail','contactSms','contactInApp','attendanceSharing','feedback','bookingEmail'])if(input[key] !== undefined)input[key]=input[key] === 'true';
  }
  if (name === 'staff.access.grant') {
    const selected = (prefix: string) => Object.keys(input).filter(key => key.startsWith(prefix) && input[key] === 'true').map(key => key.slice(prefix.length));
    const scope = {memberIds:selected('member_'),locationIds:selected('location_'),doors:['all']};
    return {personId:input.personId,role:input.role,enabled:input.enabled === 'true',rights:Object.fromEntries(selected('right_').map(right => [right,{enabled:true,scopes:[scope],...(right === 'member-record' ? {canCreate:input.canCreate === 'true'} : {})}]))};
  }
  if (name === 'member.record.grant') { input.enabled = input.enabled === 'true'; input.canCreate = input.canCreate === 'true'; input.memberIds = Object.keys(input).filter(k => k.startsWith('member_') && input[k] === 'true').map(k => k.slice(7));for(const key of Object.keys(input)) if(key.startsWith('member_')) delete input[key]; }
  if (name === 'member.note.add') input.alert = input.alert === 'true';
  // A class, room or closure at a location is entered on that location's clock; anything else on the studio's.
  const zoneAt = (locationId: unknown) => locationId ? locations.find(l => l.id === locationId)?.timeZone ?? fail('Choose one of the studio’s locations') : zoneOf(timeZone)
  if (name === 'intro.offer.save') for (const key of ['days','returnAfterDays']) if (input[key] !== undefined) input[key] = Number(input[key]);
  if (name === 'intro.identity.verify') { input.householdChecked = input.householdChecked === 'true'; for (const key of ['samePersonAsId','householdWithId']) if (input[key] === '') delete input[key]; }
  if (name === 'intro.preview' && input.exceptionReason === '') delete input.exceptionReason;
  if (name === 'intro.purchase') input.confirm = input.confirm === 'true';
  if (name === 'pack.prepare' || name === 'pack.locations.set') {
    const picked = Object.keys(input).filter(key => key.startsWith('lc_') && input[key] === 'true').map(key => key.slice(3))
    for (const key of Object.keys(input)) if (key.startsWith('lc_')) delete input[key]
    if (input.allLocations === 'true') input.eligibleLocations = 'all'
    else if (picked.length) input.eligibleLocations = picked
    else if (name === 'pack.locations.set') fail('Choose where the plan is valid')
    delete input.allLocations
  }
  if (name === 'pack.prepare' || name === 'payment.record') { if (input.locationId === '') delete input.locationId }
  if (name === 'household.contact.save') {
    input.permissions = Object.keys(input).filter(key => key.startsWith('perm_') && input[key] === 'true').map(key => key.slice(5))
    for (const key of Object.keys(input)) if (key.startsWith('perm_')) delete input[key]
  }
  if (name === 'household.participant.add' && input.personId === '') delete input.personId
  if (name === 'manager.grant') {
    input.locationIds = Object.keys(input).filter(key => key.startsWith('loc_')).map(key => key.slice(4))
    for (const key of Object.keys(input)) if (key.startsWith('loc_')) delete input[key]
  }
  if ((name === 'studio.save' || name === 'location.save') && input.profile === 'true') {
    const keys = ['line1','line2','city','region','postalCode']
    input.address = keys.some(key => String(input[key] ?? '').trim())
      ? Object.fromEntries([...keys.map(key => [key,String(input[key] ?? '').trim()]),['country','US']]) : null
    input.businessHours = Array.from({length:7},(_,i) => i+1).flatMap(day => {
      const opens = String(input[`opens_${day}`] ?? ''), closes = String(input[`closes_${day}`] ?? '')
      return opens || closes ? [{day,opens,closes}] : []
    })
    for (const key of [...keys,'profile',...Array.from({length:7},(_,i) => [`opens_${i+1}`,`closes_${i+1}`]).flat()]) delete input[key]
  }
  if(name.startsWith('plan.cancellation.')||name==='contract.copy.delivery.record'){for(const prefix of ['effective','documented','settled','delivered']){if(input[prefix+'Date']){if(!date.test(String(input[prefix+'Date']))||!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(String(input[prefix+'Time'])))fail('Choose a cancellation date and time');input[prefix+'At']=new Date(Date.parse(localInstant(String(input[prefix+'Date']),String(input[prefix+'Time']).slice(0,5),zoneOf(timeZone)))+Number(String(input[prefix+'Time']).split(':')[2]??0)*1000).toISOString();}delete input[prefix+'Date'];delete input[prefix+'Time'];}for(const key of ['coolingOffDays','relocationMiles'])if(input[key]!==undefined&&input[key]!=='')input[key]=Number(input[key]);else delete input[key];for(const key of ['cancellationRequestId','exceptionReason'])if(input[key]==='')delete input[key];}
  if(name==='plan.cancellation.policy.save'&&input.deductionsForm==='yes'){input.coolingDeductions=Object.fromEntries(['GA','FL','CA'].map(region=>[region,input['deduction_'+region]==='yes']));delete input.deductionsForm;for(const region of ['GA','FL','CA'])delete input['deduction_'+region];}
  if(name==='pack.prepare'&&input.discount!==undefined){input.discountCents=cents(input.discount||'0','the pack discount');delete input.discount;}
  if(name==='pack.prepare'&&input.initiationFee!==undefined){input.initiationFeeCents=cents(input.initiationFee||'0','the one-time initiation fee');delete input.initiationFee;}
  if(name==='contract.authority.save')for(const key of ['birthOn','adultOn','emancipatedOn','emancipationEvidenceReference'])if(input[key]==='')delete input[key];
  if(name==='contract.service-value.record'||name==='contract.prepayment.record'||name==='plan.cancellation.refund.settle'){input.amountCents=cents(input.amount,'the recorded amount');delete input.amount;}
  if (name === 'freeze.type.save') {
    input.feeCents=cents(input.freezeFee ?? '0','freeze fee');delete input.freezeFee;
    for (const key of ['defaultLengthDays','maxLengthDays']) input[key]=Number(input[key]);
    input.allowedStartDays=String(input.allowedStartDaysText ?? '').split(',').map(v=>Number(v.trim()));delete input.allowedStartDaysText;
    input.allowOpenEnded=input.allowOpenEnded==='yes';for(const key of ['maxFreezes','maxDays']){if(input[key]!==undefined&&input[key]!=='')input[key]=Number(input[key]);else delete input[key];}
  }
  if (name==='plan.disclosure.schedule') {input.leadDays=Number(input.leadDays);if(String(input.proposedAmount ?? '').trim()) input.proposedAmountCents=cents(input.proposedAmount,'proposed price');delete input.proposedAmount;}
  if (name==='plan.recurring.prepare') input.intervalMonths=Number(input.intervalMonths);
  if (['freeze.request','freeze.prepare','freeze.end.prepare'].includes(name)) {
    for(const prefix of ['start','end']) { const day=String(input[prefix+'Date']??'');if(day){if(!date.test(day))fail('Choose a freeze date');input[prefix+'At']=day;}delete input[prefix+'Date'];delete input[prefix+'Time'];}
    if(input.openEnded==='yes')input.endAt=null;delete input.openEnded;
    if ('freezeFee' in input) { input.feeCents=cents(input.freezeFee,'freeze fee');delete input.freezeFee; }
    for (const key of ['exceptionReason','freezeRequestId']) if(input[key]==='') delete input[key];
  }
  if (name === 'absence.policy.save') { input.noticeHours=Number(input.noticeHours); input.expiryDays=Number(input.expiryDays); for (const key of ['maxCredits','capDays']) { if (input[key] !== undefined && input[key] !== '') input[key]=Number(input[key]); else delete input[key]; } }
  if (name === 'renewal.followup.create') {
    input.days = Number(input.days); input.lowCredits = Number(input.lowCredits)
    if (input.dueAt) input.dueAt = String(input.dueAt)+'Z'
  }
  if (name === 'reminder.rule.save') { input.enabled = input.enabled === 'true'; input.leadMinutes = Number(input.leadMinutes) }
  if (name === 'mail.preference.save') input.optedOut = input.optedOut === 'true'
  if (name === 'profile.save' || name === 'profile.save.staff' || (name === 'person.save' && 'version' in input)) for (const key of ['revision', 'version']) if (key in input) input[key] = Number(input[key])
  if (name==='substitution.qualification.save') input.qualified=input.qualified==='true'
  if (name==='plan.change.prepare') {
    for (const key of ['planRequestId','exceptionReason']) if (input[key]==='') delete input[key]
    if (input.mode==='now') {
      if (!date.test(String(input.effectiveDate)) || !clock.test(String(input.effectiveTime))) fail('Choose the effective date and time')
      input.effectiveAt=localInstant(String(input.effectiveDate),String(input.effectiveTime),zoneOf(timeZone)); delete input.expiresOn
    }
    delete input.effectiveDate; delete input.effectiveTime
  }
  if (name === 'lead.winback.prepare') {for(const key of ['days','cadenceDays','offerDays'])input[key]=Number(input[key]);for(const key of ['amount','reward','budget']){input[key==='amount'?'amountCents':key+'Cents']=cents(input[key],key);delete input[key];}input.eligibleServices=String(input.services ?? '').split(',').map(s=>s.trim()).filter(Boolean);delete input.services;input.personIds=Object.keys(input).filter(key=>key.startsWith('wb_')&&input[key]==='true').map(key=>key.slice(3));for(const key of Object.keys(input))if(key.startsWith('wb_'))delete input[key];}
  if (name === 'lead.winback.purchase')input.confirm=input.confirm === 'true';
  if (name === 'lead.nurture.save') {input.days=Number(input.days);input.amountCents=cents(input.amount,'membership price');delete input.amount;}
  if (name === 'lead.nurture.purchase')input.confirm=input.confirm === 'true';
  if (name === 'lead.empty.prepare') { for(const key of ['leadMinutes','maxPer30Days'])input[key]=Number(input[key]);for(const key of ['incentive','budget']){input[key+'Cents']=cents(input[key],key);delete input[key];} input.personIds=Object.keys(input).filter(key=>key.startsWith('aud_') && input[key] === 'true').map(key=>key.slice(4));for(const key of Object.keys(input))if(key.startsWith('aud_'))delete input[key]; }
  if (name === 'lead.recovery.rule.save') { for(const key of ['minVisits','missedWeeks','lookbackWeeks'])input[key]=Number(input[key]);input.enabled=input.enabled === 'true'; }
  if (name.startsWith('lead.')) {
    if ('version' in input) input.version=Number(input.version)
    if (input.dueAt) input.dueAt=String(input.dueAt)+'Z'
    for (const key of ['bookingId','externalMembershipReference','lostReason','note']) if (input[key]==='') delete input[key]
    if (name==='lead.update') {
      if (!['intro-booked','first-visit'].includes(String(input.stage))) delete input.bookingId
      if (input.stage!=='membership') delete input.externalMembershipReference
      if (input.stage!=='lost') delete input.lostReason
    }
  }
  if (name.startsWith('recognition.')) {
    for (const key of ['threshold','version']) if (key in input) input[key]=Number(input[key])
    for (const key of ['enabled','optedIn']) if (key in input) input[key]=input[key]==='true'
  }
  if (name === 'pay.rule.save') {
    const mode = String(input.mode), cancellation = {treatment:String(input.cancellation),...(input.cancellation === 'flat' ? {amountCents:cents(input.cancellationAmount,'canceled-class pay')} : {})}
    const rate = mode === 'tiered' ? {tiers:String(input.tiers ?? '').split(/\r?\n/).filter(line=>line.trim()).map(line=>{const [limit,amount,...extra]=line.split(',');if(extra.length || !amount) fail('Enter one inclusive limit and USD amount per tier'); return {upTo:limit.trim()==='*'?null:Number(limit.trim()),rateCents:cents(amount,'the tier rate')}})} : {rateCents:cents(input.rate,'the teaching rate')}
    return {instructorId:input.instructorId,service:input.service,effectiveAt:String(input.effectiveAt)+'Z',mode,...rate,minimumCents:cents(input.minimum,'the guaranteed minimum'),cancellation,...(String(input.substituteRate ?? '').trim() ? {substitute:{mode:'flat-class',rateCents:cents(input.substituteRate,'the substitute rate'),minimumCents:0}} : {})}
  }
  if (name === 'pay.adjust') {
    const amount=String(input.adjustment ?? '').trim(), negative=amount.startsWith('-')
    return {...input,amountCents:cents(negative?amount.slice(1):amount,'the teaching-pay adjustment')*(negative?-1:1)}
  }
  if (name === 'integration.create' || name === 'integration.events') {
    input.events = Object.keys(input).filter(key => key.startsWith('ev_') && input[key] === 'true').map(key => key.slice(3))
    if (name === 'integration.create' && Object.keys(input).some(key => key.startsWith('lc_'))) input.locations = Object.keys(input).filter(key => key.startsWith('lc_') && input[key] === 'true').map(key => key.slice(3))
    if (name === 'integration.create') input.scopes = Object.keys(input).filter(key => key.startsWith('sc_') && input[key] === 'true').map(key => key.slice(3))
  }
  if (name === 'booking.bulk.cancel') input.ids = Object.keys(input).filter(key => key.startsWith('b_') && input[key] === 'true').map(key => key.slice(2))
  if (name === 'booking.waitlist.position') input.position = Number(input.position)
  if (name === 'cancellationReasons.save') input.reasons = String(input.reasons ?? '').split(/\r?\n/).map(value => value.trim()).filter(Boolean)
  if ('suppressNotice' in input) input.suppressNotice = input.suppressNotice === 'true'
  if ('credits' in input) input.credits = Number(input.credits)
  if ('creditsDelta' in input) input.creditsDelta = Number(input.creditsDelta)
  if ('revision' in input) input.revision = Number(input.revision)
  if (typeof input.eligibleServices === 'string') input.eligibleServices = input.eligibleServices.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
  if ('active' in input) input.active = ['on', 'true', '1'].includes(String(input.active))
  if (name === 'booking.desk' && String(input.amount ?? '').trim() === '') delete input.amount
  if (name === 'booking.desk' && !['sell-pack'].includes(String(input.pay))) { delete input.expiresOn; delete input.credits }
  if (name === 'booking.desk' && String(input.pay) !== 'pack') delete input.packId
  if (name === 'appointment.price.save') { input.amountCents=cents(input.amount,'the appointment price');delete input.amount; }
  if ('amount' in input) { input.amountCents = cents(input.amount, name === 'payment.record' ? 'the amount received' : 'the pack price'); delete input.amount }
  if ('expiresOn' in input) {
    if (!date.test(String(input.expiresOn))) fail('Choose the last day the pack can be used')
    // Inclusive local Good through date; the next midnight is the exclusive boundary.
    input.expiresAt = localInstant(addDays(String(input.expiresOn), 1), '00:00', zoneOf(timeZone))
    delete input.expiresOn
  }
  if (name === 'pack.adjust') {
    if (input.expiresDate || input.expiresTime) {
      const time = String(input.expiresTime)
      if (!date.test(String(input.expiresDate)) || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) fail('Choose both an expiration date and time')
      const seconds = Number(time.split(':')[2] ?? 0)
      if (seconds > 59) fail('Choose a valid expiration time')
      input.expiresAt = new Date(Date.parse(localInstant(String(input.expiresDate), time.slice(0, 5), zoneOf(timeZone))) + seconds * 1000).toISOString()
    }
    delete input.expiresDate; delete input.expiresTime
  }
  if (name === 'spots.save') {
    const lines = (key: string) => String(input[key] ?? '').split(/\r?\n/).map(value => value.trim()).filter(Boolean)
    return { room: String(input.room ?? '').trim(), spots: lines('spots'), disabled: lines('disabled') }
  }
  if (name === 'waitlist.save') input.claimMinutes = Number(input.claimMinutes)
  if (name === 'booking.desk') input.waitlist = input.waitlist === 'true'
  if (name === 'guest.consent.save') { input.consent = input.consent === 'true'; if (input.maxCharge) input.maxChargeCents = cents(input.maxCharge,'maximum guest charge'); delete input.maxCharge; }
  if (name === 'guest.book') input.confirm = input.confirm === 'true';
  if (name === 'pack.prepare') {
    for (const [key,target] of [['cycleStartOn','cycleStartAt'],['joinOn','joinAt']]) { if(input[key]) input[target]=localInstant(String(input[key]),'00:00',zoneOf(timeZone)); delete input[key]; }
    if (String(input.guestPasses ?? '').trim()) input.guestTerms = {passes:Number(input.guestPasses),period:input.guestPeriod,rollover:Number(input.guestRollover),services:String(input.guestServices ?? '').split(/\r?\n/).map(v=>v.trim()).filter(Boolean),perGuest:Number(input.guestLimit),windowDays:Number(input.guestWindow),excess:input.guestExcess,priceCents:cents(input.guestPrice || '0','guest drop-in price')};
    for (const key of ['guestPasses','guestPeriod','guestRollover','guestServices','guestLimit','guestWindow','guestExcess','guestPrice']) delete input[key];
    input.priorityBooking = ['on', 'true', '1'].includes(String(input.priorityBooking))
    // PLAN-002 plan terms: a visits or unlimited plan has no credit count.
    const kind = String(input.kind ?? 'credits'), days = [1, 2, 3, 4, 5, 6, 7].filter(day => input[`day_${day}`] === 'true')
    for (let day = 1; day <= 7; day++) delete input[`day_${day}`]
    if (kind !== 'credits') delete input.credits
    if (kind !== 'visits') { delete input.visits; delete input.period; delete input.rollover }
    for (const key of ['visits', 'rollover', 'maxUpcoming']) if (key in input) input[key] = String(input[key]).trim() === '' ? undefined : Number(input[key])
    for (const key of ['planName', 'from', 'to', 'period']) if (input[key] === '') delete input[key]
    if (days.length) input.days = days
  }
  if (name === 'bookingRule.save') {
    const whole = (key: string) => { const value = String(input[key] ?? '').trim(); return value === '' ? null : Number(value) }
    return { service: String(input.service ?? '').trim(), plan: String(input.plan ?? '').trim(), opensHoursBefore: whole('opensHoursBefore'), priorityOpensHoursBefore: whole('priorityOpensHoursBefore'),
      noShowGraceMinutes: whole('noShowGraceMinutes') ?? 0, closesMinutesBefore: whole('closesMinutesBefore') ?? 0, cancelCutoffHours: whole('cancelCutoffHours') ?? 0,
      lateCancelReturnsCredit: input.lateCancelReturnsCredit === 'true', lateCancelFeeCents: cents(input.lateFee ?? '0', 'the late-cancel fee'), noShowFeeCents: cents(input.noShowFee ?? '0', 'the no-show fee') }
  }
  if (name === 'series.prepare' || name === 'series.change.prepare') {
    const values: Record<string, unknown> = { ...input }
    for (const key of ['minutes', 'capacity', 'onlineCapacity', 'intervalWeeks', 'bufferBeforeMinutes', 'bufferAfterMinutes']) if (key in values) values[key] = Number(values[key])
    values.equipment = String(values.equipment ?? '').split(/\r?\n/).map(value => value.trim()).filter(Boolean)
    if (name === 'series.prepare') return values
    const { classId, scope, reason, ...change } = values
    return { classId, scope, reason, change }
  }
  if (name === 'classes.prepare') {
    const week = String(input.week ?? '')
    if (!date.test(week)) fail('Choose the Monday that starts the week')
    const rows = Number(input.rows)
    const classes = Array.from({ length: Number.isInteger(rows) && rows > 0 && rows <= 100 ? rows : 0 }, (_, i) => classRow(input, i, week, zoneAt)).filter(Boolean)
    if (!classes.length) fail('Add at least one class to the week')
    return { week, classes }
  }
  if (name === 'closure.prepare' && input.scope !== 'class') {
    const zone = zoneAt(input.locationId)
    if (!date.test(String(input.startDate)) || !clock.test(String(input.startTime)) || !date.test(String(input.endDate)) || !clock.test(String(input.endTime))) fail('Choose when the closure starts and ends')
    return { scope: input.scope, ...(input.locationId ? { locationId: input.locationId } : {}), room: input.room, reason: input.reason, start: localInstant(String(input.startDate), String(input.startTime), zone), end: localInstant(String(input.endDate), String(input.endTime), zone) }
  }
  if (name === 'scheduling.unavailable.save') {
    const zone = zoneAt(input.resourceKind === 'instructor' ? undefined : input.locationId || undefined)
    return { ...input, ...(input.locationId ? {} : { locationId: undefined }), resourceId: input.resourceKind === 'instructor' ? input.instructorId : input.resourceId,
      start: localInstant(String(input.startDate), String(input.startTime), zone),
      end: localInstant(String(input.endDate), String(input.endTime), zone) }
  }
  if (name.startsWith('course.')) {
    for (const key of ['confirm','confirmPolicy']) if (key in input) input[key] = input[key] === 'true'
    if ('capacity' in input) input.capacity = Number(input.capacity)
    if (name === 'course.publish') {
      input.depositCents = cents(input.deposit,'the deposit'); delete input.deposit
      input.sessions = String(input.sessions ?? '').split(/\r?\n/).filter(v=>v.trim()).map(v=>{const [start,end]=v.split('|').map(x=>x.trim());return {start,end}})
      input.installments = String(input.installments ?? '').split(/\r?\n/).filter(v=>v.trim()).map(v=>{const [dueAt,amount]=v.split('|').map(x=>x.trim());return {dueAt,amountCents:cents(amount,'the installment')}})
    }
  }
  return input
}

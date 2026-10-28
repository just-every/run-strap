import { leadCampaignPanel } from './lead-campaigns'
import { body, cell, field, form, h, hidden, panel, person, select as baseSelect, table, textarea } from './shared'
import { when } from './format'
import { leadReportPanel } from './lead-report'
const select=(name:string,label:string,choices:[unknown,unknown][],value:unknown='',attrs='required')=>baseSelect(name,label,choices,value,attrs+' aria-label="'+h(label)+'"')
const path='/app/leads'
const labels: Record<string,string>={inquiry:'Inquiry','intro-booked':'Intro booked','first-visit':'First visit',offer:'Offer',membership:'Membership',lost:'Lost'}
const stages=Object.entries(labels)
const request=()=>hidden('requestId',crypto.randomUUID())
const localUTC=(at: string|null)=>at?.slice(0,16) ?? ''
function taskFields(s: any,lead?: any) {
  return select('ownerId','Assigned owner',s.leadOwners.map((o: any)=>[o.id,o.name]),lead?.ownerId ?? s.actor.id)
    + field('nextAction','Next action',lead?.nextAction ?? 'Call about a first class','text','maxlength="300"')
    + field('dueAt','Due at (UTC)',localUTC(lead?.dueAt),'datetime-local')
}
export function leadsPage(s: any,query: URLSearchParams) {
  if(s.actor.role === 'member')return `<div class="page single"><div class="page-main"><div class="page-title"><h1>Studio offers</h1></div>${emptyPlacesPanel(s)}${nurturePanel(s)}${winbackPanel(s)}${referralPanel(s)}</div></div>`;
  const r=s.pipeline,selected=r.leads.find((l: any)=>l.id===query.get('lead'))
  const stage=query.get('stage') ?? '',onlyOverdue=query.get('overdue')==='true'
  const visible=r.leads.filter((l: any)=>(!stage||l.stage===stage)&&(!onlyOverdue||l.overdue))
  const list=visible.map((l: any)=>`<tr data-lead-id="${h(l.id)}">`
    +cell('Person',`<a href="${path}?lead=${encodeURIComponent(l.id)}#lead">${h(person(s,l.personId))}</a>`)
    +cell('Stage',h(labels[l.stage]))+cell('Assigned owner',h(s.leadOwners.find((o: any)=>o.id===l.ownerId)?.name ?? 'Inactive owner'))
    +cell('Next action',`${h(l.nextAction ?? 'Closed')}${l.dueAt?`<small>${when(s,l.dueAt)}${l.overdue?' · Overdue':''}</small>`:''}`)+'</tr>').join('')
  const report=r.stages.map((row: any)=>`<tr>${cell('Stage',`<a href="${path}?stage=${h(row.stage)}">${h(labels[row.stage])}</a>`)}${cell('Leads',h(row.count))}${cell('Overdue',h(row.overdue))}</tr>`).join('')
  let detail=''
  if(selected) {
    const l=selected,back=path+'?lead='+encodeURIComponent(l.id)+'#lead'
    const bookings=s.bookings.filter((b: any)=>b.personId===l.personId)
    const guestSources=(r.guestSources ?? []).filter((source: any)=>source.leadId===l.id).map((source: any)=>`<li>Guest referrer: ${h(person(s,source.referrerId))} · ${when(s,source.at)} · ${h(source.channel)} · <a href="/app?booking=${encodeURIComponent(source.bookingId)}">Guest reservation</a></li>`).join('')
    const history=r.events.filter((e: any)=>e.leadId===l.id).map((e: any)=>`<li>${when(s,e.at)} · ${h(e.command==='guest.book' && e.actorRole!=='owner' ? 'Member booking' : s.leadOwners.find((o: any)=>o.id===e.actorId)?.name ?? 'Former owner')} · ${h(e.command==='guest.book'?'Guest booking recorded':e.command==='lead.note'?'Conversation recorded':e.command==='lead.create'?'Inquiry recorded':'Follow-up updated')}${e.after?.stage?` · ${h(labels[e.after.stage])}`:''}${e.note?`<p>${h(e.note)}</p>`:''}<details><summary>Recorded change</summary><p>From ${h(labels[e.before?.stage] ?? 'New inquiry')} to ${h(labels[e.after.stage])}. Next action: ${h(e.after.nextAction ?? 'Closed')}${e.after.dueAt?` · ${when(s,e.after.dueAt)}`:''}. Assigned owner: ${h(s.leadOwners.find((o: any)=>o.id===e.after.ownerId)?.name ?? 'Inactive owner')}.</p></details></li>`).join('')
    detail=panel(person(s,l.personId),body(`<p>Inquiry source: ${h(l.source ?? 'Unknown source')}</p><p>Stage: ${h(labels[l.stage])}${l.lostReason?` · Lost reason: ${h(l.lostReason)}`:''}${l.externalMembershipReference?` · Owner-recorded external membership: ${h(l.externalMembershipReference)}`:''}</p>`
      +(guestSources ? `<p>Recorded from guest bookings; no reward or marketing permission granted.</p><ul>${guestSources}</ul>` : '')
      +form('lead.update',back,hidden('id',l.id)+hidden('version',l.version)+request()+select('stage','Pipeline stage',stages,l.stage)+taskFields(s,l)
        +select('bookingId','Intro or attended booking',[['','No booking'],...bookings.map((b: any)=>[b.id,(s.classes.find((c: any)=>c.id===b.classId)?.title ?? b.classId)+' · '+(b.attendance ?? b.status)])],l.bookingId ?? '','')
        +field('externalMembershipReference','External membership reference',l.externalMembershipReference ?? '')+field('lostReason','Lost reason',l.lostReason ?? '')+textarea('note','Change note','','maxlength="2000"'),'Save follow-up')
      +'<p>Membership records an external outcome with your reference and note. It creates no plan, charge, payment authorization or message.</p>'
      +form('lead.note',back,hidden('id',l.id)+hidden('version',l.version)+request()+textarea('note','Conversation note','','required maxlength="2000"'),'Record conversation','quiet')
      +`<ol>${history}</ol>`),{id:'lead'})
  }
  return `<div class="page"><div class="page-main"><div class="page-title"><h1>Lead follow-up</h1><p>Assigned next actions and a retained history from inquiry to membership.</p></div>`
    +panel('Staff queue',body(`<form method="get" action="${path}" class="form">${select('stage','Filter stage',[['','All stages'],...stages],stage,'')}${select('overdue','Due filter',[['false','All leads'],['true','Overdue only']],String(onlyOverdue))}<button class="btn-quiet">Filter follow-up</button></form><p><a href="${path}?overdue=true">${h(r.overdue.length)} overdue follow-ups</a></p>`)+`<div class="table-wrap">${table(['Person','Stage','Assigned owner','Next action'],list||'<tr><td colspan="4">No leads in this view.</td></tr>')}</div>`)
    +recoveryPanel(s)+emptyPlacesPanel(s)+nurturePanel(s)+winbackPanel(s)+referralPanel(s)+detail+panel('Stage report',`<div class="table-wrap">${table(['Stage','Leads','Overdue'],report)}</div>`)+leadCampaignPanel(s.leadReport,s.intros.offers)+leadReportPanel(s.leadReport)
    +'</div><aside class="rail">'+panel('Record an inquiry',body(form('lead.create',path,request()+select('personId','Person',[['','Choose a person'],...s.people.filter((p: any)=>p.role==='member').map((p: any)=>[p.id,p.name])])+taskFields(s)+field('source','Inquiry source (optional)','','text','maxlength="100"')+select('campaignId','Inquiry campaign (optional)',[['','No campaign'],...s.leadCampaigns.campaigns.filter((c:any)=>c.startsAt<=new Date().toISOString()&&c.endsAt>new Date().toISOString()).map((c:any)=>[c.id,c.name])],'','')+textarea('note','Inquiry note','','maxlength="2000"'),'Add inquiry')))
    +panel('Recorded conversations',body('<p>Record calls, emails or conversations that actually happened. Saving a note does not send a message. The studio owner manages this queue until staff roles ship.</p>'))+'</aside></div>'
}

function recoveryPanel(s: any) {
  const rule=s.pipeline.recoveryRule;
  const controls=form('lead.recovery.rule.save',path,hidden('version',rule?.version ?? 0)
    +select('enabled','Recovery rule',[['false','Paused'],['true','Enabled']],String(rule?.enabled ?? false))
    +field('minVisits','Consecutive weekly visits',rule?.minVisits ?? 3,'number','min="2" max="12"')
    +field('missedWeeks','Missed available weeks',rule?.missedWeeks ?? 1,'number','min="1" max="12"')
    +field('lookbackWeeks','Look back in weeks',rule?.lookbackWeeks ?? 12,'number','min="2" max="52"'),'Save recovery rule','quiet')
    +form('lead.recovery.process',path,'','Refresh recovery tasks');
  const tasks=s.pipeline.recoveryTasks.map((task:any)=>`<article data-recovery-task="${h(task.id)}"><h3>${h(person(s,task.personId))} · ${h(task.status)}</h3><p>${h(task.nextAction)}</p><p>Rule revision ${h(task.ruleVersion)} · ${when(s,task.createdAt)}</p><details><summary>Booking evidence and alternatives</summary><p>Established visits:</p><ul>${task.sourceBookingIds.map((id:string)=>`<li><a href="/app?booking=${encodeURIComponent(id)}">${h(id)}</a></li>`).join('')}</ul><p>Missed opportunities:</p><ul>${task.opportunities.map((o:any)=>`<li>${when(s,o.at)} · ${h(o.classIds.join(', '))}${o.bookingIds.length ? ' · No-show bookings: '+h(o.bookingIds.join(', ')) : ' · No booking'}</li>`).join('')}</ul><p>Excluded weeks:</p><ul>${task.excluded.map((e:any)=>`<li>${when(s,e.at)} · ${h(e.reason)}</li>`).join('')}</ul><p>Alternatives (eligibility is checked again when booked):</p><ul>${task.alternatives.map((c:any)=>`<li><a href="/app/classes?class=${encodeURIComponent(c.classId)}">${h(c.title)} · ${when(s,c.start)}</a></li>`).join('') || '<li>No eligible alternative available.</li>'}</ul></details>${task.status === 'open' ? form('lead.recovery.complete',path,hidden('id',task.id)+request()+textarea('note','Recovery follow-up note','','required maxlength="2000"'),'Complete recovery task','quiet') : ''}</article>`).join('');
  return panel('Missed routine recovery',body('<p>Private owner tasks only. Nothing is sent. A routine needs completed visits at the same weekly class time and location. Frozen, canceled, excused, full and unavailable weeks do not count as missed visits. Refresh before acting on current evidence.</p>'+controls+(tasks || '<p>No justified recovery tasks.</p>')));
}

function emptyPlacesPanel(s: any) {
  const owner=s.actor.role === 'owner',rows=s.emptyPlaces;
  const offers=rows.offers.map((offer:any)=>{const entry=s.classes.find((c:any)=>c.id === offer.classId);return `<article data-empty-offer="${h(offer.id)}"><h3>${h(entry?.title ?? 'Class')} · ${h(offer.status)}</h3><p>${h(offer.text)}</p><p>${when(s,offer.expiresAt)} · Incentive $${(offer.incentiveCents/100).toFixed(2)} after attendance and owner review. An eligible plan credit is required; the offer reserves no seat.</p>${owner ? `<p>${h(person(s,offer.personId))}</p>` : ''}${offer.available ? form('lead.empty.accept',owner ? path : '/app/offers',hidden('id',offer.id)+request()+(owner ? select('channel','Member request channel',[['desk','At the desk'],['phone','By phone'],['inbox','In the inbox']]) : ''),'Accept class offer') : `<p>${h(offer.unavailableReason ?? (offer.rewardedAt ? 'Incentive recorded on studio balance' : offer.status))}</p>`}${owner && offer.status === 'accepted' && !offer.rewardedAt ? form('lead.empty.settle',path,hidden('id',offer.id)+request(),'Review attended incentive','quiet') : ''}</article>`;}).join('');
  let controls='';
  if(owner) {
    const audience=s.people.filter((p:any)=>p.role === 'member' && p.active).map((p:any)=>select('aud_'+p.id,'Audience: '+p.name,[['false','Exclude'],['true','Include']],'false')).join('');
    controls=form('lead.empty.prepare',path,select('classId','Class to fill',s.classes.filter((c:any)=>c.status === 'published' && c.start > new Date().toISOString()).map((c:any)=>[c.id,c.title+' · '+when(s,c.start)]))
      +field('leadMinutes','Maximum lead time in minutes',1440,'number','min="1" max="10080"')+field('maxPer30Days','Offer cap per member per 30 days',1,'number','min="1" max="30"')
      +field('incentive','Attended-visit incentive in dollars','0.00','text','inputmode="decimal"')+field('budget','Total incentive budget in dollars','0.00','text','inputmode="decimal"')+textarea('text','Offer wording','','required maxlength="1000"')+audience,'Preview class offers','quiet');
    controls+=rows.campaigns.map((campaign:any)=>`<details data-empty-campaign="${h(campaign.id)}"><summary>${h(campaign.status)} · ${h(campaign.text)}</summary><p>Budget $${(campaign.budgetCents/100).toFixed(2)}. Per attended visit $${(campaign.incentiveCents/100).toFixed(2)}. Lead time ${h(campaign.leadMinutes)} minutes. Cap ${h(campaign.maxPer30Days)} per 30 days. Class preference is the member’s comma-separated service list; blank permits any service.</p><ul>${campaign.audience.map((row:any)=>`<li>${h(person(s,row.personId))}: ${h(row.reason ?? 'Eligible')}</li>`).join('')}</ul>${campaign.status === 'preview' ? form('lead.empty.approve',path,hidden('id',campaign.id)+hidden('key',campaign.key),'Approve in-app offers') : ''}</details>`).join('');
  }
  return panel('Empty-place offers',body('<p>Owner-approved in-app invitations. The waitlist comes first; accepting rechecks eligibility, seats and the shared incentive budget. No email or text campaign is sent.</p>'+controls+(offers || '<p>No class offers.</p>')));
}

function nurturePanel(s:any) {
  const owner=s.actor.role === 'owner',r=s.nurture,back=owner?path:'/app/offers';
  const messages=r.messages.map((m:any)=>`<article data-nurture-message="${h(m.id)}"><h3>${h(m.step.replace(/-/g,' '))}</h3><p>${h(m.text)}</p>${owner?`<p>${h(person(s,m.personId))}</p>`:''}</article>`).join('');
  const offers=r.offers.map((offer:any)=>`<article data-nurture-offer="${h(offer.id)}"><h3>${h(offer.terms.name)} · ${h(offer.status)}</h3><p>${h(offer.text)}</p><p>$${(offer.terms.amountCents/100).toFixed(2)} on your studio balance, or your previously accepted household payer’s balance, for ${h(offer.terms.days)} days of unlimited eligible visits at the studio location. Services: ${h(offer.terms.eligibleServices.join(', ') || 'all services')}. No payment collected or automatic renewal. Offer ends ${when(s,offer.expiresAt)}.</p>${owner?`<p>${h(person(s,offer.personId))}</p>`:''}${offer.status === 'offered' ? form('lead.nurture.purchase',back,hidden('id',offer.id)+hidden('key',offer.key)+hidden('confirm','true')+request()+(owner?select('channel','Membership request channel',[['desk','At the desk'],['phone','By phone'],['inbox','In the inbox']]):''),'Accept exact finite membership') : `<p>${h(offer.suppressionReason ?? offer.status)}</p>`}</article>`).join('');
  const controls=owner ? form('lead.nurture.save',path,select('introOfferId','Intro offer for this sequence',s.intros.offers.filter((o:any)=>o.active).map((o:any)=>[o.id,o.name]))
    +textarea('welcome','Welcome wording','','required maxlength="1500"')+textarea('guidance','First-class preparation','','required maxlength="1500"')+textarea('offerText','Membership offer wording','','required maxlength="1000"')
    +field('planName','Finite membership name','','text','required maxlength="80"')+field('days','Membership days',30,'number','min="1" max="366"')+field('amount','Membership price in dollars','100.00','text','inputmode="decimal"')
    +'<p>The finite membership covers the intro’s eligible services at the studio location. It creates a studio-balance charge only after the exact offer is accepted. It never renews.</p>','Approve welcome sequence')
    +form('lead.nurture.review',path,'','Review intro events and deliver in-app steps','quiet')+r.sequences.map((seq:any)=>`<details><summary>${h(seq.terms.name)} · ${seq.enabled?'Approved':'Paused'}</summary><p>${h(seq.welcome)}</p><p>${h(seq.guidance)}</p>${seq.enabled?form('lead.nurture.pause',path,hidden('id',seq.id),'Pause welcome sequence','quiet'):''}</details>`).join('')
    +r.tasks.map((t:any)=>`<p>${h(person(s,t.personId))}: ${h(t.nextAction)} · ${h(t.status)}${t.stopReason?' · '+h(t.stopReason):''}</p>`).join('') : '';
  return panel('Intro welcome and next steps',body('<p>Approved in-app guidance follows a real intro purchase. Replies, marketing opt-out and membership purchase stop future sales steps.</p>'+controls+messages+offers+(!owner && !messages && !offers?'<p>No intro welcome or membership offer.</p>':'')));
}

export function referralsPage(s:any) {
  return `<div class="page single"><div class="page-main"><div class="page-title"><h1>Member referrals</h1></div>${referralPanel(s)}</div></div>`;
}
function referralPanel(s:any) {
  const owner=s.actor.role === 'owner',staff=owner || s.actor.role === 'front-desk',back=owner?path:staff?'/app/referrals':'/app/offers';
  const fields=(staff?select('personId','Referring member',s.people.filter((p:any)=>p.role === 'member' && p.active).map((p:any)=>[p.id,p.name])):hidden('personId',s.actor.personId))
    +field('friendEmail','Friend’s email','','email','required maxlength="254"')+request()
    +(staff?select('channel','Referral request channel',[['desk','At the desk'],['phone','By phone'],['inbox','In the inbox']])+textarea('sourceReference','Member’s referral request reference','','required maxlength="500"'):'');
  const referrals=s.winback.referrals.map((r:any)=>`<article data-referral="${h(r.id)}"><p>${staff?h(person(s,r.personId))+' · ':''}${h(r.friendEmail)} · ${h(owner ? r.status : r.attribution.replace(/_/g,' '))}</p><p>${when(s,r.createdAt)} · ${h(r.source)}</p>${owner && r.verifiedAt?`<p>Verified member attribution retained once. Reference: ${h(r.sourceReference)}</p>`:owner ? form('lead.referral.record',back,hidden('personId',r.personId)+hidden('friendEmail',r.friendEmail)+hidden('channel','desk')+request()+textarea('sourceReference','Verification of member referral request',r.sourceReference ?? '','required maxlength="500"'),'Verify recorded referral','quiet'):''}</article>`).join('');
  return panel('Refer a friend',body('<p>Record a referral the member actually requested. Nothing is sent to the friend. Only the owner reviews matches and eligibility; this page does not confirm whether the friend has a studio account.</p>'+form('lead.referral.record',back,fields,staff?'Record member referral':'Submit referral','quiet')+referrals));
}
function winbackPanel(s:any) {
  const owner=s.actor.role === 'owner',r=s.winback,back=owner?path:'/app/offers';
  const offers=r.offers.map((offer:any)=>`<article data-winback-offer="${h(offer.id)}"><h3>${h(offer.terms.name)} · ${h(offer.status)}</h3><p>${h(offer.text)}</p><p>$${(offer.terms.amountCents/100).toFixed(2)} on your studio balance, or your previously accepted household payer’s balance, for ${h(offer.terms.days)} days of unlimited eligible visits at the studio location. Services: ${h(offer.terms.eligibleServices.join(', ') || 'all services')}. No payment collected or automatic renewal. Offer expires ${when(s,offer.expiresAt)}.</p>${owner?`<p>${h(person(s,offer.personId))} · Original ended plan IDs: ${h(offer.sourcePackIds.join(', '))}</p>`:''}${offer.status === 'offered'?form('lead.winback.purchase',back,hidden('id',offer.id)+hidden('key',offer.key)+hidden('confirm','true')+request()+(owner?select('channel','Win-back request channel',[['desk','At the desk'],['phone','By phone'],['inbox','In the inbox']]):''),'Accept exact win-back membership'): `<p>${h(offer.suppressionReason ?? offer.status)}</p>`}${owner && offer.status === 'purchased'?`<p>Redemption: ${h(offer.packId)}. Visits using this renewed plan: ${h(offer.laterAttendedBookingIds.length)}. Reserved referral reward $${((offer.reservedRewardCents ?? 0)/100).toFixed(2)}; recorded cost $${((offer.rewardCostCents ?? 0)/100).toFixed(2)}.</p>${offer.referralId && !offer.rewardedAt?form('lead.winback.reward',path,hidden('id',offer.id)+request(),'Review attended referral reward','quiet'):''}`:''}</article>`).join('');
  let controls='';
  if(owner) {
    controls=form('lead.winback.prepare',path,field('planName','Win-back finite membership name','','text','required maxlength="80"')+field('days','Win-back membership days',30,'number','min="1" max="366"')
      +field('amount','Win-back price in dollars','90.00','text','inputmode="decimal"')+field('services','Eligible services, separated by commas','','text','maxlength="1000"')
      +field('reward','Verified referral reward in dollars','0.00','text','inputmode="decimal"')+field('budget','Referral reward budget in dollars','0.00','text','inputmode="decimal"')
      +field('cadenceDays','Minimum days between offers',30,'number','min="1" max="3650"')+field('offerDays','Offer valid for days',7,'number','min="1" max="30"')+textarea('text','Win-back wording','','required maxlength="1000"')
      +s.people.filter((p:any)=>p.role === 'member').map((p:any)=>select('wb_'+p.id,'Win-back audience: '+p.name,[['false','Exclude'],['true','Include']],'false')).join(''),'Preview win-back audience','quiet')
      +r.campaigns.map((campaign:any)=>`<details data-winback-campaign="${h(campaign.id)}"><summary>${h(campaign.terms.name)} · ${h(campaign.status)}</summary><p>${h(campaign.text)}</p><p>Reward budget $${(campaign.budgetCents/100).toFixed(2)}; per verified referral $${(campaign.rewardCents/100).toFixed(2)}. Cadence ${h(campaign.cadenceDays)} days. No automatic email, text, reward or payment.</p><ul>${campaign.audience.map((row:any)=>`<li>${h(person(s,row.personId))}: ${h(row.reason ?? 'Eligible')} · Ended plan IDs: ${h(row.packIds.join(', '))}</li>`).join('')}</ul>${campaign.status==='preview'?form('lead.winback.approve',path,hidden('id',campaign.id)+hidden('key',campaign.key),'Approve win-back invitations'):''}</details>`).join('')
      +`<p>Observed redemptions: ${h(r.totals.redemptions)}. Later visits using renewed plans: ${h(r.totals.laterVisits)}. Reward reservations $${(r.totals.reservedCents/100).toFixed(2)}; recorded reward cost $${(r.totals.rewardCostCents/100).toFixed(2)}. Visits are observed outcomes, not a claim of causal recovery or collected payments.</p>`;
  }
  return panel('Win-back memberships',body('<p>Explicitly approved in-app invitations for eligible former members. Opt-out suppresses an existing offer permanently; fresh enrollment requires a new human-approved audience and the cadence cap. Referral rewards require verified attribution, an actual renewal, completed attendance and owner review.</p>'+controls+offers+(!owner && !offers?'<p>No win-back membership offer.</p>':'')));
}

import { body, field, form, h, hidden, panel, select } from './shared';

export function terminationReasonsPanel(s: any) {
  if (s.actor.role !== 'owner') return '';
  const back='/app/studio#termination-reasons';
  const fields=(reason:any)=>hidden('revision',reason.revision)+hidden('requestId',crypto.randomUUID())
    +(reason.id?hidden('code',reason.code)+`<p>Stable code: ${h(reason.code)}</p>`:field('code','Stable code','','text','required maxlength="50" pattern="[a-z][a-z0-9_-]*"'))
    +field('label','Reason label',reason.label,'text','required maxlength="100"')
    +select('active','Availability',[['true','Active'],['false','Retired']],String(reason.active));
  const current=(s.cancellations?.reasonCodes??[]).map((reason:any)=>`<article data-termination-reason="${h(reason.code)}"><h3>${h(reason.label)} · ${reason.active?'Active':'Retired'}</h3>${form('plan.cancellation.reason.save',back,fields(reason),'Save reason code','quiet')}</article>`).join('');
  return panel('Termination reason codes',body('<p>Codes stay fixed. Labels and availability affect new previews; confirmed terminations keep the code and label originally reviewed. Retire a code to stop new use while preserving history.</p>'
    +current+`<details><summary>Add termination reason</summary>${form('plan.cancellation.reason.save',back,fields({revision:0,label:'',active:true}),'Add reason code','quiet')}</details>`),{id:'termination-reasons',icon:'card'});
}

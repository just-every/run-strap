import {money} from './format'
import { body, field, form, h, hidden, panel, select, statusPill } from './shared'

const confirm=(label:string)=>'<label class="check"><input name="confirm" type="checkbox" value="yes" required>'+h(label)+'</label>'
export function privacyPanel(s:any,personId:string,back:string) {
  if(s.actor.role!=='owner' || !s.privacy?.requests)return ''
  const requests=s.privacy.requests.filter((r:any)=>r.personId===personId)
  const entries=requests.map((request:any)=>{
    const title='<h3>'+h(request.type==='access'?'Access request':'Erasure request')+'</h3><p>'+statusPill(request.status)+' · '+h(request.channel)+' · '+h(request.createdAt)+'</p>'
    let action=''
    if(request.status==='requested')action=form('privacy.verify',back,hidden('id',request.id)+select('method','Identity verification method',[['callback-on-file','Callback to contact on file'],['in-person-document','Document checked in person'],['signed-in-member','Confirmed in the member account']])+confirm('I verified this member’s identity.'),'Record identity check')
    if(request.type==='access' && ['verified','exported','delivered'].includes(request.status)) {
      action+=form('privacy.export',back,hidden('id',request.id),'Download member copy','quiet')
      if(request.status==='exported')action+=form('privacy.deliver',back,hidden('id',request.id)+select('delivery','Delivery method',[['in-person','Handed to the verified member'],['secure-transfer','Secure transfer to the verified member']])+confirm('I delivered this copy to the verified member.'),'Record delivery')
    }
    if(request.type==='erasure' && request.status==='verified') {
      action+=form('privacy.erase.prepare',back,hidden('id',request.id)
        +select('obligations','Outstanding balance',[['settled','Require a settled balance'],['retain','Retain the existing obligation'],['cancel','Cancel positive outstanding debt']])
        +field('reason','Reason to retain financial evidence','','text','required maxlength="500"')
        +field('retainUntil','Retain identifying documents until (UTC)','','date','required')
        +select('documents','Signed member evidence',[['delete','Delete local affirmations and agreements'],['retain','Retain restricted evidence until the date']])
        +field('holdBasis','Document hold basis (optional)','','text','maxlength="500"')
        +field('holdReviewAt','Hold review date (UTC)','','date')
        +field('holdReleaseCondition','Hold release condition','','text','maxlength="500"')
        +'<label class="check"><input name="retireAccess" type="checkbox" value="yes" required>I approve ending sign-in and access. This does not settle a refund or erase external copies.</label>','Review erasure')
      const review=s.privacy.reviews.findLast((r:any)=>r.requestId===request.id)
      if(review)action+='<div data-privacy-review><p>Reviewed balance: '+money(review.balanceCents)+'. Decision: '+h(review.obligations)+'. '+h(review.inventory.length)+' related records. Account access and scoped authority for this member end; other people’s balances stay unchanged.</p><p>'+h(review.retention.reason)+' · '+h(review.retention.retainUntil)+'. Document decision: '+h(review.documents)+'.</p>'
        +form('privacy.erase.confirm',back,hidden('id',review.id)+confirm('I approve this exact erasure and retention decision.'),'Confirm member erasure','quiet')+'</div>'
    }
    return '<article>'+title+action+'</article>'
  }).join('')
  return '<details class="more" id="privacy"><summary>Privacy requests</summary><div class="panel-body"><p>Verify identity before sharing or deleting data. A download is recorded separately from delivery to the member. Provider accounts and external copies need separate handling.</p>'
    +form('privacy.request',back,hidden('personId',personId)+hidden('requestId',crypto.randomUUID())
      +select('type','Request type',[['access','Access copy'],['erasure','Erase personal data']])
      +select('channel','Request received through',[['desk','In person'],['phone','Phone'],['inbox','Email']]),'Record privacy request')
    +entries+'</div></details>'
}
export function privacyRetentionPanel(s:any) {
  if(s.actor.role!=='owner' || !s.privacy?.requests)return ''
  const retained=s.privacy.retained.map((r:any)=>'<article><h3>Retained member evidence</h3><p>'+h(r.reason)+' · Retain until '+h(r.retainUntil)+'.</p>'
    +(r.hold&&!r.hold.releasedAt?'<p>Hold: '+h(r.hold.basis)+'. Review '+h(r.hold.reviewAt)+'. Release condition: '+h(r.hold.releaseCondition)+'.</p>':'')
    +form('privacy.retained','/app/studio#privacy-retention',hidden('id',r.id),'Download retained evidence','quiet')
    +(r.hold&&!r.hold.releasedAt?form('privacy.hold.release','/app/studio#privacy-retention',hidden('id',r.id)+field('reason','Reason to release this hold','','text','required maxlength="500"')+confirm('The recorded hold can be released.'),'Release document hold','quiet'):'')
    +form('privacy.dispose','/app/studio#privacy-retention',hidden('id',r.id)+confirm('Dispose of evidence whose retention date has passed.'),'Dispose expired evidence','quiet')+'</article>').join('')
  const receipts=s.privacy.receipts.map((r:any)=>'<p>Erased member '+h(r.personId)+' · '+h(r.erasedAt)+' · Balance decision: '+h(r.obligations)+'. '+h(r.externalCopies)+'</p>').join('')
  return panel('Privacy retention',body('<p>Only the owner with privacy authority can read retained evidence, release a hold or dispose of records. Holds prevent disposal; expiry does not trigger automatic deletion.</p>'+retained+receipts+(retained||receipts?'':'<p>No retained documents or erasure receipts.</p>')),{id:'privacy-retention'})
}

import assert from 'node:assert/strict'
import {privacyDecision,verifiedPrivacyRequest} from './privacy-journey.mjs'

// All records and all privacy actions use the authenticated public command door.
export async function privacySigning(h) {
  for(const documents of ['delete','retain']) {
    const guardian=await h.person('Syntheticguardian'+documents),other=await h.person('Syntheticotherguardian'+documents)
    const child=await h.person('Syntheticparticipant'+documents),peer=await h.person('Syntheticpeerparticipant'+documents)
    const home=await h.cmd('household.save',{name:'Synthetic signing family '+documents})
    for(const who of [child,peer])await h.cmd('household.participant.add',{id:home.id,personId:who.id})
    for(const who of [guardian,other])await h.cmd('household.guardian.link',{id:home.id,guardianId:who.id,evidenceReference:'Synthetic authority '+who.name})
    await h.cmd('member.note.add',{personId:child.id,text:'Synthetic child private note '+documents,alert:false})
    const waiver=await h.cmd('waiver.publish',{text:'Synthetic exact shared signing document '+documents,requiresSignature:true})
    const sign=(who,participant)=>h.cmd('waiver.acknowledge',{id:waiver.id,documentHash:waiver.documentHash,signerName:who.name,participantId:participant.id,confirm:true},who.cookie)
    const receipt=await sign(guardian,child),unrelated=await sign(other,peer)
    // Historical personal signing evidence remains the signer's even after authority ends.
    await h.cmd('household.guardian.remove',{id:home.id,guardianId:guardian.id,reason:'Synthetic authority ended'})
    const request=await verifiedPrivacyRequest(h,guardian,'access','-guardian-'+documents)
    await h.cmd('privacy.export',{id:request.id},other.cookie,403)
    const bundle=await h.cmd('privacy.export',{id:request.id})
    assert.deepEqual(bundle.records.filter(r=>r.kind==='acknowledgement').map(r=>r.data),[receipt])
    assert.deepEqual(bundle.documents,[{receipt,document:waiver}],'subject access includes the exact guardian signature, authority, document, version and hash')
    for(const value of [unrelated.id,other.email,peer.name,child.email,'Synthetic child private note '+documents])assert.ok(!JSON.stringify(bundle).includes(value),'signing evidence does not disclose another signing or the child profile')
    await h.cmd('privacy.deliver',{id:request.id,delivery:'secure-transfer',confirm:true})
    const erase=await verifiedPrivacyRequest(h,guardian,'erasure','-guardian-'+documents)
    const review=await h.cmd('privacy.erase.prepare',{id:erase.id,...privacyDecision,documents,...(documents==='retain'?{retainUntil:'2032-01-07T00:00:00Z',holdBasis:'Synthetic signing dispute',holdReviewAt:'2032-01-07T00:00:00Z',holdReleaseCondition:'Owner confirms resolution'}:{})})
    assert.ok(review.inventory.some(r=>r.id===receipt.id&&r.disposition===documents))
    await h.cmd('privacy.erase.confirm',{id:review.id,confirm:true})
    await h.state(guardian.cookie,401)
    for(const cookie of [h.owner,child.cookie,other.cookie])assert.equal((await h.send('/api/strap/waiver-evidence.json?id='+receipt.id,undefined,cookie)).status,404)
    assert.equal((await h.send('/api/strap/waiver-evidence.json?id='+unrelated.id,undefined,peer.cookie)).status,200)
    assert.deepEqual((await h.state()).acknowledgements.find(r=>r.id===unrelated.id),unrelated,'another guardian signature is untouched')
    assert.ok((await h.state()).people.some(p=>p.id===child.id),'signer erasure preserves the participant')
    const retained=(await h.state()).privacy.retained.find(r=>r.sourceId===receipt.id)
    if(documents==='retain') {
      assert.ok(retained)
      const evidence=await h.cmd('privacy.retained',{id:retained.id})
      assert.deepEqual(evidence.content.receipt,receipt);assert.deepEqual(evidence.content.document,waiver)
      assert.equal(evidence.reason,privacyDecision.reason);assert.equal(evidence.hold.scope,'member-documents')
      await h.cmd('privacy.retained',{id:retained.id},child.cookie,403)
      assert.equal((await h.cmd('privacy.dispose',{id:retained.id,confirm:true},h.owner,409)).error,'privacy_hold_active')
      await h.cmd('privacy.hold.release',{id:retained.id,reason:'Synthetic signing dispute resolved',confirm:true})
      assert.equal((await h.cmd('privacy.dispose',{id:retained.id,confirm:true},h.owner,409)).error,'privacy_retention_not_due')
      h.sharedSigningRetention={id:retained.id,guardian}
    } else {
      assert.equal(retained,undefined)
      const exit=await h.send('/api/strap/exit.json',undefined,h.owner)
      for(const value of [guardian.name,guardian.email])assert.ok(!exit.text.includes(value),'deleted shared signing evidence leaves no signer identity in the portable exit')
      assert.ok(exit.text.includes(child.name));assert.ok(exit.text.includes(peer.name))
    }
    // Removing the old shared receipt requires fresh personal completion by a remaining guardian.
    const replacement=await sign(other,child)
    assert.notEqual(replacement.id,receipt.id);assert.equal(replacement.signature.signerPersonId,other.id)
    if(documents==='delete') {
      const childRequest=await verifiedPrivacyRequest(h,child,'erasure','-shared-signing-participant')
      const childReview=await h.cmd('privacy.erase.prepare',{id:childRequest.id,...privacyDecision})
      await h.cmd('privacy.erase.confirm',{id:childReview.id,confirm:true})
      const exit=await h.send('/api/strap/exit.json',undefined,h.owner)
      for(const value of [child.name,child.email,'Synthetic child private note '+documents])assert.ok(!exit.text.includes(value),'participant erasure removes its shared signing evidence and personal data')
      assert.equal((await h.send('/api/strap/waiver-evidence.json?id='+replacement.id,undefined,other.cookie)).status,404)
      assert.equal((await h.send('/api/strap/waiver-evidence.json?id='+unrelated.id,undefined,other.cookie)).status,200)
      assert.ok((await h.state()).people.some(p=>p.id===other.id),'participant erasure preserves the guardian account')
    }
  }
}

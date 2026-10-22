import assert from 'node:assert/strict'

const day = 86400000
const iso = value => new Date(value).toISOString()
const waitUntil = value => new Promise(resolve => setTimeout(resolve, Math.max(0, value - Date.now())))

// Called inside PLAN-007 with a fresh, already claimed harness. Public commands
// establish consent; persisted historical facts exercise real clock boundaries.
export async function authorityCases(h) {
  await h.cmd('studio.save', {location:'Pasadena', timeZone:'America/New_York'})
  let sequence = 9000
  const requestId = () => 'synthetic-strap-' + ++sequence
  const save = (kind, value) => h.db.prepare('UPDATE st_records SET data=? WHERE kind=? AND id=?')
    .bind(JSON.stringify(value), kind, value.id).run()
  const sell = async (member, amountCents = 12000) => {
    const draft = await h.cmd('pack.prepare', {personId:member.id, credits:6, amountCents, expiresAt:iso(Date.now() + 90 * day)})
    const approved = await h.cmd('pack.approve', {id:draft.id})
    return (await h.state()).packs.find(pack => pack.id === approved.id)
  }
  const agree = async (pack, member) => {
    const preview = await h.cmd('plan.recurring.prepare', {packId:pack.id, intervalMonths:1, requestId:requestId()})
    return h.cmd('plan.recurring.accept', {id:preview.id, key:preview.key}, member.cookie)
  }
  const stop = (pack, member, status = 200) => h.cmd('plan.cancellation.stop', {packId:pack.id, requestId:requestId()}, member.cookie, status)
  const denied = async (name, input, member) => {
    const before = (await h.state()).version
    const response = await h.send('/api/strap/command', {name, input}, member.cookie)
    assert.equal(response.status, 404, response.text)
    assert.equal((await h.state()).version, before, 'denied authority cannot write')
    return response.value
  }
  const member = await h.person('Asha'), payer = await h.person('Ravi')
  const guardian = await h.person('Leah'), child = await h.person('Zoe'), otherChild = await h.person('Theo')

  const covered = await sell(member), coveredTerms = await agree(covered, member)
  const grant = await h.cmd('contract.authority.save', {
    personId:member.id, delegateId:payer.id, kind:'payer', evidenceReference:requestId()
  })
  assert.ok(!(await h.state(payer.cookie)).cancellations.authorities.some(row => row.id === grant.id))
  const hiddenGrant = await denied('contract.authority.accept', {id:grant.id}, payer)
  const unknownGrant = await denied('contract.authority.accept', {id:'synthetic-strap-unknown-authority'}, payer)
  assert.deepEqual(hiddenGrant, unknownGrant, 'pre-consent refusal is identical to an unknown authority ID')
  const hiddenContract = await denied('plan.cancellation.stop', {packId:covered.id, requestId:requestId()}, payer)
  const unknownContract = await denied('plan.cancellation.stop', {packId:'synthetic-strap-unknown-pack', requestId:requestId()}, payer)
  assert.deepEqual(hiddenContract, unknownContract, 'pre-consent cancellation reveals no agreement existence')
  await h.cmd('contract.authority.accept', {id:grant.id}, member.cookie)
  await h.cmd('contract.authority.accept', {id:grant.id}, payer.cookie)

  // A later agreement and a historical retail ledger fact belong to the same
  // participant but not this grant. There is no native retail sale command yet.
  const unrelated = await sell(member, 4300), unrelatedTerms = await agree(unrelated, member)
  const retail = {id:requestId(), personId:member.id, reason:'retail', description:'Canvas studio bag', amountCents:6789, createdAt:iso(Date.now() - day)}
  await h.db.prepare('INSERT INTO st_records (id,kind,data,version) VALUES (?,?,?,?)')
    .bind(retail.id, 'charge', JSON.stringify(retail), (await h.state()).version).run()
  const stopped = await stop(covered, payer)
  assert.equal(stopped.effects.existingBalanceCents, 12000, 'covered cancellation excludes other packs and retail debt')
  assert.equal(stopped.effects.projectedFinalBalanceCents, 12000)
  assert.ok(!(await h.state(payer.cookie)).cancellations.contracts.some(row => row.id === unrelatedTerms.id))
  await denied('plan.cancellation.stop', {packId:unrelated.id, requestId:requestId()}, payer)
  const projected = JSON.stringify(await h.state(payer.cookie))
  assert.ok(!projected.includes(retail.id) && !projected.includes(retail.description), 'retail charge facts never reach the payer')
  const payerPage = await h.send('/app/packs', undefined, payer.cookie)
  assert.equal(payerPage.status, 200)
  assert.ok(!payerPage.text.includes('67.89') && !payerPage.text.includes('230.89'), 'payer screen excludes retail amount and participant total')
  assert.ok(!payerPage.text.includes(retail.description))

  // A separate participant revokes a payer after cancellation. The payer loses
  // withdrawal rights; the cancellation remains and will still apply once due.
  const revokingMember = await h.person('Nadia'), revokingPack = await sell(revokingMember)
  await agree(revokingPack, revokingMember)
  const revokedGrant = await h.cmd('contract.authority.save', {
    personId:revokingMember.id, delegateId:payer.id, kind:'payer', evidenceReference:requestId()
  })
  await h.cmd('contract.authority.accept', {id:revokedGrant.id}, revokingMember.cookie)
  await h.cmd('contract.authority.accept', {id:revokedGrant.id}, payer.cookie)
  const revokedStop = await stop(revokingPack, payer)
  const revokedWithdrawal = await h.cmd('plan.cancellation.withdraw.prepare', {id:revokedStop.id, requestId:requestId()}, payer.cookie)
  await h.cmd('contract.authority.revoke', {id:revokedGrant.id}, revokingMember.cookie)
  await denied('plan.cancellation.withdraw.prepare', {id:revokedStop.id, requestId:requestId()}, payer)
  await denied('plan.cancellation.withdraw.confirm', {id:revokedWithdrawal.id, key:revokedWithdrawal.key, requestId:requestId()}, payer)
  assert.equal((await h.state()).cancellations.cancellations.find(row => row.id === revokedStop.id).status, 'scheduled')

  // First verify a genuine future guardian grant. Move only its persisted cutoff
  // into a historical boundary fixture; no application clock is overridden.
  const childPack = await sell(child), childTerms = await agree(childPack, child)
  const childGrant = await h.cmd('contract.authority.save', {
    personId:child.id, delegateId:guardian.id, kind:'minor-guardian',
    adultOn:iso(Date.now() + 730 * day).slice(0,10), evidenceReference:requestId()
  })
  const acceptedGuardian = await h.cmd('contract.authority.accept', {id:childGrant.id}, guardian.cookie)
  assert.equal(acceptedGuardian.memberAcceptedAt, null, 'a guardian needs no child acceptance')
  await denied('contract.authority.revoke', {id:childGrant.id}, child)
  const guardianPage = await h.send('/app/packs', undefined, guardian.cookie)
  assert.equal(guardianPage.status, 200)
  assert.ok(guardianPage.text.includes(childGrant.adultOn), 'guardian screen shows the verified end date')
  const cutoffMs = Math.ceil(Date.now() / 1000) * 1000 + 4000, cutoff = iso(cutoffMs)
  await save('contractAuthority', {...acceptedGuardian, adultOn:cutoff.slice(0,10), adultAt:cutoff, authorityEndsAt:cutoff})
  await waitUntil(cutoffMs - 1000 + 10)
  const guardianStopped = await stop(childPack, guardian)
  assert.equal(Math.floor(Date.parse(guardianStopped.confirmedAt) / 1000), cutoffMs / 1000 - 1, 'guardian stops in the final second of authority')
  assert.equal(guardianStopped.status, 'scheduled')
  await waitUntil(cutoffMs + 1000)
  await denied('plan.cancellation.stop', {packId:childPack.id, requestId:requestId()}, guardian)
  await denied('plan.cancellation.withdraw.prepare', {id:guardianStopped.id, requestId:requestId()}, guardian)
  assert.equal((await h.state()).cancellations.cancellations.find(row => row.id === guardianStopped.id).status, 'scheduled', 'expiry preserves a scheduled cancellation')
  assert.ok(!(await h.state(guardian.cookie)).cancellations.contracts.some(row => row.id === childTerms.id), 'expired guardian loses agreement access')
  await h.cmd('plan.cancellation.withdraw.confirm',{id:revokedWithdrawal.id,key:revokedWithdrawal.key,requestId:requestId()},revokingMember.cookie,403);
  const restored = await h.cmd('plan.cancellation.withdraw.prepare', {id:guardianStopped.id, requestId:requestId()}, child.cookie)
  assert.equal(restored.requiresFreshAcceptance, true)
  await h.cmd('plan.cancellation.withdraw.confirm', {id:restored.id, key:restored.key, requestId:requestId()}, child.cookie)
  assert.equal((await h.state()).recurring.terms.find(row => row.id === childTerms.id).status, 'stopped', 'withdrawal does not restore invoices')
  const fresh = await h.cmd('plan.recurring.prepare', {packId:childPack.id, intervalMonths:1, requestId:requestId()})
  assert.equal((await h.state()).recurring.terms.find(row => row.id === fresh.id).status, 'preview')
  const acceptedFresh = await h.cmd('plan.recurring.accept', {id:fresh.id, key:fresh.key}, child.cookie)
  assert.equal(acceptedFresh.acceptedBy, (await h.state(child.cookie)).actor.id, 'only the participant accepts fresh recurring authority')

  // Majority is derived from birth and state on file, rather than assuming 18.
  const majorityYear = new Date().getUTCFullYear() + 1, adultOn = `${majorityYear}-12-15`
  const otherPack = await sell(otherChild)
  await agree(otherPack, otherChild)
  for (const [region, age] of [['AL',19], ['NE',19], ['MS',21]]) {
    await h.cmd('contract.jurisdiction.save', {personId:otherChild.id, region, evidenceReference:requestId()})
    const stateGrant = await h.cmd('contract.authority.save', {
      personId:otherChild.id, delegateId:guardian.id, kind:'minor-guardian',
      birthOn:`${majorityYear - age}-12-15`, adultOn, evidenceReference:requestId()
    })
    assert.equal(stateGrant.adultOn, adultOn)
    assert.equal(stateGrant.majorityAge, age)
    assert.equal(stateGrant.majorityRegion, region)
    assert.equal(stateGrant.adultAt, `${majorityYear}-12-15T05:00:00.000Z`, 'majority begins at studio midnight')
    await h.cmd('contract.authority.accept', {id:stateGrant.id}, guardian.cookie)
    assert.ok((await h.state(guardian.cookie)).cancellations.contracts.some(row => row.packId === otherPack.id))
    await h.cmd('contract.authority.revoke', {id:stateGrant.id, reason:'Verified guardian evidence superseded'})
    await denied('plan.cancellation.stop', {packId:otherPack.id, requestId:requestId()}, guardian)
  }

  const emancipating={personId:otherChild.id,delegateId:guardian.id,kind:'minor-guardian',birthOn:`${majorityYear-21}-12-15`,adultOn,evidenceReference:requestId()};
  const emancipationGrant=await h.cmd('contract.authority.save',emancipating);await h.cmd('contract.authority.accept',{id:emancipationGrant.id},guardian.cookie);
  const emancipatedOn=iso(Date.now()-day).slice(0,10);
  const emancipated=await h.cmd('contract.authority.save',{...emancipating,emancipatedOn,emancipationEvidenceReference:requestId()});
  assert.equal(emancipated.authorityEndsOn,emancipatedOn);assert.ok(emancipated.authorityEndsAt<iso(Date.now()));
  await denied('plan.cancellation.stop',{packId:otherPack.id,requestId:requestId()},guardian);

  // Make both outstanding cancellations due as persisted history and run the
  // scheduler once: revocation cannot undo the stop or add an invoice.
  const due = iso(Date.now() - 1000)
  for (const [pack, cancellation] of [[covered, stopped], [revokingPack, revokedStop]]) {
    const currentPack = (await h.state()).packs.find(row => row.id === pack.id)
    await save('pack', {...currentPack, expiresAt:due})
    await save('contractCancellation', {...cancellation, effectiveAt:due})
  }
  await (await h.mf.getWorker()).scheduled()
  const final = await h.state(), payerFinal = await h.state(payer.cookie)
  for (const cancellation of [stopped, revokedStop]) {
    assert.equal(final.cancellations.cancellations.find(row => row.id === cancellation.id).status, 'applied')
    assert.equal(final.cancellations.statements.filter(row => row.cancellationId === cancellation.id).length, 1)
  }
  const statement = payerFinal.cancellations.statements.find(row => row.cancellationId === stopped.id)
  assert.equal(statement.balanceCents, 12000, 'payer final statement includes only the covered agreement balance')
  assert.equal(final.balances.find(row => row.personId === member.id).balanceCents, 23089, 'participant retains their complete independent ledger')
  assert.ok(!payerFinal.cancellations.statements.some(row => row.cancellationId === revokedStop.id))
  assert.equal(final.recurring.invoices.filter(row => [coveredTerms.id, revokedStop.termsId].includes(row.recurringTermsId)).length, 0)
  const finalPage = await h.send('/app/packs', undefined, payer.cookie)
  assert.equal(finalPage.status, 200)
  assert.ok(!finalPage.text.includes('67.89') && !finalPage.text.includes('230.89'))
  assert.ok(!JSON.stringify(payerFinal.notices).includes('23089'), 'cancellation notices do not disclose the participant studio balance')
  await payerRevocationCases(h)
  return {member, payer, guardian, child, otherChild, grant, childGrant, stopped, guardianStopped, statement}
}

/** The owner records a named party's request; studio initiative is refused without writes. */
export async function payerRevocationCases(h) {
  let sequence=3500
  const key=()=>`synthetic-strap-${sequence++}`
  for(const requester of ['participant','payer']){
    const member=await h.person(key()),payer=await h.person(key()),stranger=await h.person(key())
    const pack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:6,amountCents:12000,expiresAt:iso(Date.now()+90*day)})).id})
    const preview=await h.cmd('plan.recurring.prepare',{packId:pack.id,intervalMonths:1,requestId:key()})
    await h.cmd('plan.recurring.accept',{id:preview.id,key:preview.key},member.cookie)
    const grant=await h.cmd('contract.authority.save',{personId:member.id,delegateId:payer.id,kind:'payer',evidenceReference:key()})
    await h.cmd('contract.authority.accept',{id:grant.id},member.cookie);await h.cmd('contract.authority.accept',{id:grant.id},payer.cookie)
    const stopped=await h.cmd('plan.cancellation.stop',{packId:pack.id,requestId:key()},payer.cookie)
    const facts={id:grant.id,reason:'Recorded request to revoke cancellation authority',requestId:key()}
    for(const extra of [{},{requestedByPersonId:stranger.id,requestEvidenceReference:key()},{requestedByPersonId:member.id}]){
      const before=(await h.state()).version
      await h.cmd('contract.authority.revoke',{...facts,...extra},h.owner,400)
      assert.equal((await h.state()).version,before,'studio initiative, an unrelated requester or missing request evidence cannot revoke or write')
    }
    const requestedByPersonId=requester==='participant'?member.id:payer.id,requestEvidenceReference=key()
    const input={...facts,requestedByPersonId,requestEvidenceReference,channel:'phone'}
    const revoked=await h.cmd('contract.authority.revoke',input)
    assert.equal(revoked.revocationRequestedByPersonId,requestedByPersonId)
    assert.equal(revoked.revocationRequestEvidenceReference,requestEvidenceReference)
    assert.ok(revoked.revokedAt)
    assert.deepEqual(await h.cmd('contract.authority.revoke',input),revoked,'the recorded staff request replays once')
    const state=await h.state(),audit=state.staffActions.filter(a=>a.command==='contract.authority.revoke'&&a.after.id===grant.id)
    assert.equal(audit.length,1);assert.equal(audit[0].channel,'phone')
    assert.equal(audit[0].after.revocationRequestedByPersonId,requestedByPersonId)
    assert.equal(audit[0].after.revocationRequestEvidenceReference,requestEvidenceReference)
    assert.equal(state.cancellations.cancellations.find(c=>c.id===stopped.id).status,'scheduled')
    const before=state.version
    await h.cmd('plan.cancellation.withdraw.prepare',{id:stopped.id,requestId:key()},payer.cookie,404)
    assert.equal((await h.state()).version,before)
  }
}

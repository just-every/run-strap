import assert from 'node:assert/strict'
import { run } from './harness.mjs'
import { billingSeed, acceptance } from './billing-sandbox.mjs'
import { paymentAuth } from './payment-fixtures.mjs'
import { diagnosticStore } from './recovery-diagnostics-cases.mjs'

// Every export and download door the studio serves today, each tried by every role.
export async function exportRightsCases() {
  await run(async h => {
    await h.cmd('studio.save', {location: 'Export studio', timeZone: 'America/New_York'})
    const seed = await billingSeed(h, 'ExportMember'), member = seed.member, outsider = seed.outsider
    const outsiderDraft = await h.cmd('pack.prepare', {personId: outsider.id, credits: 2, amountCents: 3000, locationId: 'studio', expiresAt: new Date(Date.now() + 30 * 86400000).toISOString()})
    await h.cmd('pack.approve', {id: outsiderDraft.id})
    const agreement = await h.cmd('billing.agreement.prepare', seed.prepare)
    await h.cmd('billing.agreement.accept', acceptance(agreement, member.name), member.cookie)
    const policy = await h.cmd('waiver.publish', {text: 'synthetic-strap-930 exact studio policy.', requiresSignature: true, service: 'Export evidence'})
    const receipt = await h.cmd('waiver.acknowledge', {id: policy.id, documentHash: policy.documentHash, signerName: member.name, confirm: true}, member.cookie)
    const reminder = await h.cmd('reminder.prepare', {personId: member.id})
    await h.cmd('reminder.approve', {id: reminder.id})
    const privacy = await h.cmd('privacy.request', {personId: member.id, type: 'access', channel: 'desk', requestId: 'synthetic-strap-931'})
    await h.cmd('privacy.verify', {id: privacy.id, confirm: true, method: 'in-person-document'})

    const instructor = await h.person('ExportTeacher', 'instructor')
    const [finance, manager, desk, recordsManager] = [await h.person('ExportFinance'), await h.person('ExportManager'), await h.person('ExportDesk'), await h.person('ExportRecords')]
    const grant = (p, role, rights, enabled = true) => h.cmd('staff.access.grant', {personId: p.id, role, enabled, rights: Object.fromEntries(rights.map(right => [right, {enabled: true, scopes: [{memberIds: [member.id], locationIds: ['studio'], doors: ['all']}]}]))})
    await grant(finance, 'finance', ['exports']); await grant(manager, 'manager', ['exports'])
    await grant(desk, 'front-desk', ['member-record', 'exports']); await grant(recordsManager, 'manager', ['member-record'])
    for (const p of [finance, manager, desk, recordsManager]) await h.enroll(p.cookie)
    const agent = await h.cmd('agent.create', {label: 'Export preparation'})
    const form = await h.mf.dispatchFetch(h.origin + '/app/action?name=integration.create&returnTo=%2Fapp%2Fintegrations', {method: 'POST', headers: {origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({label: 'Export reader', 'sc_roster:read': 'true', location: 'studio'}).toString()})
    const integration = (await form.text()).match(/<p class="token">(strap_int_[0-9a-f]{64})<\/p>/)[1]
    const unchecked = await h.signIn(h.auth.OWNER_EMAIL)

    const doors = {
      exit: '/api/strap/exit.json', staffHistory: '/api/strap/staff-history.csv',
      revenueCsv: '/api/strap/reports/revenue.csv', revenueXlsx: '/api/strap/reports/revenue.xlsx',
      attendanceCsv: '/api/strap/reports/attendance.csv', attendanceXlsx: '/api/strap/reports/attendance.xlsx',
      retentionCsv: '/api/strap/reports/retention.csv', retentionXlsx: '/api/strap/reports/retention.xlsx',
      renewalsCsv: '/api/strap/reports/renewals.csv', renewalsXlsx: '/api/strap/reports/renewals.xlsx',
      financeCsv: '/api/strap/reports/finance.csv', financeXlsx: '/api/strap/reports/finance.xlsx',
      teachingPayCsv: '/api/strap/teaching-pay.csv', teachingPayXlsx: '/api/strap/teaching-pay.xlsx',
      cancellationsCsv: '/api/strap/cancellations.csv', cancellationsXlsx: '/api/strap/cancellations.xlsx',
      taxFiling: '/api/strap/tax/filing.csv', timeClock: '/api/strap/time-clock.csv', tenders: '/api/strap/retail/day.csv?date=2099-01-05',
      reminder: `/api/strap/reminders/${reminder.id}.txt`,
      preferences: `/api/strap/preferences.json?personId=${member.id}`, outsiderPreferences: `/api/strap/preferences.json?personId=${outsider.id}`,
      waiverJson: `/api/strap/waiver-evidence.json?id=${receipt.id}`, waiverHtml: `/api/strap/waiver-evidence.html?id=${receipt.id}`,
      agreementJson: `/api/strap/billing/agreement.json?id=${agreement.id}`, agreementHtml: `/api/strap/billing/agreement.html?id=${agreement.id}`,
    }
    const privacyExport = cookie => h.send('/api/strap/command', {name: 'privacy.export', input: {id: privacy.id}}, cookie)
    // Explicit rights decide every served set; everything else is refused.
    const served = {
      owner: Object.keys(doors),
      finance: ['revenueCsv', 'revenueXlsx'],
      manager: ['revenueCsv', 'revenueXlsx', 'attendanceCsv', 'attendanceXlsx'],
      desk: ['preferences'], recordsManager: ['preferences'], instructor: [],
      member: ['preferences', 'waiverJson', 'waiverHtml', 'agreementJson', 'agreementHtml'], outsider: ['outsiderPreferences'],
    }
    const cookies = {owner: h.owner, finance: finance.cookie, manager: manager.cookie, desk: desk.cookie, recordsManager: recordsManager.cookie, instructor: instructor.cookie, member: member.cookie, outsider: outsider.cookie}
    const downloads = {}
    for (const [role, names] of Object.entries(served)) for (const name of names) {
      const r = await h.send(doors[name], undefined, cookies[role])
      assert.equal(r.status, 200, `${role} ${name}: ${r.text.slice(0, 200)}`)
      if (!['preferences', 'outsiderPreferences'].includes(name) || role === 'owner') assert.match(r.headers.get('content-disposition') ?? '', /^attachment/, `${role} ${name} is a download`)
      downloads[role + ':' + name] = r.text
    }
    // The owner's exports hold both members; a scoped grant releases only its member.
    for (const name of ['revenueCsv', 'exit']) assert.ok(downloads['owner:' + name].includes(outsider.id) && downloads['owner:' + name].includes(member.id), 'owner ' + name + ' covers both members')
    for (const role of ['finance', 'manager']) { assert.ok(downloads[role + ':revenueCsv'].includes(member.id), role + ' download holds the granted member'); assert.ok(!downloads[role + ':revenueCsv'].includes(outsider.id), role + ' download omits the ungranted member') }
    assert.equal((await privacyExport(h.owner)).status, 200, 'the owner downloads a verified access request')

    const before = await diagnosticStore(h)
    for (const [role, names] of Object.entries(served)) for (const name of Object.keys(doors).filter(n => !names.includes(n))) {
      const r = await h.send(doors[name], undefined, cookies[role])
      assert.ok([403, 404].includes(r.status), `${role} refused ${name}: ${r.status} ${r.text.slice(0, 120)}`)
      assert.ok(!r.headers.get('content-disposition'), `${role} receives no ${name} file`)
    }
    for (const role of Object.keys(served).filter(r => r !== 'owner')) assert.equal((await privacyExport(cookies[role])).status, 403, role + ' cannot export a privacy request')
    assert.equal((await h.send(doors.revenueCsv, undefined, recordsManager.cookie)).value.error, 'staff_right_required', 'a member-record grant is not an export right')
    assert.equal((await h.send(doors.revenueCsv, undefined, desk.cookie)).value.error, 'owner_required', 'front desk never downloads studio reports')
    for (const name of Object.keys(doors)) {
      const held = await h.send(doors[name], undefined, unchecked)
      assert.equal(held.status, 403, name); assert.equal(held.value.error, 'mfa_required', 'an owner session without its factor is held at ' + name)
      for (const token of [agent.token, integration]) assert.equal((await h.send(doors[name], undefined, '', {authorization: 'Bearer ' + token})).status, 401, 'credentials never export ' + name)
    }
    assert.equal((await privacyExport(unchecked)).value.error, 'mfa_required')
    assert.deepEqual(await diagnosticStore(h), before, 'refused exports write nothing')
    // Disabling a grant ends its exports at once, for the session already open.
    await grant(finance, 'finance', [], false)
    const revokedBefore = await diagnosticStore(h), revoked = await h.send(doors.revenueCsv, undefined, finance.cookie)
    assert.equal(revoked.status, 403); assert.ok(!revoked.text.includes(member.id))
    assert.deepEqual(await diagnosticStore(h), revokedBefore, 'a revoked export writes nothing')
    console.log(`PROBE SEC-001 exports: ${Object.keys(doors).length + 1} export doors x 8 sessions and 2 credentials -> owner all, finance revenue only, manager revenue and attendance only, scoped to the granted member; others, unchecked owner, bearer keys and a revoked grant refused with unchanged database`)
  }, {auth: paymentAuth})
}

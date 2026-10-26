import { body, field, form, h, hidden, panel, person, rows } from './shared'
import { waiverSigned } from './facts'
import { when } from './format'

/** Service documents reuse the ordinary personal signing door. */
export function serviceDocuments(s: any, personId: string, back: string, guardian=false) {
  return rows(s,'waivers').filter(w=>w.service).map(w=>panel(`${w.service} policy`,body(
    `<p>Version ${h(w.version)}${w.validDays ? ` · completion valid for ${w.validDays} days` : ''}</p><p class="letter">${h(w.text)}</p>`
    + (waiverSigned({...s,waiver:w},personId) ? '<p>Current document completed.</p>' : form('waiver.acknowledge',back,
      hidden('id',w.id)+(guardian?hidden('participantId',personId):'')+hidden('documentHash',w.documentHash)
      + field('signerName','Your full name',person(s,s.actor.personId),'text','required maxlength="160"')
      + `<label class="check"><input type="checkbox" name="confirm" value="yes" required>${guardian?'I personally affirm this document as the recorded guardian. This does not authorize a payment.':'I personally affirm this exact document. This does not authorize a payment.'}</label>`,guardian?`Sign ${w.service} policy for ${person(s,personId)}`:`Sign ${w.service} policy`))
    + rows(s,'acknowledgements').filter(a=>a.personId===personId && a.waiverId===w.id && a.validUntil).map(a=>`<p>Completion expires ${when(s,a.validUntil)}.</p>`).join('')),{id:'policy-'+w.id})).join('')
}

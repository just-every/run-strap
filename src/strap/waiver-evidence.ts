import { guardianOf } from './domain/households';
import { insist, record, type Actor, type RecordData, type State } from './domain/types';

/** Shared data assembly only: callers must independently authorize their read. */
export function assembleWaiverEvidence(receipt: RecordData, document: RecordData) {
  return {format:'strap-waiver-evidence-v1',document:{id:document.id,version:document.version,text:document.text,sha256:document.documentHash ?? null,...(document.service ? {service:document.service} : {}),...(document.validDays ? {validDays:document.validDays} : {})},
    receipt:{id:receipt.id,personId:receipt.personId,actorId:receipt.actorId,at:receipt.createdAt,...(receipt.validUntil ? {validUntil:receipt.validUntil} : {}),signature:receipt.signature ?? null},
    meaning:receipt.signature ? receipt.signature.meaning : 'Receipt of an exact waiver version; not a signature or payment authorization.'};
}

/** Evidence stays private to the participant, a currently authorized guardian and the human owner. */
export function waiverEvidence(state: State, who: Actor, receiptId: unknown) {
  const receipt = record(state,receiptId,'acknowledgement');
  insist(who.role === 'owner' && who.isOwner || who.role === 'member' && (who.personId === receipt.personId || guardianOf(state,who.personId,receipt.personId)),'evidence_not_found',404);
  return assembleWaiverEvidence(receipt,record(state,receipt.waiverId,'waiver'));
}

const escapeHtml=(value: unknown)=>String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const details=(values: [string, unknown][])=>'<dl>'+values.filter(([,value])=>value!==undefined && value!==null).map(([label,value])=>`<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('')+'</dl>';
const structured=(value: unknown)=>`<pre>${escapeHtml(JSON.stringify(value,null,2))}</pre>`;

/** A standalone, inert copy of the authorized evidence, without external assets. */
export function renderWaiverCopy(evidence: ReturnType<typeof assembleWaiverEvidence>): string {
  const {document,receipt,meaning}=evidence,signature=receipt.signature;
  const title=signature ? 'Typed affirmation copy' : 'Waiver version receipt';
  return `<!doctype html>
<html lang="en-US"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${title}</title><style>body{margin:0 auto;padding:32px 20px;max-width:820px;color:#17202a;background:#fff;font:16px/1.6 system-ui,sans-serif}h1,h2{line-height:1.25}h2{margin-top:32px}dl{display:grid;grid-template-columns:minmax(130px,1fr) minmax(0,3fr);gap:8px 20px}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}.document,pre{white-space:pre-wrap;overflow-wrap:anywhere}pre{font:14px/1.6 ui-monospace,monospace}aside{padding:16px;background:#f3f5f6}@media(max-width:480px){dl{display:block}dd{margin:0 0 12px}}@media print{body{max-width:none;padding:0}h2{break-after:avoid}aside{background:none}}</style></head><body>
<main><h1>${title}</h1><aside>${escapeHtml(meaning)}</aside>
<h2>Exact document</h2>${details([['Document ID',document.id],['Version',document.version],['SHA-256',document.sha256],['Service',document.service],['Completion validity in days',document.validDays]])}<div class="document">${escapeHtml(document.text)}</div>
<h2>Completion</h2>${details([['Receipt ID',receipt.id],['Participant',signature?.participantName],['Participant ID',receipt.personId],['Completing actor ID',receipt.actorId],['Completed at',receipt.at],['Valid until',receipt.validUntil],['Method',signature?.method],['Signer',signature?.signerName],['Signer person ID',signature?.signerPersonId],['Signer email',signature?.signerEmail],['Explicit confirmation',signature?.confirmed],['Authentication channel',signature?.channel],['Device ID',signature?.deviceId],['Launching staff actor ID',signature?.launchedBy]])}
${signature ? `<h2>Declaration affirmed</h2><div class="document">${escapeHtml(signature.affirmationText)}</div><h2>Recorded signing authority</h2>${structured(signature.authority)}<h2>Recorded device context</h2>${structured(signature.deviceContext)}` : ''}
<h2>Complete retained evidence</h2>${structured(evidence)}</main></body></html>\n`;
}

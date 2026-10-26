import type { Transaction } from './domain/store';
import { latestWaiver, currentWaiver, currentWaiverReceipt } from './domain/bookings';
import { requireSigningLaunch } from './domain/signing-access';
import { id, insist, list, now, person, text, type RecordData } from './domain/types';
import { locationById } from './domain/locations';

export async function launchSigningTablet(tx: Transaction,input: Record<string,unknown>) {
  const locationId=locationById(tx.state,input.locationId??'studio').id;
  requireSigningLaunch(tx.state,tx.who,input.personId,locationId);
  const member=person(tx.state,input.personId),waiver=currentWaiver(tx.state,input.waiverId);
  insist(member.role === 'member','member_required');
  insist(waiver?.requiresSignature && input.waiverId === waiver.id,'signable_current_document_required',409);
  insist(!currentWaiverReceipt(tx.state,member.id,waiver),'already_acknowledged',409);
  text(input.requestId,'requestId',100);
  const secret=[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret)))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const launch={id:id(),personId:member.id,waiverId:waiver.id,documentHash:waiver.documentHash,locationId,staffGrantRevision:tx.who.role==='front-desk'?tx.state.records.get('signing-checkin-grant:'+tx.who.personId)?.data.revision:null,status:'issued',actorId:tx.who.id,actorRole:tx.who.role,staffPersonId:tx.who.personId??null,at:now(),expiresAt:new Date(Date.now()+15*60000).toISOString()};
  tx.put('waiverTabletLaunch',launch);
  tx.sql.push(tx.statement('INSERT INTO st_intake_tablets(id,token_hash,expires_at) VALUES(?,?,?)',launch.id,hash,launch.expiresAt));
  return {...launch,url:'/intake/tablet/start?token='+secret};
}
/** The dedicated tablet captures only its named person's affirmation; never staff credentials. */
export function requireTabletSigningAuthority(tx: Transaction,launch: RecordData) {
  requireSigningLaunch(tx.state,{id:launch.actorId,role:launch.actorRole,isOwner:launch.actorRole==='owner',personId:launch.staffPersonId,email:''},launch.personId,launch.locationId);
  if(launch.actorRole==='front-desk')insist(tx.state.records.get('signing-checkin-grant:'+launch.staffPersonId)?.data.revision===launch.staffGrantRevision,'checkin_right_changed',403);
}
export function completeTabletSignature(tx: Transaction,launch: RecordData,input: Record<string,unknown>) {
  const member=person(tx.state,launch.personId),waiver=currentWaiver(tx.state,launch.waiverId);
  requireTabletSigningAuthority(tx,launch);
  insist(waiver && waiver.id===launch.waiverId && waiver.documentHash===launch.documentHash,'document_changed',409);
  insist(!currentWaiverReceipt(tx.state,member.id,waiver),'already_acknowledged',409);
  insist(input.confirm==='yes' && text(input.signerName,'signerName',160)===member.name,'member_confirmation_required');
  const receipt={id:id(),personId:member.id,waiverId:waiver.id,createdAt:now(),validUntil:waiver.validDays ? new Date(Date.now()+waiver.validDays*86400000).toISOString() : null,actorId:'tablet:'+launch.id,
    signature:{method:'typed-affirmation',documentHash:waiver.documentHash,documentText:waiver.text,documentVersion:waiver.version,signerPersonId:member.id,signerName:member.name,participantName:member.name,confirmed:true,channel:'desk-tablet',authority:{kind:'self'},deviceId:launch.id,deviceContext:{kind:'self-affirmed-tablet',launchId:launch.id},affirmationText:`I am ${member.name} and personally affirm this exact document.`,launchedBy:launch.actorId,
      meaning:'Personal affirmation of this exact document on a staff-launched tablet; identity and legal enforceability are not independently verified. No payment authorization.'}};
  tx.put('acknowledgement',receipt);return receipt;
}

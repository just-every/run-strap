import type { Bindings } from '../auth.server';
import { load } from './domain/store';
import { DomainError, type Actor } from './domain/types';
import { widgetAdult, widgetSelection } from './domain/booking-widget';

const name='strap_class_return';
const bytes=(value: string)=>new TextEncoder().encode(value);
const hex=(value: ArrayBuffer)=>[...new Uint8Array(value)].map(n=>n.toString(16).padStart(2,'0')).join('');
const key=(env: Bindings)=>crypto.subtle.importKey('raw',bytes(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
const message=(who: Actor,token: string)=>bytes(JSON.stringify([who.id,who.sessionId,token]));

/** A session-bound pointer survives the hosted provider return; it grants no authority. */
export async function widgetReturnCookie(env: Bindings,who: Actor,token: string,expiresAt: string) {
  const signature=hex(await crypto.subtle.sign('HMAC',await key(env),message(who,token)));
  return `${name}=${token}.${signature}; Path=/app; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0,Math.floor((Date.parse(expiresAt)-Date.now())/1000))}${env.AUTH_ORIGIN.startsWith('https:')?'; Secure':''}`;
}
export async function widgetReturn(request: Request,env: Bindings,who: Actor) {
  if(who.role!=='member')return null;
  const value=(request.headers.get('cookie')??'').split(';').map(c=>c.trim()).find(c=>c.startsWith(name+'='))?.slice(name.length+1);
  if(!value || !/^[0-9a-f]{64}\.[0-9a-f]{64}$/.test(value))return null;
  const [token,signature]=value.split('.'),signed=Uint8Array.from(signature.match(/../g)!,s=>parseInt(s,16));
  if(!await crypto.subtle.verify('HMAC',await key(env),signed,message(who,token)))return null;
  try {
    const loaded=await load(env.DB,who);widgetAdult(loaded.state,who.personId!);
    const selected=await widgetSelection(env.DB,loaded.state,token);
    return {url:'/app/widget?selection='+token,title:selected.entry.title};
  } catch(error) {
    if(error instanceof DomainError && [403,404,409,410].includes(error.status))return null;
    throw error;
  }
}

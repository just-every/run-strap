import { addDays, localDate } from '../zone';
import { studioDayInstant } from './freeze-calendar';
import { studioSettings } from './studio';
import { studioZone } from './pack-credits';
import { insist, instant, integer, type State } from './types';
import { applicableCoolingRules, coolingRules, federalHolidaySource, ownerCoolingRule, type CoolingDayKind, type CoolingRule, type CoolingSource } from './cooling-rules';

export interface CoolingHours {day:number; opens:string; closes:string}
export interface CoolingRenewal {at:string; intervalMonths:number; invoiceId?:string}
export interface CoolingOptions {
  acceptedAt:string;
  /** Absence means no cutoff for the initial contract. */
  deliveredAt?:string|null;
  studioRegion?:string|null;
  memberRegion?:string|null;
  /** Total contract obligation in cents, including initiation/initial membership fees. */
  amountCents?:number|null;
  days?:number;
  acceptanceChannel?:string|null;
  studioOpenedOn?:string|null;
  renewal?:CoolingRenewal;
}
export interface CoolingCalendarOptions extends CoolingOptions {
  zone:string;
  /** Undefined retains the product's unconfigured Monday-Friday schedule. [] means no open days. */
  businessHours?:readonly CoolingHours[];
}
export interface CalculatedCoolingRule extends CoolingRule {deadline:string|null; calendarDeadline?:string|null}
export interface CoolingWindow {
  opensAt:string;
  /** Exclusive midnight boundary: a request strictly before this instant is timely. */
  deadline:string|null;
  governingRule:CalculatedCoolingRule|null;
  rules:CalculatedCoolingRule[];
  sources:CoolingSource[];
  renewal:CoolingRenewal|null;
  unverified:boolean;
}
const nth=(year:number,month:number,weekday:number,n:number)=>{
  const first=new Date(Date.UTC(year,month-1,1));
  return new Date(Date.UTC(year,month-1,1+(weekday-first.getUTCDay()+7)%7+(n-1)*7)).toISOString().slice(0,10);
};
/** Includes adjacent-year observations (e.g. New Year's Day observed December 31). */
export function federalHolidays(year:number):Set<string>{
  const dates=new Set<string>();
  for(const y of [year-1,year,year+1]){
    for(const [month,day] of [[1,1],[6,19],[7,4],[11,11],[12,25]]){
      const at=new Date(Date.UTC(y,month-1,day)),actual=at.toISOString().slice(0,10);dates.add(actual);
      if(at.getUTCDay()===6)dates.add(addDays(actual,-1));
      if(at.getUTCDay()===0)dates.add(addDays(actual,1));
    }
    for(const [month,weekday,n] of [[1,1,3],[2,1,3],[9,1,1],[10,1,2],[11,4,4]])dates.add(nth(y,month,weekday,n));
    const last=new Date(Date.UTC(y,5,0));dates.add(new Date(Date.UTC(y,4,last.getUTCDate()-(last.getUTCDay()-1+7)%7)).toISOString().slice(0,10));
  }
  return dates;
}
const weekday=(date:string)=>new Date(date+'T12:00:00Z').getUTCDay();
const minutes=(clock:string)=>Number(clock.slice(0,2))*60+Number(clock.slice(3));
function eligibleDays(kind:CoolingDayKind,hours?:readonly CoolingHours[]):Set<number>{
  const open=new Set(hours?.map(h=>h.day%7)??[1,2,3,4,5]);
  if(kind==='calendar')return new Set([0,1,2,3,4,5,6]);
  if(kind==='business')return new Set([1,2,3,4,5]);
  if(kind==='open')return open;
  if(kind==='operating-eight')return new Set((hours??[]).filter(h=>minutes(h.closes)-minutes(h.opens)>=480&&h.day%7!==0).map(h=>h.day%7));
  if(kind==='open-weekday'&&[1,2,3,4,5].some(day=>open.has(day)))return new Set([1,2,3,4,5].filter(day=>open.has(day)));
  return new Set([...open].filter(day=>day!==0));
}
/** Count strictly after the start date, ending at midnight after the last eligible day.
 * No eligible opening leaves the right open; it must never loop or invent an opening. */
export function countedDayDeadline(at:string,days:number,kind:CoolingDayKind,zone:string,businessHours?:readonly CoolingHours[]):string|null {
  integer(days,'cooling_days',1,3660);
  const eligible=eligibleDays(kind,businessHours);
  if(!eligible.size)return null;
  let date=localDate(instant(at,'cooling_start'),zone),count=0,year=0,holidays=new Set<string>();
  while(count<days){
    date=addDays(date,1);
    const nextYear=Number(date.slice(0,4));
    if(nextYear!==year){year=nextYear;holidays=federalHolidays(year);}
    if(eligible.has(weekday(date))&&(['calendar','open'].includes(kind)||!holidays.has(date)))count++;
  }
  return studioDayInstant(addDays(date,1),zone);
}
function calculateRule(rule:CoolingRule,at:string,zone:string,hours?:readonly CoolingHours[]):CalculatedCoolingRule {
  return {...rule,deadline:countedDayDeadline(at,rule.days+(rule.precedingOpenDays??0),rule.dayKind,zone,hours)};
}
const sourcesFor=(rules:readonly {source:CoolingSource}[])=>[...new Map([...rules.map(rule=>rule.source),federalHolidaySource].map(source=>[source.citation,source])).values()];
/** Pure calendar calculation; integrations supply recorded delivery and jurisdiction facts. */
export function calculateCoolingOffWindow(options:CoolingCalendarOptions):CoolingWindow {
  const acceptedAt=instant(options.acceptedAt,'accepted_at'),deliveredAt=options.deliveredAt?instant(options.deliveredAt,'contract_delivered_at'):null;
  const days=integer(options.days??5,'coolingOffDays',5,365);
  if(options.amountCents!=null)integer(options.amountCents,'contract_amount_cents',0,Number.MAX_SAFE_INTEGER);
  const renewal=options.renewal?{...options.renewal,at:instant(options.renewal.at,'renewal_at')}:null;
  const opensAt=renewal?.at??(deliveredAt&&deliveredAt>acceptedAt?deliveredAt:acceptedAt);
  const regions=[options.studioRegion,options.memberRegion].filter((region):region is string=>!!region);
  const inPersonAtOpenStudio=options.acceptanceChannel==='in-person'&&!!options.studioOpenedOn&&options.studioOpenedOn<=localDate(acceptedAt,options.zone);
  const selected=applicableCoolingRules(regions,options.amountCents,renewal??undefined,{inPersonAtOpenStudio});
  if(!renewal)selected.unshift(ownerCoolingRule(days));
  const rules=selected.map(rule=>calculateRule(rule,opensAt,options.zone,options.businessHours));
  if(!renewal&&!deliveredAt)rules.push({...ownerCoolingRule(days),id:'contract-copy-delivery',label:'No cutoff until full contract copy delivery is recorded',days:0,dayKind:'calendar',deadline:null});
  let governingRule:CalculatedCoolingRule|null=null;
  for(const rule of rules)if(!governingRule||(governingRule.deadline!==null&&(rule.deadline===null||rule.deadline>governingRule.deadline)))governingRule=rule;
  // A renewal with no shipped grant has no automatic right, rather than an endless one.
  const deadline=!renewal&&!deliveredAt?null:governingRule?governingRule.deadline:opensAt;
  return {opensAt,deadline,governingRule,rules,sources:sourcesFor(rules),renewal,unverified:rules.some(rule=>rule.source.verification==='NV')};
}
export function coolingOffWindow(state:State,options:CoolingOptions):CoolingWindow {
  const studio=studioSettings(state);
  return calculateCoolingOffWindow({...options,studioRegion:options.studioRegion===undefined?studio?.address?.region:options.studioRegion,zone:studioZone(state),businessHours:studio?.businessHours});
}
export interface RefundDeadline {settleBy:string; governingRule:CalculatedCoolingRule; rules:CalculatedCoolingRule[]; sources:CoolingSource[]}
/** The native product's ten-business-day ceiling can only be shortened by a state row. */
export function calculateRefundDeadline(at:string,zone:string,regions:readonly string[]=[]):RefundDeadline {
  const start=instant(at,'cancellation_received_at'),states=new Set(regions.map(region=>region.toUpperCase()));
  const baseline:CoolingRule={...ownerCoolingRule(10),id:'refund-default',label:'Refund due within 10 business days',days:10,dayKind:'business'};
  const selected=[baseline,...coolingRules.filter(rule=>states.has(rule.region!)&&rule.refund).map(rule=>({...rule,id:`${rule.id}-refund`,label:`${rule.source.citation}: refund within ${rule.refund!.days} ${rule.refund!.dayKind} days`,days:rule.refund!.days,dayKind:rule.refund!.dayKind,precedingOpenDays:undefined}))];
  const rules=selected.map(rule=>calculateRule(rule,start,zone));
  let governingRule=rules[0];
  for(const rule of rules)if(rule.deadline!<governingRule.deadline!)governingRule=rule;
  insist(governingRule.deadline,'refund_deadline_required');
  return {settleBy:governingRule.deadline,governingRule,rules,sources:sourcesFor(rules)};
}
export function refundSettlementWindow(state:State,at:string,regions:readonly string[]=[]):RefundDeadline {
  const studio=studioSettings(state);
  return calculateRefundDeadline(at,studioZone(state),[...(studio?.address?.region?[studio.address.region]:[]),...regions]);
}
export function refundSettleBy(state:State,at:string,regions:readonly string[]=[]):string {
  return refundSettlementWindow(state,at,regions).settleBy;
}

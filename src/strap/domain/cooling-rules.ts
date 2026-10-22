/** Shipped PLAN-007 rule rows, ct ruling 22 October 2026.
 * V = statute read, G = official guide, NV = statutory interpretation not verified.
 * A review date is not a claim that an NV row has been verified by counsel. */
export type CoolingDayKind = 'business' | 'open-weekday' | 'studio-open' | 'operating-eight' | 'open' | 'calendar';
export interface CoolingSource {
  citation: string;
  url: string;
  verification: 'V' | 'G' | 'NV';
  verifiedAt: string | null;
  reviewedAt: string;
  note?: string;
}
export interface CoolingRule {
  id: string;
  region: string | null;
  label: string;
  days: number;
  dayKind: CoolingDayKind;
  source: CoolingSource;
  refund?: {days:number; dayKind:'business'|'calendar'};
  /** IL counts three open days after the first open day. */
  precedingOpenDays?: number;
}
const reviewedAt = '2026-10-22';
const source = (citation:string,url:string,verification:CoolingSource['verification'],note?:string):CoolingSource =>
  ({citation,url,verification,verifiedAt:verification==='NV'?null:reviewedAt,reviewedAt,...(note?{note}:{})});
const ny = source('NY GBS § 624','https://www.nysenate.gov/legislation/laws/GBS/624','V');
const caGuide = 'https://www.dca.ca.gov/publications/legal_guides/w_10.shtml';
export const coolingRules: readonly CoolingRule[] = [
  {id:'NY-624',region:'NY',label:'NY: 3 business days after contract receipt',days:3,dayKind:'business',source:ny,refund:{days:10,dayKind:'business'}},
  {id:'CA-1812.85-b',region:'CA',label:'CA (b): 5 studio-open days excluding Sundays and holidays',days:5,dayKind:'studio-open',source:source('CA Civil Code § 1812.85(b)',caGuide,'G','Official DCA guide read; current statute fetch was unavailable.'),refund:{days:10,dayKind:'calendar'}},
  {id:'CA-1812.85-d',region:'CA',label:'CA (d): amount-tier window; longer of business and calendar days',days:45,dayKind:'business',source:source('CA Civil Code § 1812.85(d)',caGuide,'NV','Day kind unverified. Count both business and calendar days and retain the later cutoff. Amount includes initiation and initial membership fees.'),refund:{days:10,dayKind:'calendar'}},
  {id:'GA-10-1-393.2',region:'GA',label:'GA: 7 business days',days:7,dayKind:'business',source:source('GA O.C.G.A. § 10-1-393.2','https://consumer.georgia.gov/business-services/health-spas-fitness-centers','G','Official Attorney General guide read; statutory text remains unverified.')},
  {id:'NJ-56-8-42',region:'NJ',label:'NJ: 3 operating days of at least 8 hours',days:3,dayKind:'operating-eight',source:source('NJ § 56:8-42','https://lis.njleg.state.nj.us/nxt/gateway.dll/statutes/1/54169/54431','NV','Official legislative excerpt supports eight-hour operating days excluding Sundays and holidays; full wording still requires verification.'),refund:{days:30,dayKind:'calendar'}},
  {id:'FL-501.017',region:'FL',label:'FL: 3 days excluding weekends and holidays',days:3,dayKind:'business',source:source('FL § 501.017','https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.017.html','V'),refund:{days:30,dayKind:'calendar'}},
  {id:'TX-702.307',region:'TX',label:'TX: 3 business days',days:3,dayKind:'business',source:source('TX Occupations Code §§ 702.304, 702.307','https://statutes.capitol.texas.gov/Docs/OC/htm/OC.702.htm','G'),refund:{days:30,dayKind:'calendar'}},
  {id:'IL-645-6',region:'IL',label:'IL: 3 open days after the first open day',days:3,precedingOpenDays:1,dayKind:'open',source:source('IL 815 ILCS 645/6','https://ilga.gov/documents/legislation/ilcs/documents/081506450K6.htm','NV','Official legislative search excerpt includes a first-open-day offset. Full statutory and off-premises/pre-opening applicability remain unverified.'),refund:{days:30,dayKind:'calendar'}},
  {id:'MA-93-81',region:'MA',label:'MA: 3 business days after contract receipt',days:3,dayKind:'business',source:source('MA c.93 § 81','https://malegislature.gov/Laws/GeneralLaws/PartI/TitleXV/Chapter93/Section81','NV','Official statute read on the review date; row remains NV under the ct ruling pending verification.'),refund:{days:15,dayKind:'business'}},
];
export const federalHolidaySource = source('US federal and observed holidays','https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/','V','State-specific holidays are not yet included.');
export function ownerCoolingRule(days:number):CoolingRule {
  return {id:'owner-open-weekdays',region:null,label:`Owner policy: ${days} open weekdays (open non-Sundays when no weekday opens)`,days,dayKind:'open-weekday',source:source('Owner policy; ct ruling 22 October 2026','plans/rulings-batch7-20261022-0100.md','V')};
}
/** The owner floor applies to the initial contract, not the separate NY renewal right. */
export function applicableCoolingRules(regions:readonly string[],amountCents:number|null|undefined,renewal?:{intervalMonths:number}):CoolingRule[] {
  const states = new Set(regions.map(region=>region.toUpperCase()));
  if(renewal){
    if(!states.has('NY') || ![1,12].includes(renewal.intervalMonths))return [];
    const days=renewal.intervalMonths===12?15:3;
    return [{id:renewal.intervalMonths===12?'NY-624-annual-renewal':'NY-624-monthly-renewal',region:'NY',label:`NY: ${days} business days after ${renewal.intervalMonths===12?'annual':'monthly'} renewal`,days,dayKind:'business',source:ny,refund:{days:10,dayKind:'business'}}];
  }
  return coolingRules.filter(rule=>states.has(rule.region!)).flatMap(rule=>{
    if(rule.id!=='CA-1812.85-d')return [{...rule}];
    if(amountCents!=null && amountCents<150_000)return [];
    // Dollar gaps between the statutory whole-dollar bands use the longer band.
    const days=amountCents==null||amountCents>250_000?45:amountCents>200_000?30:20;
    return [{...rule,days,label:`CA (d): ${days} days; longer of business and calendar days${amountCents==null?' (total amount unrecorded: longest tier)':''}`}];
  });
}

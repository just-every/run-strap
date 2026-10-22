import { addDays, localDate } from '../zone';
import { studioDayInstant } from './freeze-calendar';
import { studioSettings } from './studio';
import { studioZone } from './pack-credits';
import type { State } from './types';

const nth=(year:number,month:number,weekday:number,n:number)=>{
  const first=new Date(Date.UTC(year,month-1,1));
  return new Date(Date.UTC(year,month-1,1+(weekday-first.getUTCDay()+7)%7+(n-1)*7)).toISOString().slice(0,10);
};
function holidays(year:number){
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
/** A protective product window, not a universal jurisdiction determination.
 * Configured studio closed days, weekends and US federal holidays do not count.
 * A studio with no configured weekday opening has no automatic cutoff. */
export function coolingOffDeadline(state:State,acceptedAt:string,businessDays:number){
  const hours=studioSettings(state)?.businessHours;
  const open=Array.isArray(hours)&&hours.length?new Set(hours.map((h:any)=>h.day)):new Set([1,2,3,4,5]);
  if(![1,2,3,4,5].some(day=>open.has(day)))return null;
  let date=localDate(acceptedAt,studioZone(state)),count=0;
  while(count<businessDays){
    date=addDays(date,1);const weekday=new Date(date+'T12:00:00Z').getUTCDay();
    if(weekday>=1&&weekday<=5&&open.has(weekday)&&!holidays(Number(date.slice(0,4))).has(date))count++;
  }
  return studioDayInstant(addDays(date,1),studioZone(state));
}

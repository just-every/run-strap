import { body, field, form, h, hidden, panel, select, textarea } from './shared';
import { actionChannel } from './booking-rules';
const toggle=(key:string,label:string,value:boolean)=>select(key,label,[['false','No'],['true','Yes']],String(value));
export function preferencesPanel(s:any,personId:string,back:string,staff=false) {
  const record=staff?s.memberRecords?.find((r:any)=>r.personId===personId)?.preferences?.[0]:s.memberPreferences?.preference;
  const p=record ?? {revision:0,marketing:{email:'denied',sms:'denied',inApp:'denied'},contactChannels:{email:true,sms:false,inApp:true},preferredTimes:'',preferredClasses:'',accessibility:'',attendanceSharing:true,feedback:false,timeZone:'America/New_York',quietStart:'20:00',quietEnd:'10:00'};
  const content='<p>Marketing starts off for each channel. A stated SMS opt-in remains pending until your own signed SMS reply confirms it. A booking never gives marketing permission.</p>'
    + '<p>Quiet hours always include 8 pm–10 am on your chosen local clock. Sign-in, security, receipts, failed-payment and required legal notices follow their existing rules. This preference does not authorize provider delivery.</p>'
    + `<p>Recorded marketing: email ${h(p.marketing.email)} · SMS ${h(p.marketing.sms)} · in-app ${h(p.marketing.inApp)}.</p>`
    + form(staff?'preferences.save.staff':'preferences.save',back,hidden('personId',personId)+hidden('revision',p.revision)+hidden('requestId',crypto.randomUUID())+(staff?actionChannel():'')
      + (!staff?toggle('bookingEmail','Booking confirmation and reminder email',!s.memberPreferences?.bookingEmail?.optedOut):'')
      + toggle('marketingEmail','Email marketing permission',p.marketing.email==='confirmed')+toggle('marketingSms','SMS marketing permission (member reply required)',p.marketing.sms!=='denied')+toggle('marketingInApp','In-app marketing permission',p.marketing.inApp==='confirmed')
      + field('consentStatement','Consent statement for any marketing opt-in','','text','maxlength="500"')+(staff?field('sourceReference','Source of the member’s stated permission','','text','maxlength="200"'):'')
      + toggle('contactEmail','Prefer contact by email',p.contactChannels.email)+toggle('contactSms','Prefer contact by SMS',p.contactChannels.sms)
      + field('preferredTimes','Preferred class times',p.preferredTimes,'text','maxlength="500"')+field('preferredClasses','Preferred classes',p.preferredClasses,'text','maxlength="500"')
      + (!staff?textarea('accessibility','Accessibility requests (member and owner only)',p.accessibility,'maxlength="2000"')+toggle('feedback','Separate feedback-request permission',p.feedback):s.actor.role === 'owner'?textarea('accessibility','Accessibility requests (member and owner only)',p.accessibility,'maxlength="2000"'):'')
      + toggle('attendanceSharing','Share my rows with studio integration keys',p.attendanceSharing)
      + field('timeZone','My local time zone',p.timeZone,'text','required')+field('quietStart','Quiet hours start',p.quietStart,'time','required')+field('quietEnd','Quiet hours end',p.quietEnd,'time','required'),'Save preference record')
    + `<p><a href="/api/strap/preferences.json${staff?'?personId='+encodeURIComponent(personId):''}">Export preference record</a></p>`;
  return staff?`<details class="more"><summary>Channel preferences and privacy</summary>${body(content)}</details>`:panel('Channel preferences and privacy',body(content),{id:'preferences'});
}

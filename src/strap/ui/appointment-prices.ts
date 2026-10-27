import { body, field, form, h, panel, rows, select } from './shared';
import { money } from './format';

export function appointmentPricesPanel(s: any) {
  const prices=rows(s,'appointmentPrices');
  return panel('Private appointment prices',body('<p>Publish a fixed price for one service at one location. Staff need the separate sale right to reserve visits at that price. Replacing a price requires a fresh reservation review and leaves existing bookings at their original amount.</p>'
    + (prices.length ? '<ul>'+prices.map(p=>'<li>'+h(p.service)+' · '+h(rows(s,'locations').find(l=>l.id===p.locationId)?.name ?? p.locationId)+' · '+money(p.amountCents)+'</li>').join('')+'</ul>' : '')
    +form('appointment.price.save','/app/studio',field('service','Private service','','text','required maxlength="160"')+select('locationId','Price location',rows(s,'locations').map(l=>[l.id,l.name]))+field('amount','Price per visit','','text','required inputmode="decimal"'),'Publish appointment price')),{id:'appointment-prices',icon:'card'});
}

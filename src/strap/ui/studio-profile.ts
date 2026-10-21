import { field, h, hidden, textarea } from './shared'

export function studioProfileFields(studio: any = {}) {
  const address = studio.address ?? {}, hours = studio.businessHours ?? []
  return hidden('profile','true')
    + field('legalName','Legal studio name',studio.legalName ?? '', 'text','maxlength="160" autocomplete="organization"')
    + '<fieldset><legend>US studio address</legend>'
    + field('line1','Street address',address.line1 ?? '','text','maxlength="160" autocomplete="address-line1"')
    + field('line2','Suite or unit',address.line2 ?? '','text','maxlength="160" autocomplete="address-line2"')
    + `<div class="row2">${field('city','City',address.city ?? '','text','maxlength="100" autocomplete="address-level2"')}${field('region','State or territory code',address.region ?? '','text','maxlength="2" autocomplete="address-level1"')}</div>`
    + field('postalCode','ZIP code',address.postalCode ?? '','text','pattern="[0-9]{5}(-[0-9]{4})?" maxlength="10" autocomplete="postal-code"')
    + '<p>Country: United States. Leave every address field empty to remove the address.</p></fieldset>'
    + textarea('receiptDetails','Receipt details',studio.receiptDetails ?? '','maxlength="1000" rows="3"')
    + '<p>Saved for future invoices and receipts. This setting does not issue or send a receipt.</p>'
    + '<fieldset><legend>Weekly business hours</legend><p>Times use the studio clock. Enter an opening and closing time for each open day; leave both empty for a closed day. One same-day interval per day. These hours describe the studio; booking windows and class availability use their own rules.</p>'
    + ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map((label,i) => {
      const day = i+1, row = hours.find((item: any) => item.day === day)
      return `<div class="row2">${field(`opens_${day}`,`${label} opens`,row?.opens ?? '','time')}${field(`closes_${day}`,`${label} closes`,row?.closes ?? '','time')}</div>`
    }).join('') + `<p>Time zone: ${h(studio.timeZone ?? 'choose above')}.</p></fieldset>`
}

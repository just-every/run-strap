import { field } from './shared'

export const taxAddressFields=(prefix: string,address: any={})=>field(prefix+'Line1','Street address',address.line1,'text','required maxlength="160"')
  +field(prefix+'Line2','Address line 2',address.line2,'text','maxlength="160"')
  +`<div class="row2">${field(prefix+'City','City',address.city,'text','required maxlength="100"')}${field(prefix+'State','State',address.state,'text','required pattern="[A-Z]{2}" maxlength="2"')}</div>`
  +field(prefix+'PostalCode','ZIP code',address.postalCode,'text','required pattern="[0-9]{5}(-[0-9]{4})?" maxlength="10"')

import { body, form, panel } from './shared';

export function invoiceMailSettings(s:any) {
  const status=s.invoiceMail;if(!status)return '';
  return panel('Invoice and receipt email',body(`<p>${status.configured?(status.reviewed?'The configured mail connection is reviewed for requested invoice and receipt copies.':'Review the configured mail connection before sending requested invoice and receipt copies.'):'Configure the installation’s Base mail provider and sender before sending invoice and receipt copies.'}</p>${status.configured?form('mail.connect','/app/studio','<p>Each copy goes only to the member’s current email address on file. Reviewing a connection never resends past copies.</p>','Review receipt email'):''}`),{id:'invoice-mail',icon:'chat'});
}

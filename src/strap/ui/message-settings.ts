import { body, form, hidden, panel, select, textarea } from './shared';

export function messagePreferencePanel(s: any) {
  if (s.actor.role !== 'member') return '';
  return panel('Message preferences',body(
    '<p>You can stop booking and class confirmation emails and class reminder emails. Your notices remain available in the app.</p>'
    + '<p>Sign-in and security emails, payment receipts, failed-payment emails and required legal emails continue. Waitlist offers continue. This choice does not change marketing consent. Only you can change this choice from your signed-in member account.</p>'
    + form('mail.preference.save','/app#message-preferences',
      hidden('requestId',crypto.randomUUID())
      + select('optedOut','Booking and class emails',[
        ['false','Receive confirmations and reminders'],['true','Stop confirmations and reminders'],
      ],String(s.messagePreference?.optedOut ?? false)),
      'Save message preferences')),{id:'message-preferences'});
}

export function messageTemplatesPanel(s: any) {
  if (s.actor.role !== 'owner') return '';
  return panel('Booking and class email text',body(
    '<p>Add plain text before and after booking and class messages. Each field allows 500 characters. The class details and links are supplied by the studio records.</p>'
    + form('mail.templates.save','/app/studio',hidden('requestId',crypto.randomUUID())
      + textarea('prefix','Opening text',s.messageTemplates?.prefix ?? '','maxlength="500" rows="3"')
      + textarea('suffix','Closing text',s.messageTemplates?.suffix ?? '','maxlength="500" rows="3"'),
      'Save message text')));
}

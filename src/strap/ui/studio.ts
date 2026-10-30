import { successSettingsPanel } from './leads';
import { paymentConnectionPanel } from './payment-connection';
import { privacyRetentionPanel } from './privacy';
import { appointmentPricesPanel } from './appointment-prices';
import { taxSettingsPanel } from './tax-settings'
import { smsTestPanel } from './sms-test'
import { studioProfileFields } from './studio-profile'
import { classRemindersPanel, reminderTasksPanel } from './class-reminders'
import { messageTemplatesPanel } from './message-settings'
// Studio settings: the location name people see and the time zone every class
// time is entered and read in. Before they are set, Today asks for them first.
import { usZones, zoneName } from '../zone'
import { body, field, form, h, panel, select } from './shared'
import { rulesPanel } from './booking-rules'
import { spotsPanel } from './spots'
import { kiosksPanel } from './checkin'
import { memberMailPanel, waitlistPanel } from './waitlist'
import { locationsPanel } from './locations'

const fields = (s: any) => `<div class="row2">${field('location', 'Location name', s.studio?.location ?? '', 'text', 'required maxlength="80" autocomplete="off" placeholder="East Nashville"')}${select('timeZone', 'Time zone', [['', 'Choose the studio’s time zone'], ...usZones], s.studio?.timeZone ?? '')}</div>`

/** The first-run card on Today. */
export const studioSetup = (back: string) => `<section class="panel setup-card"><h2>Set up your studio</h2><p>Name the location and choose its time zone. Class times are entered and shown on this clock, for you, your instructors and your members.</p>${form('studio.save', back, fields({}), 'Save studio')}</section>`

export function studioPage(s: any, notice: any = {}) {
  const zone = s.studio ? `<p class="meta">Classes are entered and shown on ${h(zoneName(s.studio.timeZone))}.</p>` : ''
  return `<div class="page single"><div class="page-main"><div class="page-title"><h1>Studio</h1></div>`
    + panel('Studio settings', body(`${zone}${form('studio.save', '/app/studio', fields(s) + studioProfileFields(s.studio ?? {}), 'Save studio')}`), { icon: 'pin' })
    + locationsPanel(s)
    + appointmentPricesPanel(s)
    + successSettingsPanel(s)
    + classRemindersPanel(s)
    + reminderTasksPanel(s)
    + messageTemplatesPanel(s)
    + memberMailPanel(s)
    + smsTestPanel(s)
    + taxSettingsPanel(s)
    + paymentConnectionPanel(s)
    + privacyRetentionPanel(s)
    + rulesPanel(s)
    + waitlistPanel(s)
    + spotsPanel(s)
    + kiosksPanel(s, notice)
    + panel('Sign-in', body('<p>Choose how you and your staff sign in: email links, or your own identity provider.</p><a class="btn-quiet" href="/auth/settings/identity">Open sign-in settings</a>'), { icon: 'key' })
    + `</div></div>`
}

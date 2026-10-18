// 04 Interlude: Larkhill's brick corner at 5:40 am, Tue Oct 20 (the plate with
// its painted tag removed); the tag is set in HTML where the desk drew it.
import { html } from '../html'
import { check, icon, painting } from './parts'

export const interlude = html`<section class="interlude" aria-label="5:40 am in East Nashville: the 6:00 am Reformer Flow is full">
  ${painting('interlude', 'Larkhill\'s white brick corner studio before dawn: lit windows, a sea-glass awning, the door open as a member walks in, bikes at the rack.', { widths: [768, 1152, 1536], width: 1536, height: 1024, phone: { name: 'interlude-phone', widths: [640, 820], media: '(max-width: 760px)' } })}
  <p class="tag"><span class="tag-ico">${icon.calendar}</span><span><b>5:40 am</b> · East Nashville<br>Reformer Flow 6:00 am · 12 of 12 ${check()}</span></p>
</section>`

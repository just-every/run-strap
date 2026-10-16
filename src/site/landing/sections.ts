// The page body after the hero: five features, each a heading, one line and a
// small drawing (a white card on a piece of berry mat), then "Also included".
import { html, raw, type Markup } from '../html'

const piece = (label: string, card: Markup) => html`<figure class="piece" aria-label="${label}"><div class="piece-mat mat roll-top" aria-hidden="true"></div><div class="piece-card card">${card}</div></figure>`

const features: { id: string; heading: string; body: string; drawing: Markup }[] = [
  {
    id: 'free', heading: '100% free.', body: "Free as in code, free as in cost. MIT licensed, and your members' records stay in your own account.",
    drawing: piece('The MIT License', html`<p class="piece-title">MIT License</p><span class="lines" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>`),
  },
  {
    id: 'credits', heading: 'Credits that add up.', body: 'Approve a class pack and its credits are ready. A booking spends one; a cancellation gives it back once.',
    drawing: piece('My credits: 8 credits remaining, of 10 original credits', html`<p class="piece-title">My credits</p><p class="piece-big">8 credits remaining</p><p class="piece-foot">Original credits: 10</p>`),
  },
  {
    id: 'week', heading: 'Publish the week once.', body: "Prepare the week's classes, review them, publish. Members book, and instructors check people in.",
    drawing: piece('Published classes: Morning Flow, full, ready to check in; Reformer Basics, 6 of 8 booked', html`<p class="piece-title">Published classes</p><p class="piece-row"><span><b>Morning Flow</b><small>Capacity: 12 · Booked: 12</small></span><span class="pill solid">Check in</span></p><p class="piece-row"><span><b>Reformer Basics</b><small>Capacity: 8 · Booked: 6</small></span></p>`),
  },
  {
    id: 'balances', heading: 'See what every member owes.', body: 'Record each payment you receive with its reference. Balances update on the spot.',
    drawing: piece('Member balances: Ava Brooks has paid everything she was charged', html`<p class="piece-title">Member balances</p><p class="piece-row"><span class="initials" aria-hidden="true">AB</span><span class="piece-grow"><b>Ava Brooks</b><small>Charged: 180.00 · Paid: 180.00</small><small>Outstanding: 0.00</small></span></p>`),
  },
  {
    id: 'move-in', heading: 'Bring your members with you.', body: 'Paste your member CSV, check the preview and apply it. You can undo it later.',
    drawing: piece('Import members: checkpoint 12 of 12, completed', html`<p class="piece-title">Import members</p><p class="piece-foot piece-first">Checkpoint: 12 of 12</p><p><span class="pill solid">Completed</span></p>`),
  },
]

export const sections = features.map((f, i) => html`<section class="feature wrap${i % 2 ? ' flip' : ''}" id="${f.id}"><div class="feature-copy"><h2>${f.heading}</h2><p>${f.body}</p></div>${f.drawing}</section>`)

const icon = (paths: string) => html`<span class="tile-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${raw(paths)}</svg></span>`

const tiles: [string, string, string][] = [
  ['Waivers', 'Members acknowledge the current version before booking.', '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>'],
  ['Instructors', 'Each sees their own classes and checks people in.', '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>'],
  ['People', 'Invite by email; deactivate to end access at once.', '<circle cx="9" cy="9" r="3"/><circle cx="16.5" cy="10" r="2.5"/><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6M15 14.6c2.7-.3 4.8 1.1 5.5 3.9"/>'],
  ['Reminders', 'Prepare a balance reminder and download its exact text.', '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>'],
  ['Agents', "An assistant can prepare next week's classes for you.", '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9.5 13h.01M14.5 13h.01M10 16.5h4"/>'],
  ['Backup', 'Export the whole studio and restore it anywhere.', '<ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6"/>'],
]

export const included = html`<section class="included wrap" id="included"><h2>Also included</h2><ul class="tiles">${tiles.map(([label, line, paths]) => html`<li class="tile card">${icon(paths)}<span><b>${label}</b><span>${line}</span></span></li>`)}</ul></section>`

// Today (pick F): the day's classes as a timeline, the open class's roster, and
// the exception that needs a person: open spots the waitlist cannot fill.
import { attendance, classPlace, classRoom, classTitle, classesOn, currentClass, stuckWaitlist } from './facts'
import { clock, dayLong, dayShort, length, studioToday } from './format'
import { icon } from './icons'
import { roster } from './roster'
import { avatar, emptyState, h, iconLink, owner, person } from './shared'
import { studioSetup } from './studio'
import { deskScan } from './checkin'
import { addDays } from '../zone'

const strip = (s: any, booked: any[]) => `<ul class="strip" aria-label="Booked spots">${booked.map(b => `<li title="${h(person(s, b.personId))}">${h(person(s, b.personId).split(/\s+/).map((w: string) => w[0]).join('').slice(0, 2).toUpperCase())}</li>`).join('')}</ul>`

function exception(s: any, c: any, stuck: NonNullable<ReturnType<typeof stuckWaitlist>>) {
  const who = person(s, stuck.first.personId), spots = `${stuck.open} ${stuck.open === 1 ? 'spot is' : 'spots are'} open`
  const why = stuck.reason === 'waiver'
    ? `${spots}, but ${who}, first on the waitlist, has not signed the current waiver. Strap moves people up only once they have.`
    : `${spots}, but ${who}, first on the waitlist, has no class credit that covers this class. Strap moves people up only with a valid credit.`
  const actions = owner(s) && stuck.reason === 'credit'
    ? `<a class="btn small" href="/app/packs?person=${encodeURIComponent(stuck.first.personId)}#prepare-pack">Prepare a pack for ${h(who.split(' ')[0])}</a><a class="btn-quiet small" href="/app/people?person=${encodeURIComponent(stuck.first.personId)}#person">View member</a>`
    : owner(s) ? `<a class="btn-quiet small" href="/app/people?person=${encodeURIComponent(stuck.first.personId)}#person">View member</a>` : ''
  return `<div class="decision">${'<span class="decision-mark">' + icon('users') + '</span>'}<div class="decision-copy"><strong>The waitlist can’t fill ${h(classTitle(c))}</strong><p>${h(why)}</p></div>${actions ? `<div class="decision-actions">${actions}</div>` : ''}</div>`
}

function classCard(s: any, c: any, open: boolean, link: (id: string) => string, back: string) {
  const { booked, waiting } = attendance(s, c.id)
  const full = booked.length >= c.occupancy.total, stuck = stuckWaitlist(s, c)
  const past = Date.parse(c.end) <= Date.now()
  const room = classRoom(c)
  const spots = `<span class="pill${full ? ' full' : ''}">${booked.length} of ${c.occupancy.total}</span>`
    + (waiting.length ? `<span class="pill wait">Waitlist <b>${waiting.length}</b></span>` : `<span class="pill quiet">${c.occupancy.total - booked.length} open</span>`)
  const head = `<div class="class-head"><div class="class-time"><strong>${h(clock(s, c.start, c.timeZone))}</strong><span>${h(length(c.start, c.end))}</span></div>`
    + `<div class="class-name"><strong>${h(classTitle(c))}</strong>${room ? `<span>${h(room)}</span>` : ''}${classPlace(s, c) ? `<span>${h(classPlace(s, c))}</span>` : ''}${stuck ? `<span class="flag">${icon('alert')}Waitlist stuck</span>` : ''}${c.status === 'cancelled' ? `<span class="flag">${icon('alert')}Cancelled: ${h(c.cancelReason)}</span>` : ''}</div>`
    + `<div class="teacher">${avatar(c.instructorName ?? person(s, c.instructorId), 'plum')}<span>${h(c.instructorName ?? person(s, c.instructorId))}</span></div>`
    + `<div class="spots">${spots}</div>${iconLink(open ? link('') : link(c.id),open ? 'up' : 'chevron',open ? 'Close roster' : 'Open roster','toggle',`${open ? 'Close' : 'Open'} the roster for ${classTitle(c)} at ${clock(s,c.start,c.timeZone)}`,open ? 'aria-expanded="true"' : '')}</div>`
  const body = (stuck ? exception(s, c, stuck) : '') + (open ? roster(s, c, back) : '') + (!open && !stuck && full && c.occupancy.total <= 16 ? strip(s, booked) : '')
  return `<article class="class-card${open ? ' open' : ''}${stuck ? ' exception' : ''}${past ? ' past' : ''}" id="class-${h(c.id)}">${head}${body}</article>`
}

export function today(s: any, query: URLSearchParams, rail: string) {
  const date = /^\d{4}-\d\d-\d\d$/.test(query.get('day') ?? '') ? query.get('day')! : studioToday(s)
  const list = classesOn(s, date)
  const chosen = list.find(c => c.id === query.get('class')) ?? (query.has('class') ? undefined : currentClass(s, list))
  const base = (extra: Record<string, string>) => { const q = new URLSearchParams({ ...(date !== studioToday(s) ? { day: date } : {}), ...extra }); return `/app${q.size ? '?' + q : ''}` }
  const link = (id: string) => base(id ? { class: id } : { class: '' }) + (id ? `#class-${id}` : '')
  const back = base(chosen ? { class: chosen.id } : {})
  const totals = list.reduce((t, c) => { const a = attendance(s, c.id); return { booked: t.booked + a.booked.length, spots: t.spots + c.occupancy.total, waiting: t.waiting + a.waiting.length } }, { booked: 0, spots: 0, waiting: 0 })
  const heading = `<div class="page-title"><h1>${date === studioToday(s) ? 'Today' : h(dayShort(s, date))}</h1>${list.length ? `<p>${list.length} ${list.length === 1 ? 'class' : 'classes'} · ${totals.booked} of ${totals.spots} spots booked${totals.waiting ? ` · ${totals.waiting} waiting` : ''}</p>` : ''}</div>`
  const setup = owner(s) && !s.studio ? studioSetup('/app') : ''
  const nothing = owner(s)
    ? emptyState('calendar', `No classes on ${dayLong(date)}`, 'Prepare a class week, review it and publish it. Members can then book with their pack credits.', '<a class="btn" href="/app/classes#prepare-week">Prepare a class week</a>')
    : emptyState('calendar', `No classes on ${dayLong(date)}`, 'You are not teaching on this day.')
  const timeline = list.length ? `<div class="timeline">${list.map(c => classCard(s, c, c === chosen, link, back)).join('')}</div>` : `<section class="panel">${nothing}</section>`
  return `<div class="page${rail ? '' : ' single'}"><div class="page-main">${heading}${setup}${list.length ? deskScan(back) : ''}${timeline}</div>${rail ? `<aside class="rail" aria-label="Member success">${rail}</aside>` : ''}</div>`
}

/** The day's date for the top bar, with the previous and next day. */
export function dayNav(s: any, query: URLSearchParams) {
  const date = /^\d{4}-\d\d-\d\d$/.test(query.get('day') ?? '') ? query.get('day')! : studioToday(s)
  const to = (d: string) => d === studioToday(s) ? '/app' : `/app?day=${d}`
  return `<p class="today-date">${iconLink(to(addDays(date,-1)),'back','Previous day','day-step')}<span>${h(dayLong(date))}</span>${iconLink(to(addDays(date,1)),'chevron','Next day','day-step')}</p>`
}

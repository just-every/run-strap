// The app's line icons (from the 12ui conversion of pick F), one inline sprite per page.
const symbols: Record<string, string> = {
  today: '<rect x="3" y="5" width="18" height="16" rx="2.5" fill="currentColor" stroke="none" opacity=".16"/><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M7 2v6m10-6v6M3 10h18"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 10h18"/>',
  users: '<circle cx="10" cy="7" r="4"/><path d="M2 21v-3a6 6 0 0 1 12 0v3H2m14-18a4 4 0 0 1 0 8m2 3a6 6 0 0 1 4 6v1h-5"/>',
  card: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20M6 14h4"/>',
  chat: '<path d="M21 11a9 9 0 0 1-12 9l-6 2 2-6A9 9 0 1 1 21 11Z"/>',
  report: '<path d="M5 2h9l5 5v15H5ZM14 2v6h5M8 12h8m-8 4h5"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-4 4 3 3m-6 0 2 2"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  pencil: '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  search: '<circle cx="10" cy="10" r="7.5"/><path d="m16 16 6 6"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  scan: '<path d="M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5M7 7h3v3H7zm7 0h3v3h-3zM7 14h3v3H7zm7 0h3v3h-3z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 5v7l5 3"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  wait: '<path d="M12 7v5l3 2"/>',
  dot: '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>',
  cross: '<path d="M7 7l10 10M17 7 7 17"/>',
  alert: '<path d="m12 3 10 18H2ZM12 9v5m0 3v1"/>',
  addperson: '<circle cx="9" cy="6" r="4"/><path d="M1 21v-2a8 8 0 0 1 16 0v2ZM19 7v8m-4-4h8"/>',
  sparkles: '<path d="M13 2c0 7-3 10-9 10 6 0 9 3 9 10 0-7 3-10 9-10-6 0-9-3-9-10ZM4 2v4M2 4h4M4 16v6m-3-3h6" fill="currentColor" stroke="none"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z"/>',
}

export const sprite = `<svg class="sprite" aria-hidden="true"><defs>${Object.entries(symbols).map(([id, body]) => `<symbol id="i-${id}" viewBox="0 0 24 24">${body}</symbol>`).join('')}</defs></svg>`
export const icon = (name: keyof typeof symbols | string) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`

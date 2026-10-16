// Shared by the root renderer and the no-JavaScript first-run document.
// Edition owners can replace these self-hosted URLs with their brand assets.
// Strap preloads Urbanist (its faces are in /rer-theme.css) and links its
// shared stylesheet, which carries Strap's look into Base's frames.
export const fontLinks = [
  { rel: 'preload', href: '/fonts/urbanist/urbanist-latin-wght-normal.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
  { rel: 'stylesheet', href: '/brand/strap.css' },
] as const

export const fontHead = fontLinks.map(link => `<link ${Object.entries(link).map(([name, value]) => `${name.toLowerCase()}="${value}"`).join(' ')}>`).join('')

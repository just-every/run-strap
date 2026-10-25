// Shared by the root renderer and the no-JavaScript first-run document.
// Edition owners can replace these self-hosted URLs with their brand assets.
// Strap preloads its Latin Figtree and Playfair Display files (the faces are
// declared in /rer-theme.css), links the rest of its tokens and page rules
// (/fonts/fonts.css) and its shared components, which carry Strap's look into
// Base's frames.
export const fontLinks = [
  { rel: 'preload', href: '/fonts/figtree/figtree-latin-wght-normal.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
  { rel: 'preload', href: '/fonts/playfair-display/playfair-display-latin-wght-normal.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
  { rel: 'stylesheet', href: '/fonts/fonts.css' },
  { rel: 'stylesheet', href: '/brand/strap.css' },
] as const

export const fontHead = fontLinks.map(link => `<link ${Object.entries(link).map(([name, value]) => `${name.toLowerCase()}="${value}"`).join(' ')}>`).join('')

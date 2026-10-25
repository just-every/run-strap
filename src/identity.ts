// This edition's identity: what its installed Lobby and its run site say.
// The name and colour are the ones setup saves in src/branding.json; replace
// the purpose with the installation's own when it has one. The tagline is the
// approved hero's headline (the run site's /contract footer and not-found page);
// the Lobby's floor is the run site's entryway art.
import type { EditionIdentity } from './base/identity'
import branding from './branding.json'
import site from '../deploy-site.json'

export const identity: EditionIdentity = {
  product: branding.name,
  deployment: branding.name,
  purpose: '{deployment} keeps studio classes, pack credits, attendance and member balances.',
  tagline: 'Full classes. Members who stay.',
  signInPath: '/signin',
  // The run site `rer deploy --site` publishes (deploy-site.json).
  runSite: `https://${site.domain}`,
  // An installed instance serves the Lobby at /.
  installedHome: 'lobby',
  theme: '/rer-theme.css',
  fonts: '/fonts/fonts.css',
  mark: '/brand/mark.svg',
  band: '/site/run-floor.webp',
  accentColor: branding.primaryColor,
}

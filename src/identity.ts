// This edition's identity: what its installed Lobby and its run site say.
// The name and colour are the ones setup saves in src/branding.json; replace
// the purpose with the installation's own when it has one. The tagline is the
// approved hero's subhead; Urbanist's faces are declared in the theme.
import type { EditionIdentity } from './base/identity'
import branding from './branding.json'
import site from '../deploy-site.json'

export const identity: EditionIdentity = {
  product: branding.name,
  deployment: branding.name,
  purpose: '{deployment} keeps studio classes, pack credits, attendance and member balances.',
  tagline: 'Publish the week, give members class credits, and let the waitlist fill cancellations.',
  signInPath: '/signin',
  // The run site `rer deploy --site` publishes (deploy-site.json).
  runSite: `https://${site.domain}`,
  // An installed instance serves the Lobby at /.
  installedHome: 'lobby',
  theme: '/rer-theme.css',
  mark: '/brand/mark.svg',
  band: '/brand/band.svg',
  accentColor: branding.primaryColor,
}

// The run site's homepage (/): the approved landing, in order.
import '../styles/site.css'
import '../styles/landing.css'
import { html } from '../html'
import { siteFooter, siteHeader } from '../shell'
import { closing } from './closing'
import { hero } from './hero'
import { included, sections } from './sections'

export const landingTitle = 'Strap · Studio classes, handled.'
export const landingDescription = 'Publish the week, give members class credits, and let the waitlist fill cancellations. 100% free and open source.'
export const landing = html`${siteHeader()}<main id="main">${hero}${sections}${included}${closing}</main>${siteFooter()}`

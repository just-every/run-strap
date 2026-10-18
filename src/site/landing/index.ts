// The run site's homepage (/): two weeks at Larkhill Pilates + Yoga, Mon Oct 19
// to Thu Nov 5, with Ana Patel's comeback as the spine (desk page-s1, in order).
import '../styles/site.css'
import '../styles/cards.css'
import '../styles/devices.css'
import '../styles/plan.css'
import '../styles/landing.css'
import { html, keepTogether } from '../html'
import { siteFooter, siteHeader } from '../shell'
import { autopay } from './autopay'
import { back } from './back'
import { classes } from './classes'
import { closing } from './closing'
import { desk } from './desk'
import { hero } from './hero'
import { interlude } from './interlude'
import { intro } from './intro'
import { moving } from './moving'
import { staff } from './staff'
import { success } from './success'

export const landingTitle = 'Strap · Full classes. Members who stay.'
export const landingDescription = 'Strap sells and auto-renews memberships, fills classes through your branded app, recovers failed payments, and spots members drifting away and books them back in. 100% free and open source.'
export const landingPreload = html`<link rel="preload" as="image" type="image/avif" imagesrcset="/site/hero-phone-640.avif 640w, /site/hero-phone-820.avif 820w" imagesizes="100vw" media="(max-width: 760px)"><link rel="preload" as="image" type="image/avif" imagesrcset="/site/hero-768.avif 768w, /site/hero-1152.avif 1152w, /site/hero-1536.avif 1536w" imagesizes="100vw" media="(min-width: 761px)">`
export const landing = keepTogether(html`${siteHeader()}<main id="main">${hero}${success}${intro}${interlude}${classes}${staff}${desk}${autopay}${back}${moving}${closing}</main>${siteFooter()}`)

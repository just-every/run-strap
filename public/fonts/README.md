# Fonts

Every family is self-hosted under the SIL Open Font License 1.1, with its licence beside the files. No page makes a
third-party font request.

| Family | Use | Files | Licence | Upstream |
| --- | --- | --- | --- | --- |
| Playfair Display | page titles, panel headings and the "Strap" wordmark on the run site and in the app (heavy plum serif, weights 400–900) | `playfair-display/` (Latin, Latin Extended) | `playfair-display/LICENSE.txt` | https://github.com/clauseggers/Playfair |
| Figtree | text, cards, tables, forms and buttons on the run site, in the app, Base's frames, the Lobby and the installer (weights 300–900) | `figtree/` (Latin, Latin Extended) | `figtree/LICENSE.txt` | https://github.com/erikdkennedy/figtree |
| JetBrains Mono | the run site's terminal and code | `jetbrains-mono/` (Latin; weights 100–800) | `jetbrains-mono/LICENSE.txt` | https://github.com/JetBrains/JetBrainsMono |

The variable WOFF2 subsets come from Fontsource's distributions (`@fontsource-variable/playfair-display` 5.2.6; Figtree and
JetBrains Mono from their Fontsource packages).

`/rer-theme.css` declares the three families and every brand token once; the run site's `/site/theme.css` imports it
and sets the site's white page. Site pages preload the Latin Playfair Display and Figtree files; the app and Base's
documents preload the same two (`src/base/font-head.ts`). Every body-font stack reads `--rer-font-body`; controls inherit
it.

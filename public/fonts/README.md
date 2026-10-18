# Fonts

Every family is self-hosted under the SIL Open Font License 1.1, with its licence beside the files. No page makes a
third-party font request.

| Family | Use | Files | Licence | Upstream |
| --- | --- | --- | --- | --- |
| Playfair Display | the run site's headings and the "Strap" wordmark (heavy plum serif, weights 400–900) | `playfair-display/` (Latin, Latin Extended) | `playfair-display/LICENSE.txt` | https://github.com/clauseggers/Playfair |
| Figtree | the run site's text, cards and buttons (weights 300–900) | `figtree/` (Latin, Latin Extended) | `figtree/LICENSE.txt` | https://github.com/erikdkennedy/figtree |
| JetBrains Mono | the run site's terminal and code | `jetbrains-mono/` (Latin; weights 100–800) | `jetbrains-mono/LICENSE.txt` | https://github.com/JetBrains/JetBrainsMono |
| Urbanist | the installed app, Base's frames, the Lobby and the installer (weights 100–900) | `urbanist/` (Latin, Latin Extended) | `urbanist/LICENSE.txt` | https://github.com/coreyhu/Urbanist |

The variable WOFF2 subsets come from Fontsource's distributions (`@fontsource-variable/playfair-display` 5.2.6; Figtree,
JetBrains Mono and Urbanist from their Fontsource packages).

`/site/theme.css` declares the run site's three families, so the homepage, the docs and Base's /run, /contract and
not-found pages get them; the site pages preload only the Latin Playfair Display and Figtree files. `/rer-theme.css`
declares Urbanist for everything an installed Strap serves; its documents preload only the primary Latin file
(`src/base/font-head.ts`). Every body-font stack reads `--rer-font-body`; controls inherit it.

# Fonts

Urbanist is self-hosted under the SIL Open Font License 1.1 in
`urbanist/LICENSE.txt`. The Latin and Latin Extended variable WOFF2 subsets
(weights 100–900) come from Fontsource's Urbanist distribution; upstream:
https://github.com/coreyhu/Urbanist.

`/rer-theme.css` declares both faces, so every page that links the theme (the
app, Base's frames, the Lobby, the installer and the run site) gets them. The
documents preload only the primary Latin file (`src/base/font-head.ts`). Every
body-font stack reads `--rer-font-body`; controls inherit it.

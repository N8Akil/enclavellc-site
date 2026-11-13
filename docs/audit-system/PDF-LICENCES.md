# Audit report PDF: licences

The report PDF (`src/lib/audit/generate-pdf.ts`) is made in plain JavaScript and embeds subsets of the fonts below.

## Libraries

| Package | Version | Licence | Use | Source |
|---|---|---|---|---|
| `pdf-lib` | 1.17.1 | MIT | builds the PDF | https://github.com/Hopding/pdf-lib |
| `@pdf-lib/fontkit` | 1.1.1 | MIT | reads and subsets the TTF fonts for pdf-lib | https://github.com/Hopding/fontkit |
| `pdfjs-dist` | 6.5.438 | Apache-2.0 | **tests only** (devDependency): reads the text back out of the PDF | https://github.com/mozilla/pdf.js |

## Fonts (`src/lib/audit/fonts/`)

All three families are under the SIL Open Font License 1.1. The licence text for each sits next to the fonts
(`OFL-*.txt`). The OFL allows embedding in documents, and its terms do not apply to documents made with the fonts.

| File | Family | Copyright | Source |
|---|---|---|---|
| `BigShouldersDisplay-Black.ttf`, `BigShouldersDisplay-ExtraBold.ttf` | Big Shoulders Display | 2019 The Big Shoulders Project Authors | google/fonts `ofl/bigshouldersdisplay/BigShouldersDisplay[wght].ttf` |
| `InstrumentSans-Regular.ttf`, `InstrumentSans-SemiBold.ttf`, `InstrumentSans-Italic.ttf` | Instrument Sans | 2022 The Instrument Sans Project Authors | google/fonts `ofl/instrumentsans/InstrumentSans[wdth,wght].ttf` and `InstrumentSans-Italic[wdth,wght].ttf` |
| `IBMPlexMono-Regular.ttf`, `IBMPlexMono-Medium.ttf` | IBM Plex Mono | 2017 IBM Corp., Reserved Font Name "Plex" | google/fonts `ofl/ibmplexmono/` (static files, unmodified) |

The Big Shoulders Display and Instrument Sans files are static instances cut from the variable fonts with fontTools
`varLib.instancer` (Big Shoulders Display at wght 900 and 800; Instrument Sans at wdth 100, wght 400 and 600; the italic
at wdth 100, wght 400). pdf-lib embeds fonts as subsets and a variable font would embed its default (thinnest)
weight. These instances are derivatives under the OFL and keep its licence. Neither family has a Reserved Font Name.
IBM Plex Mono is used exactly as published, because "Plex" is a Reserved Font Name and a modified version could not
keep that name.

## Pictures (`src/lib/audit/images/`)

Enclave's own images, made by `scripts/build-audit-pdf-images.py`, each at the size it is drawn at. Nothing is fetched
while a report is made, and nothing is taken from the audited site.

| File | What | Source |
|---|---|---|
| `mark-gold.png`, `mark-ink.png`, `mark-cover.png` | the Enclave mark: gold for the dark pages' footers, ink for the paper pages, and the cover's large one in its top band | the shape (alpha) of `public/logo-icon.png`, the site's logo at 1024 px (the same shape as `public/night/logo-mark.png`, which the Night Crew nav uses) |
| `isis-office.jpg`, `osiris-office.jpg` | the two AI partners in the office, on the closing studio page, each captioned "AI partner" | the studio's social-page covers `cover-isis-office.jpg`, `cover-osiris-office.jpg`, cropped around the person |

The website itself loads the same families separately (`src/app/night/`: a self-hosted Big Shoulders woff2 and
Google-hosted Instrument Sans and IBM Plex Mono through `next/font`). The PDF does not use those files.

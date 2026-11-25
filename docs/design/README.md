# Sol y Cerveza design standards

The reference for how Sol y Cerveza looks, sounds and behaves. Use it before adding a screen, a component, a colour or a piece of copy. The live product is the source of truth for anything this document doesn't cover; if they disagree, fix one of them in the same PR.

- Palette at a glance: [`palette.svg`](palette.svg)
- Machine-readable tokens: [`tokens.json`](tokens.json) (mirrors `web/src/index.css`, `web/src/ui/categoryStyle.ts`, `web/src/map/mapStyle.ts` and `web/src/map/night.ts`)

![Sol y Cerveza palette](palette.svg)

## 1. Brand

**Idea:** the terrace that still has sun. A friendly local guide that answers one question in one glance: _where can I sit in the sun with a beer right now, and for how long?_

**Personality:** sunny, relaxed, local, precise. Warm like a Badajoz afternoon, but honest about the numbers: we show minutes of sun, not vague promises.

| We are                           | We are not                        |
| -------------------------------- | --------------------------------- |
| Warm and light-hearted           | Childish or jokey                 |
| Local (Badajoz first)            | Generic "city guide"              |
| Precise (real sun, real minutes) | Technical or data-heavy in the UI |
| Calm, map-first                  | Loud, ad-like, cluttered          |

### Name and logo

- The name is always **Sol y Cerveza**: capital S and C, lowercase "y", never abbreviated. In the repo and code it stays in Spanish; everything else in the repo is English.
- The mark is a **sun rising behind a pint** (`Logo` in `web/src/ui/icons.tsx`, `web/public/favicon.svg`):
  - sun `#FFC53D` with rays `#F5A623`, five rays from top to bottom-left;
  - glass `#FFB020` with a soft amber gradient, foam `#FFF8E7`.
- Use the mark next to the wordmark in the header (44 px). The mark alone is for favicons, app icons and avatars.
- Keep clear space of at least half the mark's width around it. Don't recolour it, add outlines, stretch it or put it on busy imagery; on dark backgrounds use it as-is (it is designed to work on both).

## 2. Voice and copy

The app speaks **Spanish (Spain)**; the repo is English.

- Talk to the user as **tú**, short and direct: "Con sol ahora", "Sol pronto", "Sin más sol hoy".
- Lead with the answer, then the detail: **"1 h 9 min de sol"** then "Hasta las 17:40".
- Times are 24 h, `HH:MM` ("17:40"); durations are "2 h 5 min", "45 min" (no seconds, no "minutos").
- Prices (when they exist) follow Spanish format: **"2,50 €"**.
- Sentence case everywhere ("Solo con terraza", not "Solo Con Terraza").
- Be honest about data: unverified things say so ("Posición sin verificar", "Terraza sin confirmar"). Never show made-up values.
- No exclamation marks in the UI (the one exception is the thank-you after sending a price or a report: "¡Gracias! …"), no emoji in product copy. Emoji are fine in social posts (one per post, ☀️ or 🍺).

**Glossary** (always these words):

| Concept                       | UI copy                                       |
| ----------------------------- | --------------------------------------------- |
| In sun now                    | Con sol ahora                                 |
| Sun within the hour           | Sol pronto                                    |
| No more sun today             | Sin sol / Sin más sol hoy                     |
| Venue without a known terrace | Terraza sin confirmar                         |
| Sun left                      | "2 h 5 min de sol"                            |
| Sun until                     | "Hasta las 17:40"                             |
| Sun coming                    | "Sol en 25 min" / "Desde las 14:57"           |
| Night                         | De noche                                      |
| Suggest a change to a venue   | Sugerir un cambio                             |
| Report a missing venue        | ¿Falta un bar? Añádelo                        |
| Report sent                   | ¡Gracias! Lo revisaremos antes de publicarlo. |

## 3. Colour

Colour carries meaning here: **yellow means sun**. Keep it for sun and for the one primary action; don't use it as decoration.

### Brand and sun

| Token       | Hex       | Use                                                                          |
| ----------- | --------- | ---------------------------------------------------------------------------- |
| `sun`       | `#F59E0B` | Sunny state, icons, gradients' deep end. **Never as text on white** (2.2:1). |
| `sun-soft`  | `#FFC53D` | Primary accents: slider fill, toggles on, selected chips, card border.       |
| `sun-dark`  | `#B45309` | Sun-coloured **text** and small icons on light backgrounds (5.0:1).          |
| `chip`      | `#FFC83D` | Selected chips and pills. Text on it is `ink` (10:1).                        |
| `highlight` | `#FFF6E0` | Soft sunny surfaces: selected list row, sun box in the map card.             |

### Sun states (map badges, legend, list icons)

Every badge is a 160° gradient, light to deep, with a 2 px white ring.

| State     | Copy                  | Solid     | Badge gradient                      | Size                                       |
| --------- | --------------------- | --------- | ----------------------------------- | ------------------------------------------ |
| `sun`     | Con sol ahora         | `#F59E0B` | `#FFC53D → #F59E0B`                 | 100 % (highlighted when zoomed out: 112 %) |
| `soon`    | Sol pronto            | `#F7C948` | `#FFF1B8 → #F7C948`, icon `#A16207` | 100 %                                      |
| `nosun`   | Sin sol               | `#9CA3AF` | `#C6CBD3 → #8B919C`                 | 78 % (56 % zoomed out)                     |
| `unknown` | Terraza sin confirmar | `#B59A80` | `#DCC8B4 → #A88D73`                 | 78 % (56 % zoomed out)                     |

Rules: sunny badges always sit above grey ones; only sunny terraces are ever enlarged; taupe is reserved for "unconfirmed" so it never reads as "no sun".

### Neutrals (day)

| Token           | Hex       | Use                              |
| --------------- | --------- | -------------------------------- |
| `ink`           | `#1F2328` | Primary text (15.8:1 on white)   |
| `text-soft`     | `#4B5563` | Secondary icons and controls     |
| `muted`         | `#6B7280` | Secondary text, captions (4.8:1) |
| `placeholder`   | `#8A8F98` | Input placeholders only          |
| `line`          | `#ECE7DF` | Dividers, borders                |
| `field`         | `#F3F2EF` | Input and search fields          |
| `toggle-off`    | `#E5E7EB` | Off toggles, empty tracks        |
| `surface-hover` | `#FAF8F4` | Hover on rows and buttons        |
| `bg`            | `#FFFFFF` | App and card surfaces            |

### Night

The whole app goes dark while the sun is down, graded by how deep the night is: **dusk** (sun just set) is a soft blue hour, **deep night** (sun 18° below the horizon) is the darkest. Values in between are mixed (`nightDepth`, `color-mix`).

| Token   | Dusk      | Deep night         |
| ------- | --------- | ------------------ |
| `bg`    | `#2D3348` | `#141826`          |
| `field` | `#383F56` | `#1D2231`          |
| `line`  | `#434A62` | `#2A3043`          |
| `ink`   | `#E8EAF0` | `#E8EAF0` (14.7:1) |
| `muted` | `#9AA3B5` | `#9AA3B5` (7:1)    |

Sun colours don't change at night; they glow on the dark map. Pins and slider knobs stay white.

### Map (day)

Apple Maps-like and warm. The map is the stage, not the star: low contrast, so the badges pop.

| Layer            | Hex                                                                |
| ---------------- | ------------------------------------------------------------------ |
| Land             | `#F6EEE2`                                                          |
| Residential      | `#F1E5D2`                                                          |
| Buildings (flat) | `#F0E4D3`, outline `#E5D5BF`                                       |
| Buildings (3D)   | walls `#F2E6D6`, roof caps `#FCF8F1`, soft warm light, antialiased |
| Parks            | `#CDE5AE`                                                          |
| Water            | `#9ACBEF`                                                          |
| Streets          | `#FFFFFF`, casing `#E4D6C3` (major `#E6CFA8`)                      |
| Shadows          | `#6B5848`, 0 → 0.6 opacity as the view tilts                       |
| Labels           | `#7A6B55` / `#8A7B66`, water `#4D8BC4`                             |

Night map palettes: see `DUSK` and `NIGHT` in `web/src/map/night.ts` and [`tokens.json`](tokens.json).

## 4. Typography

One family: the **system UI font** (SF Pro on Apple, Segoe UI on Windows, Roboto on Android), with Inter as the web fallback. Map labels use the basemap's Noto Sans.

| Style       | Size / weight                | Use                                 |
| ----------- | ---------------------------- | ----------------------------------- |
| Display     | 30 px / 800                  | App title "Sol y Cerveza"           |
| Clock       | 24 px / 700, tabular numbers | Chosen time in the sidebar          |
| Title       | 17–20 px / 800               | Card titles, sun box headline       |
| Body strong | 15–16 px / 600               | List names, legend, filters         |
| Body        | 15–16 px / 400               | Default text (line height 1.4)      |
| Caption     | 13 px / 400, `muted`         | Secondary lines ("Hasta las 17:40") |
| Small       | 11–12 px                     | Slider ticks, notes, attribution    |

Numbers that change (times, durations, prices) use `font-variant-numeric: tabular-nums` so they don't jump.

## 5. Layout, space and depth

Spacing follows a **4-point grid**, and every value comes from the tokens in `web/src/index.css` (`--space-*`, `--radius-*`, `--control`, `--map-inset`). If a value isn't on the scale, it's wrong.

| Token       | Value | Typical use                                          |
| ----------- | ----- | ---------------------------------------------------- |
| `--space-1` | 4 px  | Tight inner gaps, menu padding                       |
| `--space-2` | 8 px  | Label to control, list title to list, small paddings |
| `--space-3` | 12 px | Icon to text in rows, legend rows, map button gap    |
| `--space-4` | 16 px | Panel and card padding, map overlay inset            |
| `--space-5` | 20 px | Above a sidebar section (filters, results)           |
| `--space-6` | 24 px | Sidebar padding and the gap between sidebar blocks   |
| `--space-8` | 32 px | Reserved for large separations                       |

**Radius:** `--radius-s` 8 px (small buttons), `--radius-m` 12 px (fields, rows, notices), `--radius-l` 16 px (floating panels, menus, legend), `--radius-xl` 24 px (cards); 999 px for pills, toggles and tracks; 50 % for round buttons and badges.

### Sidebar

- 400 px wide, **24 px padding** on every side, **24 px between blocks** (brand, search, time, filters, results).
- Sections that follow a divider (filters, results) start **20 px** below it.
- Search field: at least **48 px** tall, 12 px radius, icon 16 px from the left edge, text starting at 44 px.
- List rows: 10 px × 12 px padding, 12 px icon-to-text gap. The list bleeds 12 px past the sidebar padding, so **row content lines up with every other element's left edge** and the selected row's highlight extends past it, as in iOS grouped lists.
- Filter rows: 8 px vertical padding, 12 px gap, toggle aligned to the right edge.

### Phones (under 900 px)

- A slim brand bar on top (32 px mark, 20 px title) with a **menu button** (44 px) on the right.
- The map fills the middle and the **time bar is the footer**, always in view.
- The menu opens over the map, between the brand bar and the footer, with search, filters and the list. The button turns into a close icon; Escape or picking a venue closes it, so the venue's map card shows.
- The map attribution "i" and the legend (as wide as its rows, 56 px tall) form one group, 8 px apart, centred at the bottom of the map.
- While the report picker is open (§7), the time footer and that bottom group are hidden: the picker's bar takes the bottom of the map, centred. On desktop the bar sits bottom-left (16 px inset, at most 420 px wide), clear of the legend.

### Map overlays

- Everything floating on the map sits on one **16 px inset** (`--map-inset`): city pill top-left, buttons top-right, legend bottom-right, attribution bottom-left.
- Map buttons and the city pill are **44 px tall** (`--control`, Apple's minimum touch target); buttons are round, the zoom pair is one 44 px-wide capsule; **12 px** between button groups.
- Toasts appear 12 px under the top controls.
- Map attribution: MapLibre's compact control, mounted in our own layout 8 px left of the legend (never in a map corner). It starts closed (just the "i", no focus ring); opened, the credits rise above it as a 24 px-wide vertical strip read bottom to top. It follows the theme (`bg`/`ink`, a light "i" at night).
- Legend: 16 px padding, 12 px between rows and between icon and label, 16 px radius; the info button is centred on the last row, 12 px from the right edge.
- Info panel: 16 px padding and radius, opens 12 px above the legend, at most 340 px wide.
- Owner bar (owner mode only, never seen by visitors): top centre of the map, 12 px under the top controls, as `bg` pills with `--shadow` ("Modo dueño", "Foto de precios", "Salir", and one-line messages above them). On phones it sits left-aligned between the inset and the map buttons, without the "Modo dueño" label.

### Depth and borders

- **Shadows:** one soft shadow for floating UI (`--shadow`: `0 4px 16px rgba(31,35,40,.10), 0 1px 3px rgba(31,35,40,.08)`); stronger only for the map card. At night shadows are black and deeper.
- **Borders:** 1 px `line` for dividers; a 3 px border in the state colour only on the selected map card.

## 6. Iconography

- Line icons, 24 px grid, **2 px stroke**, round caps and joins, `currentColor`. They live in `web/src/ui/icons.tsx`; add new ones there in the same style.
- Sun states have their own icons: full sun (con sol), sun on the horizon (sol pronto), faded sun (sin sol), sunrise/sunset (sun on the horizon with an arrow up/down).
- The **beer mug** is the venue symbol: it appears inside every map badge and the map card.
- Icons are 20–24 px in the UI, 12–16 px inside badges and slider marks.

## 7. Components

| Component           | Standard                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Map badge**       | A white teardrop (map-pin shape, the pointer leaving the circle on tangents) around a round gradient badge with the beer mug, with a soft shadow. Selected, it gets a 3 px ring in the state colour, the same as the card's border. Shows only the badge until real prices exist; the price slot then sits to its right in bold `ink`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Map card**        | The selected badge grows into a tab that sits on the card below it: name (whole, wrapped onto balanced lines, never cut) + "Tipo · Terraza", a `highlight` sun box (12 × 16 px padding) with the headline and "Hasta las …", and a sun bar 16 px below it: a full-width plain progress bar, its ends in line with the times under it (no knob, so it doesn't look draggable) that fills from when the sun arrived to when it goes. 280 px wide, 3 px border in the state colour. No corner buttons: the share button is off the card for now (its code stays). **Sugerir un cambio** is a small quiet pill (24 px tall, 12 px / 600 `text-soft`, `ink` at 6 % fill, fully round) centred between the sun bar's times, or centred 12 px under the sun box when there is no bar (night, shade). Known prices sit on one quiet line under the sun bar (mug + "Caña 1,50 €", "~" for visitor consensus); with no price the card shows nothing about price.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Card prices**     | Visitors see the prices as the one quiet line under the sun bar described in the Map card row (mug + "Caña 1,50 €", "Tercio Marca …", amounts in bold; visitors' consensus prices start with "~"). In owner mode the card instead shows one row per price ("Caña", "Tercio Marca") as 16 px price fields that save on Enter or leaving the field, prices waiting for confirmation sit on a `sun-soft` block with dark text, and "Foto de la carta" is a `sun` pill.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Card back**       | "Sugerir un cambio" turns the card to its back, every change on one card with one Enviar: a 32 px ‹ back button ("Volver") left of the centred title "Sugerir un cambio" (17 px / 800) over the venue name (13 px `muted`), then grouped rows like a settings list (`field` blocks, 14 px radius, 44 px rows, 1 px `line` between rows, 12 px between groups). Price group: the Caña / Tercio switch, "Marca" (a quiet select, only for a tercio) and "Precio" with a small right-aligned € field (16 px bold, `bg`, 8 px radius). Venue group: "Ubicación · Mover en el mapa ›" (hands over to the position picker, whose Listo brings the spot back here as "Movida 34 m ›", with everything typed kept) and "Ya no existe" with a switch. Enviar is a full-width 44 px `sun-soft` button with dark text, day and night; it sends everything as one request behind one bot check, which runs as soon as the back opens, so Cloudflare shows at most one box; while that check runs unseen, a 24 px spinner (`line` with a `sun-dark` arc, no text) sits above Enviar, giving way to Cloudflare's box if it asks for a tick (each turn of the card needs a new check; the first in a session also loads Cloudflare's script, so it takes longest); the result replaces the rows as a `muted` block. Focus moves to the title, not the back button, so a tap draws no ring. When the back is too tall for the space under the side buttons, the card moves sideways past them to use the full height. |
| **Position picker** | Places a venue for the card back's "Ubicación" and "¿Falta un bar? Añádelo" (in the menu, under the list). The card or menu closes and a fixed pin (`ink` teardrop with a `bg` ring and dot, its tip on the map's centre) sits over the map, which the visitor pans and zooms under it; badges stay visible but don't open cards. A floating bar at the bottom (`bg`, 16 px radius, `--shadow`, 12 × 16 px padding) has one 15 px / 600 line ("Mueve el mapa hasta el sitio correcto", or why Enviar is off: over 500 m away, outside Badajoz), then for a new venue a 44 px name field, a type select and a "Tiene terraza" toggle, then Cancelar / Enviar as two equal 44 px buttons (Cancelar / Listo for a move, which goes back to the card's back to be sent with the rest; Cancelar and Escape go back there too). A move starts at the venue, zoomed to 18, and Enviar waits until the pin has moved more than 5 m. Escape cancels. After sending, the bar shows the result and Cerrar.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Time bar**        | 8 px track, `sun-soft` fill, white knob with a 4 px `sun-soft` ring. Sunrise and sunset sit on the track as small icons in a ring; "now" is a blue dot (`#2563EB`) when the knob is elsewhere.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **List row**        | State icon, bold name (long names wrap, never cut), caption with the sun summary; selected row on `highlight`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Toggle**          | Pill, `toggle-off` when off, `sun-soft` when on, white knob.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Legend**          | Floating panel bottom-right with the four states and an info button centred on the last row; always above the badges.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Map controls**    | White round buttons (city pill, locate, zoom) with `--shadow`; dark at night.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## 8. Map behaviour

- **Loads after the app shell:** while the map's code downloads, the map area shows the land colour (`#F6EEE2`, `bg` at night) with "Cargando mapa…" in `text-soft`; no spinner.
- **Opens** on the city overview (flat top view, zoom 13.8, north up) at the current time.
- **The address is a link to the view:** it carries the chosen time (`t=HH:MM`, left out while the time follows the clock) and the selected venue (`v=<venue id>`). A shared link opens at that time today with the venue's card open, flying to it; bad or unknown values are ignored. A shared venue without a terrace turns "Solo con terraza" off so it shows.
- **Zoom drives the view:** flat top view up to zoom 14.5, easing into a 55° tilt by zoom 16. 3D buildings (drawn 1.4× taller) and their shadows only appear once tilted; the flat and mid-zoom views stay clean.
- **Zoomed out**, only the 8 terraces in sun now with the most sun today are enlarged; everything else shrinks.
- **The card follows the zoom, live while pinching:** it stays solid and keeps its content, shrinking smoothly from full size at zoom 16.5 to 60 % at 15. Below 15 it pops back into the selected badge (yellow ring) in 0.2 s; tapping that badge zooms in to open it again.
- Footpaths and venue names appear only up close. The map never leaves Badajoz.

## 9. Motion

- Short and calm: 150 ms for hover and scale, 300–400 ms for zoom steps and theme fades, 900 ms for flying to a venue.
- Ease, don't bounce. Changing the time recolours instantly; the day/night theme fades over 0.4 s.
- Respect "reduce motion" when adding new animations.

## 10. Accessibility

- Text meets WCAG AA: 4.5:1 for body text, 3:1 for large text and icons. Use `sun-dark` (never `sun`) for sun-coloured text on light backgrounds.
- State is never shown by colour alone: every state has an icon and a label (legend, list, card, badge `aria-label`).
- Every icon-only button has a Spanish `aria-label`; decorative icons are `aria-hidden`.
- Tap targets are at least 32 px (44 px on phones once mobile resumes).

## 11. Templates

### Social post (Instagram / X)

- **Square 1080 × 1080** (feed) or **1080 × 1920** (stories).
- Background: a sunny map crop (day palette) or a solid `highlight`; never a stock photo of beer.
- Top-left: the mark + "Sol y Cerveza" in Display weight.
- Centre: the map card as the hero, e.g. "Kiosco Silva · 2 h 20 min de sol · Hasta las 16:00".
- Bottom: one line of copy and the URL `isroma.github.io/sol-y-cerveza`.
- Copy formula: **"[Plaza / barrio]: [N] terrazas con sol ahora."** e.g. "Plaza Alta: 4 terrazas con sol ahora. ☀️"

### Link preview (Open Graph)

- **1200 × 630**, `highlight` background, mark at 160 px left, "Sol y Cerveza" Display in `ink`, tagline "Terrazas de Badajoz al sol" in `muted`, a strip of the four state badges bottom-right.
- It lives at `web/public/og.png` and is generated, with the manifest's app icons, by `web/scripts/brand-images.mjs`. Change the script, not the PNGs.

### App icons (web manifest)

- 192 and 512 px: the mark alone on a transparent background.
- Maskable 512 px: the mark at 60 % on a full-bleed `highlight` background, so it stays inside the safe circle whatever shape the launcher cuts.
- `theme_color` is `sun-soft` (`#FFC53D`), like the browser bar by day; `background_color` is `bg` (white).

### App store screenshots (when mobile resumes)

- 1290 × 2796 (iPhone 6.7") and 1080 × 1920 (Android).
- One promise per screenshot, headline at the top in Display weight, the real app below:
  1. "¿Dónde da el sol ahora?" (overview with sunny badges)
  2. "Cuánto sol le queda" (map card)
  3. "Mueve la hora y mira la sombra" (tilted 3D view with shadows)
  4. "También de noche" (dusk theme)

### Do and don't

- **Do** let the map breathe: one card at a time, badges over a quiet basemap.
- **Do** say how long the sun lasts; that's the product.
- **Don't** introduce new accent colours; reach for the state colours or neutrals.
- **Don't** use yellow for anything that isn't sun or the primary action.
- **Don't** show placeholder data (prices, ratings, photos) as if it were real.

## 12. Changing these standards

Update this document, `palette.svg` and `tokens.json` in the same PR as the code change, and say why in the PR. Keep the code as the source: the token names here match the CSS variables and TypeScript constants.

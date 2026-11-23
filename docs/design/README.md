# Sol y Cerveza design standards

The reference for how Sol y Cerveza looks, sounds and behaves. Use it before adding a screen, a component, a colour or a piece of copy. The live product is the source of truth for anything this document doesn't cover; if they disagree, fix one of them in the same PR.

- Palette at a glance: [`palette.svg`](palette.svg)
- Machine-readable tokens: [`tokens.json`](tokens.json) (mirrors `web/src/index.css`, `web/src/ui/categoryStyle.ts`, `web/src/map/mapStyle.ts` and `web/src/map/night.ts`)

![Sol y Cerveza palette](palette.svg)

## 1. Brand

**Idea:** the terrace that still has sun. A friendly local guide that answers one question in one glance: *where can I sit in the sun with a beer right now, and for how long?*

**Personality:** sunny, relaxed, local, precise. Warm like a Badajoz afternoon, but honest about the numbers: we show minutes of sun, not vague promises.

| We are | We are not |
| --- | --- |
| Warm and light-hearted | Childish or jokey |
| Local (Badajoz first) | Generic "city guide" |
| Precise (real sun, real minutes) | Technical or data-heavy in the UI |
| Calm, map-first | Loud, ad-like, cluttered |

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
- No exclamation marks in the UI, no emoji in product copy. Emoji are fine in social posts (one per post, ☀️ or 🍺).

**Glossary** (always these words):

| Concept | UI copy |
| --- | --- |
| In sun now | Con sol ahora |
| Sun within the hour | Sol pronto |
| No more sun today | Sin sol / Sin más sol hoy |
| Venue without a known terrace | Terraza sin confirmar |
| Sun left | "2 h 5 min de sol" |
| Sun until | "Hasta las 17:40" |
| Sun coming | "Sol en 25 min" / "Desde las 14:57" |
| Night | De noche |

## 3. Colour

Colour carries meaning here: **yellow means sun**. Keep it for sun and for the one primary action; don't use it as decoration.

### Brand and sun

| Token | Hex | Use |
| --- | --- | --- |
| `sun` | `#F59E0B` | Sunny state, icons, gradients' deep end. **Never as text on white** (2.2:1). |
| `sun-soft` | `#FFC53D` | Primary accents: slider fill, toggles on, selected chips, card border. |
| `sun-dark` | `#B45309` | Sun-coloured **text** and small icons on light backgrounds (5.0:1). |
| `chip` | `#FFC83D` | Selected chips and pills. Text on it is `ink` (10:1). |
| `highlight` | `#FFF6E0` | Soft sunny surfaces: selected list row, sun box in the map card. |

### Sun states (map badges, legend, list icons)

Every badge is a 160° gradient, light to deep, with a 2 px white ring.

| State | Copy | Solid | Badge gradient | Size |
| --- | --- | --- | --- | --- |
| `sun` | Con sol ahora | `#F59E0B` | `#FFC53D → #F59E0B` | 100 % (highlighted when zoomed out: 112 %) |
| `soon` | Sol pronto | `#F7C948` | `#FFF1B8 → #F7C948`, icon `#A16207` | 100 % |
| `nosun` | Sin sol | `#9CA3AF` | `#C6CBD3 → #8B919C` | 78 % (56 % zoomed out) |
| `unknown` | Terraza sin confirmar | `#B59A80` | `#DCC8B4 → #A88D73` | 78 % (56 % zoomed out) |

Rules: sunny badges always sit above grey ones; only sunny terraces are ever enlarged; taupe is reserved for "unconfirmed" so it never reads as "no sun".

### Neutrals (day)

| Token | Hex | Use |
| --- | --- | --- |
| `ink` | `#1F2328` | Primary text (15.8:1 on white) |
| `text-soft` | `#4B5563` | Secondary icons and controls |
| `muted` | `#6B7280` | Secondary text, captions (4.8:1) |
| `placeholder` | `#8A8F98` | Input placeholders only |
| `line` | `#ECE7DF` | Dividers, borders |
| `field` | `#F3F2EF` | Input and search fields |
| `toggle-off` | `#E5E7EB` | Off toggles, empty tracks |
| `surface-hover` | `#FAF8F4` | Hover on rows and buttons |
| `bg` | `#FFFFFF` | App and card surfaces |

### Night

The whole app goes dark while the sun is down, graded by how deep the night is: **dusk** (sun just set) is a soft blue hour, **deep night** (sun 18° below the horizon) is the darkest. Values in between are mixed (`nightDepth`, `color-mix`).

| Token | Dusk | Deep night |
| --- | --- | --- |
| `bg` | `#2D3348` | `#141826` |
| `field` | `#383F56` | `#1D2231` |
| `line` | `#434A62` | `#2A3043` |
| `ink` | `#E8EAF0` | `#E8EAF0` (14.7:1) |
| `muted` | `#9AA3B5` | `#9AA3B5` (7:1) |

Sun colours don't change at night; they glow on the dark map. Pins and slider knobs stay white.

### Map (day)

Apple Maps-like and warm. The map is the stage, not the star: low contrast, so the badges pop.

| Layer | Hex |
| --- | --- |
| Land | `#F6EEE2` |
| Residential | `#F1E5D2` |
| Buildings (flat) | `#F0E4D3`, outline `#E5D5BF` |
| Buildings (3D) | `#F4E6D0` |
| Parks | `#CDE5AE` |
| Water | `#9ACBEF` |
| Streets | `#FFFFFF`, casing `#E4D6C3` (major `#E6CFA8`) |
| Shadows | `#6B5848`, 0 → 0.6 opacity as the view tilts |
| Labels | `#7A6B55` / `#8A7B66`, water `#4D8BC4` |

Night map palettes: see `DUSK` and `NIGHT` in `web/src/map/night.ts` and [`tokens.json`](tokens.json).

## 4. Typography

One family: the **system UI font** (SF Pro on Apple, Segoe UI on Windows, Roboto on Android), with Inter as the web fallback. Map labels use the basemap's Noto Sans.

| Style | Size / weight | Use |
| --- | --- | --- |
| Display | 30 px / 800 | App title "Sol y Cerveza" |
| Clock | 24 px / 700, tabular numbers | Chosen time in the sidebar |
| Title | 17–20 px / 800 | Card titles, sun box headline |
| Body strong | 15–16 px / 600 | List names, legend, filters |
| Body | 15–16 px / 400 | Default text (line height 1.4) |
| Caption | 13 px / 400, `muted` | Secondary lines ("Hasta las 17:40") |
| Small | 11–12 px | Slider ticks, notes, attribution |

Numbers that change (times, durations, prices) use `font-variant-numeric: tabular-nums` so they don't jump.

## 5. Shape, space and depth

- **Radius:** 999 px for pills, badges, toggles and tracks; 50 % for round icons; 14–16 px for boxes inside cards; 18–22 px for cards and floating panels.
- **Spacing:** 4 px base; use 4, 8, 12, 14, 16, 20, 24. Sidebar padding 24 px, card padding 14 px, 20 px between sidebar sections.
- **Shadows:** one soft shadow for floating UI (`--shadow`: `0 4px 16px rgba(31,35,40,.10), 0 1px 3px rgba(31,35,40,.08)`); stronger only for the map card (`0 10px 28px rgba(31,35,40,.22)`). At night shadows are black and deeper.
- **Borders:** 1 px `line` for dividers; 3 px coloured border only for the selected map card.

## 6. Iconography

- Line icons, 24 px grid, **2 px stroke**, round caps and joins, `currentColor`. They live in `web/src/ui/icons.tsx`; add new ones there in the same style.
- Sun states have their own icons: full sun (con sol), sun on the horizon (sol pronto), faded sun (sin sol), sunrise/sunset (sun on the horizon with an arrow up/down).
- The **beer mug** is the venue symbol: it appears inside every map badge and the map card.
- Icons are 20–24 px in the UI, 12–16 px inside badges and slider marks.

## 7. Components

| Component | Standard |
| --- | --- |
| **Map badge** | Round gradient badge with the beer mug and a pointer under it; white ring and soft shadow. Shows only the badge until real prices exist; the price slot then sits to its right in bold `ink`. |
| **Map card** | Opens above the selected badge: badge + name + "Tipo · Terraza", a `highlight` sun box with the headline and "Hasta las …", and a sun bar from now through "until" to sunset. 260 px wide, 22 px radius, 3 px border in the state colour, pointer to the badge. |
| **Time bar** | 8 px track, `sun-soft` fill, white knob with a 4 px `sun-soft` ring. Sunrise and sunset sit on the track as small icons in a ring; "now" is a blue dot (`#2563EB`) when the knob is elsewhere. |
| **List row** | State icon, bold name, caption with the sun summary; selected row on `highlight`. |
| **Toggle** | Pill, `toggle-off` when off, `sun-soft` when on, white knob. |
| **Legend** | Floating panel bottom-right with the four states and an info button centred on the last row; always above the badges. |
| **Map controls** | White round buttons (city pill, locate, zoom) with `--shadow`; dark at night. |

## 8. Map behaviour

- **Opens** on the city overview (flat top view, zoom 13.8) at the current time.
- **Zoom drives the view:** flat top view up to zoom 14.5, easing into a 55° tilt by zoom 16. 3D buildings (drawn 1.4× taller) and their shadows only appear once tilted; the flat and mid-zoom views stay clean.
- **Zoomed out**, only the 8 terraces in sun now with the most sun today are enlarged; everything else shrinks.
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

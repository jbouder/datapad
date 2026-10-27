# Design

Datapad looks, feels and moves like holocron: Oxanium Variable for UI and
headings, JetBrains Mono for code, square Lyra corners, and three themes:
System, Light and Dark: holocron's light set and a neutral dark that mirrors
it (stock shadcn neutral dark grays, no tint; owner's call 2026-10-24).
Holocron's extra themes are deliberately left out. The spec's
structural rules carry over; its fonts and colors do not (see
`PLAN.md` → Deliberate departures).

## Tokens

Every color is a semantic token defined by both Light (`:root`) and Dark
(`.dark`) in `src/index.css`; `test/themes.test.ts` fails if Dark misses one or if a
text pair drops below 4.5:1. Datapad adds two pairs to holocron's set:

| Token                          | Meaning                            | Utilities                                           |
| ------------------------------ | ---------------------------------- | --------------------------------------------------- |
| `--warn` / `--warn-foreground` | Due today, paused, medium priority | `text-warn`, `bg-warn`, `bg-warn/15`, `border-warn` |
| `--ok` / `--ok-foreground`     | Done, demo                         | `text-ok`, `bg-ok`, `bg-ok/15`, `border-ok`         |

`--warn` and `--ok` are safe as text on `background` and `card`; their
`-foreground` is safe on top of a solid fill.

## Mapping the spec onto tokens

| Spec element   | Value    | Token                                                                               |
| -------------- | -------- | ----------------------------------------------------------------------------------- |
| Priority dot   | high     | `destructive`                                                                       |
|                | med      | `warn`                                                                              |
|                | low      | `muted-foreground`                                                                  |
|                | none     | `border`                                                                            |
| Status pill    | active   | `accent` fill, `accent-foreground` text                                             |
|                | paused   | dashed `border`, `muted-foreground` text                                            |
|                | done     | `ok` fill, `ok-foreground` text                                                     |
| Project health | green    | `ok` left edge and dot, the word "Green"                                            |
|                | yellow   | `warn` left edge and dot, "Yellow"                                                  |
|                | red      | `destructive` left edge and dot, "Red"                                              |
|                | none     | no edge, nothing shown on cards                                                     |
| Milestone      | upcoming | flag glyph (filled diamond on timelines), `foreground`                              |
|                | past     | `muted-foreground`, with the words "Past:" for screen readers                       |
| Blocked task   | blocked  | `warn` lock glyph, waiting-on initials, the words "Blocked on …" for screen readers |
| Due date       | overdue  | `destructive`, with the word "Overdue"                                              |
|                | today    | `warn`, with the word "Today"                                                       |

Meetings have no type, so there is no type pill; a milestone is its own
thing on the project, marked by the flag.

State is never shown by color alone: dots have a text label for screen
readers and a tooltip, and dates carry words.

## Type scale

Oxanium throughout; base 15px with 1.45 line height (rem stays 16px so the
stock components keep their sizes).

| Use                          | Size                             | Class             |
| ---------------------------- | -------------------------------- | ----------------- |
| Body                         | 15px / 1.45                      | default           |
| Page title                   | 34px desktop, 28px below 820px   | `text-page-title` |
| Card name                    | 24px                             | `text-card-name`  |
| Empty states and quiet lines | 17px, medium, `muted-foreground` | `text-state`      |
| Code                         | JetBrains Mono                   | `font-mono`       |

## Text styles

Rendered Markdown (notes, project descriptions, meeting-linked notes,
summaries) uses one set of styles, `.prose-note` in `src/index.css`, through
`src/components/Markdown.tsx`. The parser is `shared/markdown.ts`; storage
stays plain Markdown.

| Markdown                    | Style                                                         | Size                       |
| --------------------------- | ------------------------------------------------------------- | -------------------------- |
| `# `                        | Heading 1, Oxanium 600                                        | 22px / 1.25                |
| `## `                       | Heading 2, Oxanium 600                                        | 18px / 1.3                 |
| `### ` (and deeper)         | Heading 3, Oxanium 600                                        | 16px / 1.35                |
| plain lines                 | Body                                                          | 15px / 1.45                |
| `` `code` ``, fenced blocks | Mono (JetBrains Mono) on `muted`; blocks scroll and have Copy | 0.88em inline, 13px blocks |
| `> `                        | Quote: 2px `border` rule, `muted-foreground`                  | body                       |
| `- [ ]` / `- [x]`           | Checkbox; done items struck through and muted                 | body                       |
| `@{id}`                     | Mention chip on `accent`                                      | body, 500                  |

Headings render as `h3`–`h5` so they sit under the page's own `h1` and
section `h2`s. `.prose-compact` scales the whole set by 0.88 (grid
cards).

## Density and layout

| Rule              | Value                                                                       |
| ----------------- | --------------------------------------------------------------------------- |
| Row height        | 36px desktop, 44px below 820px (`--row-height`, `.row`)                     |
| Rail              | 232px (`--rail-width`), desktop only                                        |
| Content max width | 1040px (`--content-max`)                                                    |
| Breakpoint        | 820px: rail and 3:2 project grid above; bottom tab bar and one column below |
| Side panel        | 460px, full screen below 820px                                              |

## Mobile

Datapad is used on phones a lot. Every view is designed at 320–430px first:
- 44px minimum touch targets on touch devices; WCAG 2.5.8 measured in e2e.
- Nothing revealed only on hover; use the `hover-none` variant to show it.
- Inputs at 16px or larger so iOS does not zoom; set `inputmode`,
  `enterkeyhint` and `autocapitalize`.
- Respect safe areas (`env(safe-area-inset-*)`) in the top bar, tab bar,
  panels and toasts.
- Tables become stacked rows; wide layouts (board, timeline) scroll inside
  their own container, never the page.

## Installing (PWA)

- `public/site.webmanifest`: standalone, opens at `/focus`, scope `/`.
  The page links it with `crossorigin="use-credentials"`: behind
  Cloudflare Access, a manifest fetched without the session cookie would
  get the login page instead.
- Icons: a near-black tile (`#0a0a0a`, Dark's `--background`) with the
  Datapad mark in near-white, so they read on light and dark home screens
  alike. 192 and 512 (`any`), a 512 `maskable` with the mark inside the
  safe zone, a 180 `apple-touch-icon`, `favicon.ico` (32) and the SVG
  favicon. `og.png` (1200×630) for link previews. `npm run icons`
  (`scripts/icons.ts`) redraws them all from the mark; commit the output.
- `theme-color` has one value per scheme in `index.html` and follows the
  theme picked in the app (`ThemeProvider`). `viewport-fit=cover` with
  safe-area padding on the top bar, the tab bar, panel footers and toasts.
- **No service worker.** Every request, assets included, must pass the
  Access check in the Worker, and an app shell cached on the device would
  open after the Access session ended, then fail on its first request. Chrome
  and Safari install without one, the IndexedDB snapshot already paints the
  last data at once, and the offline queue covers writes. Revisit only if
  measured cold start on a phone needs it (M8 #55).
- The installed app shares the browser's cookies (Android: always; iOS:
  from Safari's Add to Home Screen, a separate cookie jar, so sign in to
  Access once inside the installed app).

## Copy

- Sentence case everywhere, including buttons and headings.
- Buttons name the action: "Add task", "Save note", "Archive project", not
  "OK" or "Submit".
- Typographic quotes and apostrophes in UI text (“ ” ’), an ellipsis
  character for in-progress states ("Saving…").
- Empty states say what is missing and what to do next.
- Errors say what happened and what to try, in one line.

## Motion

Holocron's rules, in `AGENTS.md`. View transition types: `page` (route
changes), `theme` (theme switch), `filter` (list filter and group-by
changes on `.vt-list`), `layout` (ViewSwitcher: the first 40 visible items
carry a `view-transition-name` only while the switch runs, so they move to
their new place; `withLayoutTransition` in `src/lib/motion.ts`). Panels and toasts enter with
`@starting-style`. List rows and cards use `.enter`; pressable things use
`.press`. Counts never animate.

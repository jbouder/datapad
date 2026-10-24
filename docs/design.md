# Design

Datapad looks, feels and moves like holocron: Oxanium Variable for UI and
headings, JetBrains Mono for code, square Lyra corners, and three themes:
System, Light and Dark: holocron's light set and a neutral dark that mirrors
it (stock shadcn neutral dark greys, no tint; owner's call 2026-10-24).
Holocron's extra themes are deliberately left out. The spec's
structural rules carry over; its fonts and colours do not (see
`PLAN.md` → Deliberate departures).

## Tokens

Every colour is a semantic token defined by both Light (`:root`) and Dark
(`.dark`) in `src/index.css`; `test/themes.test.ts` fails if Dark misses one or if a
text pair drops below 4.5:1. Datapad adds two pairs to holocron's set:

| Token                          | Meaning                            | Utilities                                           |
| ------------------------------ | ---------------------------------- | --------------------------------------------------- |
| `--warn` / `--warn-foreground` | Due today, paused, medium priority | `text-warn`, `bg-warn`, `bg-warn/15`, `border-warn` |
| `--ok` / `--ok-foreground`     | Done, demo                         | `text-ok`, `bg-ok`, `bg-ok/15`, `border-ok`         |

`--warn` and `--ok` are safe as text on `background` and `card`; their
`-foreground` is safe on top of a solid fill.

## Mapping the spec onto tokens

| Spec element    | Value     | Token                                    |
| --------------- | --------- | ---------------------------------------- |
| Priority dot    | high      | `destructive`                            |
|                 | med       | `warn`                                   |
|                 | low       | `muted-foreground`                       |
|                 | none      | `border`                                 |
| Status pill     | active    | `accent` fill, `accent-foreground` text  |
|                 | paused    | dashed `border`, `muted-foreground` text |
|                 | done      | `ok` tint (`bg-ok/15`), `ok` text        |
| Event type pill | milestone | `accent` fill                            |
|                 | deadline  | `destructive` outline and text           |
|                 | demo      | `ok` outline and text                    |
| Due date        | overdue   | `destructive`, with the word "Overdue"   |
|                 | today     | `warn`, with the word "Today"            |

State is never shown by colour alone: dots have a text label for screen
readers and a tooltip, and dates carry words.

## Type scale

Oxanium throughout; base 15px with 1.45 line height (rem stays 16px so the
stock components keep their sizes).

| Use                                | Size                             | Class             |
| ---------------------------------- | -------------------------------- | ----------------- |
| Body                               | 15px / 1.45                      | default           |
| Page title                         | 34px desktop, 28px below 820px   | `text-page-title` |
| Card name                          | 24px                             | `text-card-name`  |
| Current state line, on cards       | 17px, medium, `muted-foreground` | `text-state`      |
| Current state line, project header | 22px                             | `text-state-lg`   |
| Code                               | JetBrains Mono                   | `font-mono`       |

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
changes), `theme` (theme switch), `filter` (list filter, group-by and
layout changes on `.vt-list`). Panels and toasts enter with
`@starting-style`. List rows and cards use `.enter`; pressable things use
`.press`. Counts never animate.

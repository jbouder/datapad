# Accessibility

Datapad aims to conform to **WCAG 2.2 Level AA**, on desktop and phone, in
Light and Dark. It **partially conforms**: what is checked, how, and the
known exceptions are below. A new exception gets an issue and a line here.

## How it is checked

Automated, on every pull request (CI's `check` and `e2e` jobs):

| What                                                                                                                                                                                                                             | Where                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| axe (the WCAG 2.0, 2.1 and 2.2 A and AA rules) on every route empty, every page and layout with data, and the states behind a click (panels, forms, search, the account menu), in Light and Dark, at desktop and phone width     | `e2e/a11y.spec.ts`, and `expectAccessible()` in most other specs |
| Contrast of every token pair as drawn: text ≥ 4.5:1 on each surface it sits on; the focus ring (at the half alpha it is mostly drawn with) and a text field's edge ≥ 3:1                                                         | `test/themes.test.ts`                                            |
| Focus is never lost: closing a panel returns it to what opened it (or the page, if that was deleted); a toast's button hands it back; a link inside the page moves it to the new page; switching layout keeps it on the switcher | `e2e/focus-kept.spec.ts`                                         |
| A toast stays while focus is in it (WCAG 2.2.1), and errors move focus to their heading                                                                                                                                          | `e2e/focus-kept.spec.ts`, `e2e/errors.spec.ts`                   |
| Reflow at 320px (a 1280px window at 400% zoom) with no sideways scrolling; 44px targets on touch                                                                                                                                 | `e2e/reflow.spec.ts`                                             |
| Everything from the keyboard: add, move, complete, edit and reorder tasks; the shortcut sheet; single-letter keys stay out of fields                                                                                             | `e2e/keyboard.spec.ts`, `shared/shortcuts.ts`                    |
| Reduced motion (the system setting and Settings → Appearance → Motion): nothing animates                                                                                                                                         | `e2e/motion.spec.ts`                                             |
| Forced colours (Windows High Contrast): the selected layout, the current section, a pressed tool and a selected option are outlined in `Highlight`, since backgrounds are dropped                                                | `e2e/a11y.spec.ts`, `src/index.css`                              |
| The skip link reaches the main content                                                                                                                                                                                           | `e2e/a11y.spec.ts`                                               |

Manual, before each release (record the date and anything found):

| Check                                                                                                                                                    | Last done          | Notes                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------- |
| VoiceOver on macOS (Safari): quick-add and complete a task; write a note with `/` and `@`; switch layouts; open, edit and save the task panel; ⌘K search | _not yet recorded_ |                                                 |
| VoiceOver on iOS (Safari, the installed app): the same                                                                                                   | _not yet recorded_ |                                                 |
| Keyboard only, no mouse, through every page and panel                                                                                                    | _not yet recorded_ | The automated specs above cover the main flows. |
| 200% browser zoom on desktop                                                                                                                             | _not yet recorded_ | Reflow at 400% is automated.                    |
| Forced colours on Windows (Contrast themes)                                                                                                              | _not yet recorded_ | The outlines are automated; the look is not.    |

## Every drag has another way

WCAG 2.5.7 (dragging) and 2.1.1 (keyboard): nothing needs a drag except
drawing.

| Drag (mouse)                                                            | Keyboard                                                                                      | Touch                                                         |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Reorder a task in a list                                                | Alt+↑ / Alt+↓ on the focused row; the row's menu → Move to top                                | Long-press the handle for up and down buttons; the row's menu |
| Move a task card between board columns                                  | The card's Move to… menu                                                                      | The same menu                                                 |
| Move a task's due date on the timeline, or drop an undated task onto it | Open the task (the timeline's rows are listed for the keyboard when it has focus) and set Due | Tap the point or the task, set Due                            |
| Reorder a meeting's topics                                              | Alt+↑ / Alt+↓; the topic's menu → Move up / Move down                                         | The topic's menu                                              |
| Whiteboard: move an item                                                | Tab to it (focus selects it), then the arrow keys (Shift: 10px)                               | A one-finger drag, or select and drag                         |
| Whiteboard: pan and zoom                                                | Scroll; the zoom buttons; ⌘K opens the board centred on a found item                          | Two fingers; the zoom buttons                                 |
| Whiteboard: place an item, resize it, draw or re-aim an arrow           | **Not yet** ([#222](https://github.com/jbouder/datapad/issues/222))                           | Tap to place; drag a corner or an arrow's end                 |
| Whiteboard: freehand ink                                                | Exempt: the path is the content                                                               | One finger                                                    |

## Known exceptions

- **Whiteboard creation and resizing need a pointer** (above, #222). Every
  item can still be reached, moved, restacked, recoloured, edited and
  deleted from the keyboard, and has a name for screen readers.
- **Summaries are written by a language model**, on the device. Their text
  is not reviewed for reading level or structure, and the panel says to
  check it.
- **The manual checks above have not been recorded yet.** Until they are,
  this statement rests on the automated checks.

## Building it in

- Colors are tokens (`src/index.css`); a new pair that carries meaning gets
  a row in `test/themes.test.ts`. A translucent token is tested as drawn
  (`ring/50` on `card`).
- A new route or layout gets a line in `e2e/a11y.spec.ts` (`ROUTES` or
  `WITH_DATA`).
- Anything that removes the focused element hands focus on: `focusPage()`
  and `hasFocus()` in `src/lib/focus.ts`, or a panel's `finalFocus`.
- A new drag needs a keyboard and a touch way to do the same, and a row in
  the table above.
- Motion follows [design.md](design.md#motion); state is never shown by a
  fill alone (forced colours drops it).

Found something? Open an issue with the `accessibility` label.

import { type ReactNode, useEffect } from 'react';
import {
  COMMANDS,
  describeFormatKeys,
  FORMAT_SHORTCUTS,
  type FormatShortcut,
} from '#shared/composer';
import { layoutTable } from '#shared/pages';
import { COMMIT, VERSION } from '#shared/version';
import { ShortcutList } from '@/components/ShortcutList';
import { usePageTitle } from '@/hooks/usePageTitle';
import { linkProps, type Route } from '@/lib/router';

/**
 * Using Datapad, in holocron's Help style: short sections, one address
 * each (`/help#keyboard`). The shortcut, `/` command, formatting and
 * layout tables are generated from the lists the app binds (`SHORTCUTS`,
 * `COMMANDS`, `FORMAT_SHORTCUTS`, `PAGES`), so they cannot drift.
 * Self-hosting lives in the repository's docs, not here.
 */

/** The pages with a layout switcher, each with its layouts and default. */
const LAYOUTS = layoutTable();

const SECTIONS = [
  { id: 'about', title: 'What Datapad is' },
  { id: 'how', title: 'How Datapad works' },
  { id: 'views', title: 'Layouts and saved views' },
  { id: 'basics', title: 'The common path' },
  { id: 'keyboard', title: 'Keyboard' },
  { id: 'writing', title: 'Writing notes' },
  { id: 'mentions', title: 'Mentions' },
  { id: 'meetings', title: 'Meetings and meeting mode' },
  { id: 'whiteboard', title: 'Whiteboard' },
  { id: 'summaries', title: 'Summaries' },
  { id: 'spaces', title: 'Spaces' },
  { id: 'data', title: 'Your data' },
  { id: 'account', title: 'Settings and signing out' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

export function HelpPage({ section }: { section?: string }) {
  usePageTitle('Help');

  // `/help#writing` (or a link from elsewhere) lands on that section.
  useEffect(() => {
    if (!section) return;
    document.getElementById(section)?.scrollIntoView({ block: 'start' });
  }, [section]);

  return (
    <article
      aria-labelledby="help-title"
      className="enter flex max-w-prose min-w-0 flex-col gap-6"
    >
      <h1 id="help-title" className="text-page-title">
        Help
      </h1>
      <nav aria-label="On this page">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                {...linkProps({ name: 'help', section: s.id })}
                className="inline-flex min-h-11 items-center underline underline-offset-4 desk:min-h-0"
              >
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Section id="about">
        <p>
          Datapad is a private tracker for projects, tasks, notes, meetings and
          people, for one person. Only you can open it: every request is checked
          against your Cloudflare Access sign-in, and your data lives in your
          own Cloudflare account. Changes save as you make them and show on
          every device you have open.
        </p>
        <p className="text-sm text-muted-foreground" data-testid="build">
          This is Datapad {VERSION}, built from commit{' '}
          <span className="font-mono">{COMMIT}</span>. Settings → Account says
          the same.
        </p>
      </Section>

      <Section id="how">
        <p className="text-sm">
          Datapad has three places and one input. You work in the day, in the
          room of a project or a person, or across everything at once, and you
          write into the capture line wherever you are.
        </p>
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[7rem_minmax(0,1fr)]">
          <Term name="Today" to={{ name: 'today' }}>
            The day as a timeline. Meetings anchor it, a Now line moves through
            it, and the tasks added and done and the notes written sit at their
            times. Next up has Enter meeting while a meeting is ahead. Beside it
            are the open loops in three lanes: <strong>Mine</strong>,{' '}
            <strong>Waiting on</strong> others and <strong>To decide</strong>.
            Previous day and Next day step through the days; Week shows seven at
            once, with the week’s digest and Copy as Markdown. Stepping back to
            the last working day shows what happened since. With summaries on,
            Brief me writes a few sentences about the day.
          </Term>
          <Term name="Rooms">
            One page per project and per person. Each has a state line, the open
            loops in three lanes, and one stream of everything attached, newest
            first. A project room also has Plan (description, milestones,
            members, links and activity) and its Whiteboard. A person’s room is
            your 1:1 prep: what you owe them, what they owe you, and what to
            discuss. <strong>Pin</strong> puts a room in the rail; Settings →
            Rooms orders them. Before anything is pinned, the rail lists the
            active projects; <strong>Hide from rail</strong> in a project’s menu
            leaves one out, and Settings → Rooms shows it again. On a phone the
            Rooms tab lists the same. <strong>Move to…</strong> in a note’s menu
            moves it to another project. <strong>Pin</strong> in a note’s menu
            puts it in its room’s tab row, after the tabs, by its first line (a
            person’s room shows the pinned notes that mention them). Choose one
            to open it at the top of the room, on any tab; Esc, Close or Back
            closes it. Pins that do not fit go under <strong>Pinned</strong>.
            Every project starts with a pinned <strong>Notepad</strong>, an
            ordinary note you can write in, unpin or delete.
          </Term>
          <Term name="All" to={{ name: 'all' }}>
            Every task, note, meeting, project and person in one list. Pick
            kinds with the chips, then narrow with Find and the filters. The
            Rooms chip shows every project and person room instead, each with
            Pin. The space’s whiteboard is in the header.
          </Term>
          <Term name="Scratch" to={{ name: 'scratch' }}>
            The notes with no home yet. Write at the top, then{' '}
            <strong>File to…</strong> a project, make a task of a note, or mark
            it to decide.
          </Term>
          <Term name="Capture line">
            One input at the top of Today and of each room. A plain line is a
            note; <code>[ ]</code>, <code>todo</code> or a date makes a task;{' '}
            <code>?</code> or <code>decide:</code> something to decide;{' '}
            <code>waiting on @Name</code> a task blocked on them.{' '}
            <code>#project</code> files it and <code>@Name</code> mentions
            someone. Chips say what it will become before you press Enter.{' '}
            <Key>/</Key> at the start makes something else:{' '}
            <code>/meeting</code> (a day and time in the line, today if none),{' '}
            <code>/milestone</code> (needs a project and a date),{' '}
            <code>/project</code> and <code>/person</code>, or forces{' '}
            <code>/note</code>, <code>/task</code>, <code>/decide</code> or{' '}
            <code>/waiting</code>. Shift+Enter opens the full note composer. In
            a room, what you write belongs to the room.
          </Term>
          <Term name="Search">
            <Key>⌘K</Key> or <Key>/</Key> finds any project, task, note,
            meeting, org, person or whiteboard item, and adds a task, a note, a
            meeting or a project.
          </Term>
        </dl>
        <p className="text-sm">
          The rail has Today, Scratch and All, then Rooms: the pinned rooms, or
          the active projects before anything is pinned, and the people who owe
          you something. A phone has Today, Scratch, Rooms and All along the
          bottom; Rooms lists what the rail does, and stays lit inside a room.
          Add meeting is beside Today’s timeline and Schedule meeting in each
          room. The + beside Rooms, in the rail or on the phone’s Rooms page,
          adds a project or a person and opens their room; New project is also
          beside the project rooms on All’s Rooms chip. People and Orgs are in
          Settings, and each person opens their room.
        </p>
      </Section>

      <Section id="views">
        <p className="text-sm">
          On All, tasks, meetings or projects shown alone have layouts of their
          own, picked from the buttons at the top right (<Key>v</Key> cycles
          them) and remembered for each kind, saved with the space so every
          device opens them the same way. A link that names its own filters
          still shows them, and the search text is never kept. Settings → All
          sets the kinds All opens on and each kind’s layout.
        </p>
        <Table
          caption="Layouts"
          head={['Page', 'Layouts', 'Opens as']}
          rows={LAYOUTS.map((l) => [
            l.page,
            l.options.map((o) => o.label).join(' · '),
            l.def,
          ])}
        />
        <p className="text-sm">
          <strong>Save view</strong> keeps the kinds, filters, sort and layout
          as a chip above the list; its menu renames it, pins it to the rail or
          deletes it. Select tasks with their boxes to complete, mark to decide,
          move, assign, date or delete them all at once, with Undo.
        </p>
      </Section>

      <Section id="basics">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            <strong>Write it down where you are.</strong> <Key>n</Key> goes to
            the capture line (where there is none, it opens a new task). Enter
            saves, with Undo.
          </li>
          <li>
            <strong>The checkbox closes</strong> a task or a loop. Undo is in
            the message that follows.
          </li>
          <li>
            <strong>Click drills in:</strong> a task opens its panel, a project
            or a person their room, a meeting meeting mode.
          </li>
          <li>
            <strong>Esc backs out:</strong> it closes the panel or menu you are
            in, and asks first if you have unsaved changes.
          </li>
          <li>
            Deleting a task or note offers Undo instead of asking first. Only
            deleting a project or a person asks.
          </li>
        </ul>
      </Section>

      <Section id="keyboard">
        <p className="text-sm">
          Press <Key>?</Key> anywhere for this list. Single letters do nothing
          while you are typing or a panel is open.
        </p>
        <ShortcutList />
      </Section>

      <Section id="writing">
        <p className="text-sm">
          Notes, descriptions and task details show formatted as you write them,
          and are kept as Markdown. Type <Key>/</Key> at the start of a line for
          a menu of blocks, use the keys below, or type the Markdown (
          <code>#</code>, <code>-</code>, <code>- [ ]</code>,{' '}
          <code>**bold**</code>) and it turns into formatting. Lists carry on
          when you press Enter; Enter on an empty item ends the list.
          Double-click a saved note’s text to edit it, or use Edit in its menu.
        </p>
        <p className="text-sm">
          The same menu makes things from the line you are on, read the way the
          capture line reads it, in the note’s project: <code>/task</code>,{' '}
          <code>/decide</code> and <code>/waiting</code> turn the line into a
          checklist item and make a task, <code>/meeting</code> and{' '}
          <code>/milestone</code> leave the line as it is, <code>/project</code>{' '}
          makes a project, <code>/person</code> adds someone to People and
          mentions them, and <code>/note</code> moves the line into a note of
          its own. Each offers Undo.
        </p>
        <p className="text-sm">
          A task keeps <strong>running notes</strong> too: in its panel, under
          Details, <strong>Add note</strong> writes a dated entry (“pinged
          legal, waiting on the redline”) instead of rewriting the details. They
          are ordinary notes, so they show on All with a link to the task, and a
          task with notes shows how many in its row. Deleting the task keeps
          them.
        </p>
        <p className="text-sm">
          <strong>Note templates</strong> are the notes you write the same way
          every time: a 1:1, a retro, a status update. Make one in Settings →
          Templates, or with <strong>Save as template</strong> on a note. In any
          note, <code>/template</code> (or the template’s name after the{' '}
          <code>/</code>) puts one in at the caret, and the New note panel’s{' '}
          <strong>Template</strong> picker starts the note from one.
        </p>
        <Table
          caption="/ commands"
          head={['Command', 'Types', 'What it is']}
          rows={COMMANDS.map((c) => [
            `/${c.id}`,
            <code key="md" className="whitespace-nowrap">
              {c.markdown}
            </code>,
            `${c.label}: ${c.description}`,
          ])}
        />
        <Table
          caption="Formatting keys"
          head={['Keys', 'Does']}
          rows={FORMAT_SHORTCUTS.map((s) => [
            <span key="keys" className="whitespace-nowrap">
              {describeFormatKeys(s)}
            </span>,
            <span key="does">
              {s.label} <code>{formatExample(s)}</code>
            </span>,
          ])}
        />
      </Section>

      <Section id="mentions">
        <p className="text-sm">
          Type <code>@</code> and a name in any note or description to mention
          someone from People; pick them with the arrow keys and Enter or Tab. A
          mention follows the person if you rename them, and their room’s stream
          lists every note and task that mentions them. Add people in Settings →
          People.
        </p>
      </Section>

      <Section id="meetings">
        <p className="text-sm">
          A meeting opens in <strong>meeting mode</strong>: its phase (Prep,
          Live or Debrief), day, time and attendees, Join, and the previous and
          next meeting of its series. The topics are on the left, the note
          composer is always open in the middle with the saved notes and action
          items under it, and the open loops are on the right: the other
          person’s for a 1:1, otherwise the project’s. Leave, or <Key>Esc</Key>,
          goes back to where you came from.
        </p>
        <p className="text-sm">
          <strong>Topics</strong> are a meeting’s agenda, one line each. Add
          them with <strong>Add topic</strong> (Enter adds one and keeps the
          field open for the next; Esc closes it). Tick a topic when it has been
          covered, and use <strong>Outcome</strong> to note what came of it in a
          line. Click a title or an outcome to change it. Drag to reorder, or
          use Move up and Move down in a topic’s menu (<Key>Alt</Key>+
          <Key>↑</Key> / <Key>↓</Key> from the keyboard); the menu also makes a
          task from a topic, as an action item.
        </p>
        <p className="text-sm">
          <strong>Action items</strong> are tasks that came out of a meeting:{' '}
          <code>/task</code> in its note, Make task on a note, or a topic’s
          menu. They are ordinary tasks in the meeting’s project, so they also
          show in the lanes, on All and in the room. A task from a meeting says
          so and links back. Deleting the meeting keeps its action items as
          plain tasks.
        </p>
        <p className="text-sm">
          Meetings with the same title, project and people are a series. A new
          one in a series offers to <strong>carry forward</strong> the last
          one’s uncovered topics (a checkbox in the form, on by default).{' '}
          <strong>Carry forward</strong> in meeting mode copies the last
          meeting’s uncovered topics here (skipping any it already has) and
          marks them covered there, with Undo. A carried topic shows the day it
          was first raised.
        </p>
      </Section>

      <Section id="whiteboard">
        <p className="text-sm">
          Every project has a whiteboard (the <strong>Whiteboard</strong> tab in
          its room), and the space has one of its own, linked from All;{' '}
          <Key>⌘K</Key> → Open whiteboard goes to the one you are on. It is a
          freeform canvas for sticky notes, text, rectangles, arrows and
          freehand ink, kept with the rest of your data and live on every
          device.
        </p>
        <p className="text-sm">
          The tools are on the toolbar, each with a key: <Key>V</Key> select,{' '}
          <Key>S</Key> sticky note, <Key>T</Key> text, <Key>R</Key> rectangle,{' '}
          <Key>A</Key> arrow, <Key>P</Key> pen and <Key>E</Key> eraser;{' '}
          <Key>1</Key>–<Key>5</Key> pick a color. Double-click (or{' '}
          <Key>Enter</Key> on) a sticky, a text or a rectangle to write in it.
          An arrow dropped on a sticky or a rectangle stays attached as it
          moves. Drag to move, use the corners to resize, <Key>]</Key> and{' '}
          <Key>[</Key> bring to the front and send to the back, and{' '}
          <Key>Delete</Key> removes. Scroll, or hold <Key>Space</Key> and drag,
          to pan; <Key>⌘</Key>-scroll or pinch to zoom. On a phone a drawing
          tool draws with one finger and two fingers pan.
        </p>
        <p className="text-sm">
          Everything but freehand ink works from the keyboard too (Keyboard,
          above, lists the board’s keys): with <Key>S</Key>, <Key>T</Key> or{' '}
          <Key>R</Key> picked, <Key>Enter</Key> places one in the middle of the
          view; <Key>Tab</Key> selects an item, the arrow keys move it and{' '}
          <Key>Alt</Key> with them resizes it. For an arrow, select where it
          starts, press <Key>A</Key> then <Key>Enter</Key>, <Key>Tab</Key> to
          where it points and press <Key>Enter</Key>. <Key>Enter</Key> on an
          arrow re-aims its head and <Key>Shift</Key>+<Key>Enter</Key> its tail;{' '}
          <Key>Esc</Key> cancels either.
        </p>
        <p className="text-sm">
          <Key>⌘Z</Key> undoes and <Key>⇧⌘Z</Key> redoes every change you made
          on the board while it is open; the Undo and Redo buttons at its corner
          do the same on a phone. <Key>⌘K</Key> finds the words on stickies,
          text and rectangles and opens the board on the one you pick. The
          board’s menu (⋯ in its header) has <strong>Download as PNG</strong>{' '}
          and <strong>Download as SVG</strong>: a picture of everything on the
          board in the current theme’s colors, made in this browser.
        </p>
      </Section>

      <Section id="summaries">
        <p className="text-sm">
          Summarize writes with a small language model that runs in this
          browser. Nothing about your data leaves the device. In a project’s or
          a person’s room it writes a sentence or two on where things stand,
          under the state line, from the lanes, what is coming up and the last
          two weeks of the stream. In meeting mode (in More) it writes a short
          recap from the notes, the covered topics and the action items. On a
          task it summarizes the task in a panel. The first time, it asks before
          downloading the model (about 1 GB, once); Settings → Summaries picks
          another model or removes it. It needs WebGPU, which recent Chrome,
          Edge, Safari and Firefox have on most hardware. Stop keeps what it has
          written; Save as note files the summary to the room or the meeting (a
          person’s as a note that mentions them), and × puts it away.
        </p>
        <p className="text-sm">
          Summaries can be turned off on this device in Settings → Summaries:
          then nothing offers Summarize and the model is never loaded. Turn the
          same switch back on to bring Summarize back.
        </p>
        <p className="text-sm">
          Brief me, on Today, has the same model write a few sentences about the
          last working day and today, and up to three things to do first, from
          what Today shows: the meetings, what is due and the three lanes. The
          facts and counts come from Datapad; the model only writes. The brief
          stays on this device for the rest of the day, in each space, without
          running again; Regenerate writes it anew, Save as note keeps it as a
          note, and × puts it away. It is never synced. The week zoom’s
          Summarize does the same for the week’s digest.
        </p>
      </Section>

      <Section id="spaces">
        <p className="text-sm">
          A space is a separate Datapad: its own projects, tasks, notes,
          meetings and people, with nothing shared between spaces. You start
          with Main. Switch spaces from the name at the top of the rail, the
          account menu, or <Key>⌘K</Key>; each device remembers which one it has
          open. Make a new one from the rail, <Key>⌘K</Key> or Settings →
          Spaces, which also renames, reorders and deletes them; deleting asks
          you to type the name, and the last space cannot go.{' '}
          <strong>Move to…</strong> in a project room takes the project, with
          its tasks, notes, meetings and milestones, to another space, and
          copies the people and org it needs.
        </p>
      </Section>
      <Section id="data">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            <strong>Export</strong> (Settings → Data) downloads everything in
            the open space as one JSON file, yours to keep.
          </li>
          <li>
            <strong>Import</strong> merges such a file in: same ids are
            replaced, nothing else is deleted. You see the counts first.
          </li>
          <li>
            <strong>Backups</strong> of every space run each night to your own
            R2 bucket; the latest 30 of each are kept. Download or restore one
            from Settings → Data.
          </li>
          <li>
            <strong>Offline</strong>, changes wait on the device and save when
            you are back, even after a reload. The status in the top bar says
            which: Saved, Saving…, Connecting… or Offline with how many changes
            are waiting, led by a colored dot (on phones the dot alone, unless
            offline).
          </li>
        </ul>
      </Section>

      <Section id="account">
        <p className="text-sm">
          The account button at the top right opens the menu: your spaces,
          Motion, Theme, Help, Settings and Sign out. Settings has Appearance
          (theme, 12-hour or 24-hour time, motion), Today (who Mine means, how
          far Next up looks, the first day of the week, Brief me, the lanes and
          meeting mode’s sections), Rooms (the pinned rooms’ order, the lanes,
          the tab a project room opens on), Capture (what a plain line becomes,
          whether <code>@Name</code> assigns, the new task priority), All (the
          kinds it opens on, each kind’s layout and sort, the saved views),
          Templates, Summaries, Spaces, People, Orgs, Data, Connected apps (the
          MCP apps, such as Claude, you let in, with Revoke) and Account.
          Appearance, Today, Rooms, Capture and All each have Reset to defaults,
          with Undo. Signing out ends your Cloudflare Access session on this
          browser; sign in again to come back. When your device asks for reduced
          motion, Datapad never animates.
        </p>
      </Section>

      <p>
        <a
          {...linkProps({ name: 'today' })}
          className="underline underline-offset-4"
        >
          Back to Today
        </a>
      </p>
    </article>
  );
}

function Section({ id, children }: { id: SectionId; children: ReactNode }) {
  const title = SECTIONS.find((s) => s.id === id)?.title;
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="flex scroll-mt-20 flex-col gap-3"
    >
      <h2 id={`${id}-title`} className="font-heading text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A term; with `to`, its name links there (so a hidden section is reachable). */
function Term({
  name,
  to,
  children,
}: {
  name: string;
  to?: Route;
  children: ReactNode;
}) {
  return (
    <div className="contents">
      <dt className="font-semibold">
        {to ? (
          <a
            {...linkProps(to)}
            className="inline-flex min-h-11 items-center underline underline-offset-4 desk:min-h-0"
          >
            {name}
          </a>
        ) : (
          name
        )}
      </dt>
      <dd className="mb-2 sm:mb-0">{children}</dd>
    </div>
  );
}

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="border bg-muted px-1.5 font-mono text-xs">{children}</kbd>
  );
}

function Table({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full text-left text-sm">
        <caption className="mb-1 text-left text-xs font-semibold text-muted-foreground">
          {caption}
        </caption>
        <thead>
          <tr className="border-b">
            {head.map((h) => (
              <th key={h} scope="col" className="py-1.5 pr-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, r) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list.
            <tr key={r} className="border-b align-top">
              {cells.map((cell, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed columns.
                <td key={i} className="py-1.5 pr-3">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What a formatting key types around "text". */
function formatExample({ does }: FormatShortcut): string {
  if ('wrap' in does) return `${does.wrap}text${does.wrap}`;
  if ('link' in does) return '[text](https://)';
  const command = COMMANDS.find((c) => c.id === does.command);
  return command?.markdown === 'text' ? 'text' : `${command?.markdown}text`;
}

import { type ReactNode, useEffect } from 'react';
import {
  COMMANDS,
  describeFormatKeys,
  FORMAT_SHORTCUTS,
  type FormatShortcut,
} from '#shared/composer';
import { ShortcutList } from '@/components/ShortcutList';
import { usePageTitle } from '@/hooks/usePageTitle';
import { linkProps } from '@/lib/router';

/**
 * Using Datapad, in holocron's Help style: short sections, one address
 * each (`/help#keyboard`). The shortcut, `/` command and formatting tables
 * are generated from the lists the app binds (`SHORTCUTS`, `COMMANDS`,
 * `FORMAT_SHORTCUTS`), so they cannot drift. Self-hosting lives in the
 * repository's docs, not here.
 */

const SECTIONS = [
  { id: 'about', title: 'What Datapad is' },
  { id: 'views', title: 'The views' },
  { id: 'basics', title: 'The common path' },
  { id: 'keyboard', title: 'Keyboard' },
  { id: 'writing', title: 'Writing notes' },
  { id: 'mentions', title: 'Mentions' },
  { id: 'meetings', title: 'Meetings, topics, prep and debrief' },
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
      </Section>

      <Section id="views">
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[7rem_minmax(0,1fr)]">
          <Term name="Focus">
            What needs you: the next seven days of meetings and milestones, and
            open tasks by when they are due. <Key>m</Key> shows only yours.
          </Term>
          <Term name="Projects">
            Every active project as cards, a table or a timeline. A project page
            has its tasks, milestones, meetings, notes, decisions and activity.
          </Term>
          <Term name="Tasks">
            Every task, as a list, table, board or timeline, grouped and
            filtered as you like. Select several to close, move or assign them
            at once.
          </Term>
          <Term name="Meetings">
            Every meeting, with its topics and its prep and debrief notes, as a
            list, a month calendar or a timeline.
          </Term>
          <Term name="Notes">
            Every note, newest first, as a feed or a grid. Pinned notes stay on
            top.
          </Term>
          <Term name="Digest">
            Your own status report: what happened in each project over a week,
            from tasks, notes, meetings, decisions and the activity logs. Copy
            it as Markdown, keep it as a note, or Summarize it.
          </Term>
          <Term name="Search">
            <Key>⌘K</Key> or <Key>/</Key> finds any project, task, note,
            meeting, decision or person.
          </Term>
          <Term name="Decisions">
            Why things are the way they are: every decision, by project, with
            who decided and when. Add them on a project page, or turn a line of
            a note into one with <code>/decision</code>.
          </Term>
          <Term name="People">
            In Settings → People: everyone you assign, add to projects and
            mention, each with their projects, open tasks, decisions and
            mentions, for a quick check before a 1:1.
          </Term>
          <Term name="Orgs">
            In Settings → Orgs: the clients, teams, vendors and partners your
            projects belong to, each with its projects, contacts, meetings and
            notes.
          </Term>
        </dl>
        <p className="text-sm">
          Most pages switch layout from the buttons at the top right of the
          list; each page remembers its choice.
        </p>
      </Section>

      <Section id="basics">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            <strong>Enter adds.</strong> Type in a quick-add and press Enter; it
            stays ready for the next one.
          </li>
          <li>
            <strong>The checkbox closes</strong> a task. Undo is in the message
            that follows.
          </li>
          <li>
            <strong>Click drills in:</strong> a task opens its panel, a project
            its page.
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
          Notes, descriptions and task details are Markdown. Type <Key>/</Key>{' '}
          at the start of a line for a menu of blocks, or use the keys below.
          Lists carry on when you press Enter; Enter on an empty item ends the
          list.
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
          mention follows the person if you rename them, and their page lists
          every note and task that mentions them. Add people in Settings →
          People.
        </p>
      </Section>

      <Section id="meetings">
        <p className="text-sm">
          Every meeting offers <strong>Prep</strong>, <strong>Debrief</strong>{' '}
          and <strong>Note</strong> (in its ⋯ menu on a phone). Each opens a
          note composer right under the meeting, started with its title and
          date, and links the note to the meeting as its prep (before), debrief
          (after) or a plain note; switch between them above the text. Save note
          adds it without leaving the page; Esc or Cancel closes it. The meeting
          then shows its notes under it, and its summary reads them.
        </p>
        <p className="text-sm">
          <strong>Topics</strong> are a meeting’s agenda, one line each. Add
          them in the meeting’s form (one per line) or in the field under the
          meeting, or with Add topic in its menu. Tick a topic when it has been
          covered, and use <strong>Outcome</strong> to note what came of it in a
          line; ticking and the outcome are separate. Click a title or an
          outcome to change it. Drag to reorder, or use Move up and Move down in
          a topic’s menu (<Key>Alt</Key>+<Key>↑</Key> / <Key>↓</Key> from the
          keyboard); the menu also makes a task or a decision from a topic. A
          Prep note starts with the topics not yet covered.
        </p>
        <p className="text-sm">
          Meetings with the same title, project and people are a series. A new
          one in a series offers to <strong>carry forward</strong> the last
          one’s uncovered topics (a checkbox in the form, on by default).{' '}
          <strong>Carry forward</strong> in a meeting’s menu copies its
          uncovered topics to the next one in the series (skipping any it
          already has) and marks them covered here, with Undo. A carried topic
          shows the day it was first raised.
        </p>
      </Section>

      <Section id="summaries">
        <p className="text-sm">
          Summarize (on a project, task, meeting or note) writes a short summary
          with a small language model that runs in this browser. Nothing about
          your data leaves the device. The first time, it asks before
          downloading the model (about 1 GB, once); Settings → Summaries picks
          another model or removes it. It needs WebGPU, which recent Chrome,
          Edge, Safari and Firefox have on most hardware. Stop keeps what it has
          written; Save as note keeps the summary with the item’s project.
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
          <strong>Move to…</strong> on a project page takes the project, with
          its tasks, notes, meetings, milestones and decisions, to another
          space, and copies the people and org it needs.
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
            <strong>Offline</strong>, changes wait on the device (the status
            says how many) and save when you are back, even after a reload.
          </li>
        </ul>
      </Section>

      <Section id="account">
        <p className="text-sm">
          The account button at the top right opens the menu: your spaces,
          Motion, Theme, Settings and Sign out. Settings has Appearance,
          Templates (the tasks a new project can start with; Save as template on
          a project makes one), Summaries, Spaces, People (each person with
          their projects, tasks and mentions), Orgs (each org with its projects,
          contacts, meetings and notes), Data and Account. Signing out ends your
          Cloudflare Access session on this browser; sign in again to come back.
          When your device asks for reduced motion, Datapad never animates.
        </p>
      </Section>

      <p>
        <a
          {...linkProps({ name: 'focus' })}
          className="underline underline-offset-4"
        >
          Back to Focus
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

function Term({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="font-semibold">{name}</dt>
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

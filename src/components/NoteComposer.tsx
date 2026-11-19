import {
  CheckSquareIcon,
  CodeIcon,
  ListBulletsIcon,
  TextBIcon,
  TextHIcon,
  TextItalicIcon,
} from '@phosphor-icons/react';
import { Editor } from '@tiptap/core';
import type { Slice } from '@tiptap/pm/model';
import { Selection } from '@tiptap/pm/state';
import {
  type CSSProperties,
  type Ref,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type Command,
  type CommandId,
  type CreateCommandId,
  isCreateCommand,
  linkHref,
  matchCommands,
  matchFormatShortcut,
  matchTemplates,
  slashQuery,
  type TemplateChoice,
  templateBody,
} from '#shared/composer';
import { localDate } from '#shared/dates';
import { LIMITS } from '#shared/limits';
import { mentionMatches, mentionQuery } from '#shared/mentions';
import { type DocNode, docToMarkdown, markdownToDoc } from '#shared/note-doc';
import type { Person } from '#shared/types';
import {
  applyFormat,
  type CaretLine,
  caretLine,
  inList,
  insertDoc,
  runCommand,
  setLink,
  toggleLinkAt,
} from '@/components/note-editor/commands';
import { noteExtensions } from '@/components/note-editor/extensions';
import { htmlToMarkdown, looksLikeMarkdown } from '@/lib/paste';
import { cn } from '@/lib/utils';

function readDraft(key: string | undefined): string | null {
  if (!key) return null;
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeDraft(key: string | undefined, value: string) {
  if (!key) return;
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // Private mode: the draft just isn't kept.
  }
}

function now(): { today: string; time: string } {
  const d = new Date();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { today: localDate(d), time };
}

function isTemplate(item: Command | TemplateChoice): item is TemplateChoice {
  return 'body' in item;
}

/** A template's first line, without its block marker, for the menu. */
function firstLine(body: string): string {
  const line = body.split('\n').find((l) => l.trim()) ?? '';
  return line.replace(/^(#{1,6}\s+|>\s?|[-*•]\s+(\[[ xX]\]\s+)?)/, '').trim();
}

type Popup =
  | {
      kind: 'slash';
      /** Where the typed `/query` starts in the document. */
      from: number;
      arg: string;
      items: (Command | TemplateChoice)[];
    }
  | { kind: 'mention'; from: number; items: Person[] };

export interface NoteComposerHandle {
  /** The caret to the end of the text, the composer in view. */
  focus: () => void;
}

/**
 * The editor for notes, task details and project descriptions (#376): the
 * text shows formatted as you write it, headings, lists, checklists, bold
 * and the rest, with no Markdown to see, and is stored as the same
 * Markdown the textarea wrote (`shared/note-doc.ts`). It keeps the `/`
 * command menu, `@` mentions, the formatting keys, Markdown typed as you
 * go (`# `, `- `, `**bold**`), rich-text paste and, with `draftKey`, a
 * draft kept in sessionStorage.
 *
 * `value` and `onChange` are Markdown with mentions as `@Name`; the caller
 * turns them into `@{id}` tokens on save. Nothing is handed back until
 * the text changes, so opening a note never rewrites it.
 */
export function NoteComposer(props: {
  value: string;
  onChange: (value: string) => void;
  people: Record<string, Person>;
  /** ⌘/Ctrl+Enter. */
  onSubmit?: () => void;
  /**
   * `/task`, `/meeting` and the other create commands (#375): make one
   * from the line's text. False when nothing was made.
   */
  onCreate?: (id: CreateCommandId, line: string) => boolean;
  /** The create commands the menu offers; none without `onCreate`. */
  creates?: readonly CreateCommandId[];
  /** Note templates the `/` menu offers after its commands. */
  templates?: readonly TemplateChoice[];
  /** Where the unsaved draft lives in sessionStorage. */
  draftKey?: string;
  id?: string;
  /** An accessible name, when no `<label>` points at `id`. */
  label?: string;
  placeholder?: string;
  /** The height it starts at, in lines. */
  rows?: number;
  /** The most Markdown it holds, in characters. */
  maxLength?: number;
  autoFocus?: boolean;
  /** The formatting buttons (touch and narrow screens only). */
  toolbar?: boolean;
  className?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
  /** `data-*` attributes for the editor (e.g. its linked meeting). */
  data?: Record<`data-${string}`, string | undefined>;
  ref?: Ref<NoteComposerHandle>;
}) {
  const {
    value,
    onChange,
    people,
    onCreate,
    creates,
    templates,
    draftKey,
    id,
    label,
    rows = 3,
    toolbar = true,
    className,
    data,
    ref,
  } = props;
  const listId = useId();
  const linkId = useId();
  const latest = useRef(props);
  latest.current = props;
  const box = useRef<HTMLDivElement>(null);
  const mount = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  /** The Markdown the editor holds, as last handed out or taken in. */
  const held = useRef(value);
  const [line, setLine] = useState<CaretLine | null>(null);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [anchor, setAnchor] = useState({ top: 0, left: 0 });
  const [labelledBy, setLabelledBy] = useState<string | undefined>();
  /** The link field (⌘K), open over this range. */
  const [linking, setLinking] = useState<{ from: number; to: number } | null>(
    null,
  );
  const [href, setHref] = useState('');

  // A draft from earlier in this tab comes back once.
  const restored = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on mount
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const draft = readDraft(draftKey);
    if (draft && !value) onChange(draft);
  }, []);
  useEffect(() => {
    if (restored.current) writeDraft(draftKey, value);
  }, [draftKey, value]);

  const popup = useMemo<Popup | null>(() => {
    if (!line) return null;
    const slash = slashQuery(line.text, line.text.length);
    const slashFrom = slash ? line.start + slash.start : -1;
    if (slash && dismissed !== slashFrom) {
      const items = [
        ...matchCommands(slash.query).filter(
          (c) =>
            !isCreateCommand(c.id) ||
            (onCreate !== undefined && (creates ?? []).includes(c.id)),
        ),
        ...matchTemplates(slash.query, templates ?? []),
      ];
      if (items.length > 0) {
        const arg = slash.query.split(' ').slice(1).join(' ');
        return { kind: 'slash', from: slashFrom, arg, items };
      }
    }
    const mention = mentionQuery(line.text, line.text.length);
    const mentionFrom = mention ? line.start + mention.start : -1;
    if (mention && dismissed !== mentionFrom) {
      const items = mentionMatches(people, mention.query);
      if (items.length > 0) {
        return { kind: 'mention', from: mentionFrom, items };
      }
    }
    return null;
  }, [line, dismissed, people, onCreate, creates, templates]);
  const open = popup !== null;
  const count = popup?.items.length ?? 0;
  const highlighted = Math.min(active, Math.max(count - 1, 0));

  /** What the editor's own handlers read: always this render's. */
  const live = useRef({ popup, highlighted, count });
  live.current = { popup, highlighted, count };

  // The editor element's attributes, read whenever the view updates.
  const attrs = useRef<Record<string, string>>({});
  attrs.current = Object.fromEntries(
    Object.entries({
      ...data,
      id,
      // A text editor to a screen reader; its menus are announced through
      // the option the arrow keys are on.
      role: 'textbox',
      'aria-multiline': 'true',
      'aria-label': label,
      'aria-labelledby': label ? undefined : labelledBy,
      'aria-autocomplete': 'list',
      'aria-controls': listId,
      'aria-activedescendant': open ? `${listId}-${highlighted}` : undefined,
      'aria-describedby': props['aria-describedby'],
      'aria-invalid': props['aria-invalid'] ? 'true' : undefined,
      'aria-required': props['aria-required'] ? 'true' : undefined,
      autocapitalize: 'sentences',
      'data-slot': 'textarea',
      class: cn(
        'note-editor prose-note max-h-[60vh] w-full overflow-y-auto border border-input bg-transparent px-2.5 py-2 text-base outline-none transition-colors duration-(--duration-fast) ease-(--ease-standard) focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 desk:text-[15px] dark:bg-input/30',
        className,
      ),
    }).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );

  const blurTimer = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    const el = mount.current;
    if (!el) return;
    /** The caret's line, for the menus; none while not typing. */
    const track = (e: Editor) => {
      setLine(e.isFocused ? caretLine(e.state) : null);
    };
    const ed = new Editor({
      element: el,
      extensions: noteExtensions({
        placeholder: () => latest.current.placeholder ?? '',
        maxLength: () => latest.current.maxLength ?? LIMITS.bodyMax,
      }),
      content: markdownToDoc(held.current, latest.current.people),
      injectCSS: false,
      enablePasteRules: false,
      autofocus: latest.current.autoFocus ? 'end' : false,
      editorProps: {
        attributes: () => attrs.current,
        handleDOMEvents: {
          // Esc (with no menu open) and ⌘Enter outside code belong to
          // what the editor sits in: closing a composer, submitting a
          // panel. Left to the editor, it would mark them handled.
          keydown: (view, event) => {
            const mod = event.metaKey || event.ctrlKey;
            if (event.key === 'Escape') return !live.current.popup;
            return (
              event.key === 'Enter' &&
              mod &&
              !view.state.selection.$from.parent.type.spec.code
            );
          },
        },
        handleKeyDown: (_view, event) => keyDown.current(event),
        handlePaste: (_view, event) => paste.current(event),
        clipboardTextSerializer: (slice: Slice) =>
          docToMarkdown({
            type: 'doc',
            content: slice.content.toJSON() as DocNode[] | undefined,
          }),
      },
      onUpdate: ({ editor: e }) => {
        const md = docToMarkdown(e.getJSON() as DocNode);
        if (md === held.current) return;
        held.current = md;
        setActive(0);
        setDismissed(null);
        latest.current.onChange(md);
      },
      onTransaction: ({ editor: e }) => track(e),
      onFocus: ({ editor: e }) => {
        window.clearTimeout(blurTimer.current);
        track(e);
      },
      onBlur: () => {
        // A blur closes the menu a moment later, so a click on an option
        // still lands; back in the field before then, it stays.
        window.clearTimeout(blurTimer.current);
        blurTimer.current = window.setTimeout(() => {
          if (!ed.isDestroyed && !ed.isFocused) setLine(null);
        }, 120);
      },
    });
    setEditor(ed);
    return () => {
      window.clearTimeout(blurTimer.current);
      ed.destroy();
      setEditor(null);
    };
  }, []);

  // A new value from outside (a draft, a reset after saving) replaces the
  // text, out of the undo history.
  useLayoutEffect(() => {
    if (!editor || value === held.current) return;
    held.current = value;
    const doc = editor.schema.nodeFromJSON(markdownToDoc(value, people));
    const { tr } = editor.state;
    tr.replaceWith(0, tr.doc.content.size, doc.content)
      .setSelection(Selection.atEnd(tr.doc))
      .setMeta('addToHistory', false)
      .setMeta('preventUpdate', true);
    editor.view.dispatch(tr);
  }, [editor, value, people]);

  // The view reads the attributes again when they change.
  const attrKey = JSON.stringify(attrs.current);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attrKey is the change
  useLayoutEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.view.dispatch(editor.state.tr.setMeta('attributes', true));
    }
  }, [editor, attrKey]);

  // A `<label for>` names the editor and focuses it, as for a textarea.
  useEffect(() => {
    if (!id || label || !editor) return;
    const el = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (!(el instanceof HTMLLabelElement)) return;
    if (!el.id) el.id = `${id}-label`;
    setLabelledBy(el.id);
    const click = () => editor.commands.focus('end');
    el.addEventListener('click', click);
    return () => el.removeEventListener('click', click);
  }, [id, label, editor]);

  const focusEnd = () => {
    if (!editor) return;
    editor.commands.focus('end', { scrollIntoView: false });
    editor.view.dom.scrollIntoView({ block: 'nearest' });
  };
  useImperativeHandle(ref, () => ({ focus: focusEnd }));

  // The menu sits under the caret, inside the field's width.
  useLayoutEffect(() => {
    const at = popup?.from ?? linking?.from;
    if (at === undefined || !editor || !box.current) return;
    const outer = box.current.getBoundingClientRect();
    const coords = editor.view.coordsAtPos(
      Math.min(at, editor.state.doc.content.size),
    );
    const width = Math.min(288, outer.width);
    setAnchor({
      top: coords.bottom - outer.top + 4,
      left: Math.max(
        0,
        Math.min(coords.left - outer.left, outer.width - width),
      ),
    });
  }, [popup, linking, editor]);

  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (open) list.current?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  const choose = (index: number) => {
    const p = live.current.popup;
    if (!p || !editor) return;
    const to = editor.state.selection.from;
    const range = { from: p.from, to };
    setActive(0);
    setDismissed(null);
    if (p.kind === 'mention') {
      const person = p.items[index];
      if (!person) return;
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          {
            type: 'mention',
            attrs: { id: person.id, label: person.name },
          },
          { type: 'text', text: ' ' },
        ])
        .run();
      return;
    }
    const item = p.items[index];
    if (!item) return;
    // The typed `/query` goes, then the choice applies.
    editor.chain().focus().deleteRange(range).run();
    if (isTemplate(item)) {
      const body = templateBody(item.body);
      insertDoc(editor, markdownToDoc(body, latest.current.people), {
        template: true,
      });
      return;
    }
    command(item.id, p.arg);
  };

  const command = (cmd: CommandId, arg = '') => {
    if (!editor) return;
    runCommand(editor, cmd, now(), arg, (create, text) => {
      const make = latest.current.onCreate;
      return !make || make(create, text);
    });
  };

  const startLink = () => {
    if (!editor) return;
    if (toggleLinkAt(editor)) return;
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, ' ');
    setHref(linkHref(text) ? text : '');
    setLinking({ from, to });
  };

  const finishLink = (apply: boolean) => {
    const range = linking;
    setLinking(null);
    if (!editor || !range) return;
    const url = apply ? linkHref(href) : null;
    if (url) setLink(editor, range, url);
    else editor.chain().focus().setTextSelection(range).run();
  };

  const keyDown = useRef<(e: KeyboardEvent) => boolean>(() => false);
  keyDown.current = (e) => {
    if (!editor) return false;
    const { popup: p, highlighted: h, count: n } = live.current;
    const mod = e.metaKey || e.ctrlKey;
    if (p && !mod) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive((h + step + n) % n);
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        choose(h);
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setDismissed(p.from);
        return true;
      }
    }
    if (mod) {
      const shortcut = matchFormatShortcut(e);
      if (!shortcut) return false;
      e.preventDefault();
      const { does } = shortcut;
      if ('wrap' in does) {
        applyFormat(editor, does.wrap);
      } else if ('link' in does) {
        // ⌘K here is a link, not the search palette.
        e.stopPropagation();
        startLink();
      } else {
        command(does.command);
      }
      return true;
    }
    if (e.key === 'Tab' && !e.shiftKey && inList(editor.state)) {
      // Lists do not nest; Tab stays put instead of leaving.
      e.preventDefault();
      return true;
    }
    return false;
  };

  const paste = useRef<(e: ClipboardEvent) => boolean>(() => false);
  paste.current = (e) => {
    const data = e.clipboardData;
    if (!editor || !data) return false;
    // In a code block, text goes in as it is.
    if (editor.state.selection.$from.parent.type.spec.code) return false;
    const html = data.getData('text/html');
    const plain = data.getData('text/plain');
    let markdown = plain;
    // Copied from a note: its plain text is already the Markdown.
    if (html && !html.includes('data-pm-slice') && !looksLikeMarkdown(plain)) {
      markdown = htmlToMarkdown(html) || plain;
    }
    if (!markdown) return false;
    e.preventDefault();
    insertDoc(editor, markdownToDoc(markdown, latest.current.people));
    return true;
  };

  const bar: {
    label: string;
    icon: React.ReactNode;
    run: () => void;
  }[] = [
    {
      label: 'Bold',
      icon: <TextBIcon />,
      run: () => editor && applyFormat(editor, '**'),
    },
    {
      label: 'Italic',
      icon: <TextItalicIcon />,
      run: () => editor && applyFormat(editor, '_'),
    },
    {
      label: 'Code',
      icon: <CodeIcon />,
      run: () => editor && applyFormat(editor, '`'),
    },
    {
      label: 'Bulleted list',
      icon: <ListBulletsIcon />,
      run: () => command('bullet'),
    },
    {
      label: 'Checklist',
      icon: <CheckSquareIcon />,
      run: () => command('checklist'),
    },
    { label: 'Heading', icon: <TextHIcon />, run: () => command('h2') },
    {
      label: 'Commands',
      icon: <span className="font-mono text-sm">/</span>,
      run: () => {
        if (!editor) return;
        const { $from } = editor.state.selection;
        const before = $from.parent.textBetween(
          0,
          $from.parentOffset,
          undefined,
          '￼',
        );
        const lead = before === '' || /\s$/.test(before) ? '/' : ' /';
        editor
          .chain()
          .focus()
          .insertContent({ type: 'text', text: lead })
          .run();
      },
    },
  ];

  return (
    <div
      ref={box}
      className="relative flex min-w-0 flex-col gap-1"
      style={{ '--note-rows': rows } as CSSProperties}
      onKeyDownCapture={(e) => {
        // ⌘Enter submits. Caught on the way in, before the editor sees
        // it: Chrome on Android hands Enter to the editor late, without
        // its modifiers.
        const submit = latest.current.onSubmit;
        if (!submit || e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
        if (!(e.target instanceof HTMLElement) || !e.target.isContentEditable) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        submit();
      }}
    >
      {toolbar && (
        <fieldset className="format-bar">
          <legend className="sr-only">Formatting</legend>
          {bar.map((b) => (
            <button
              key={b.label}
              type="button"
              aria-label={b.label}
              title={b.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={b.run}
              className="press inline-flex size-11 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-5"
            >
              {b.icon}
            </button>
          ))}
        </fieldset>
      )}
      <div ref={mount} className="note-editor-mount min-w-0" />
      {linking && (
        <fieldset
          style={{ top: anchor.top, left: anchor.left }}
          className="absolute z-50 m-0 flex w-72 max-w-full min-w-0 items-center gap-1 border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <legend className="sr-only">Link</legend>
          <label htmlFor={linkId} className="sr-only">
            Link address
          </label>
          <input
            id={linkId}
            // biome-ignore lint/a11y/noAutofocus: opened by ⌘K to type the address
            autoFocus
            value={href}
            placeholder="https://"
            inputMode="url"
            onChange={(e) => setHref(e.target.value)}
            onBlur={() => finishLink(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                finishLink(true);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                finishLink(false);
              }
            }}
            aria-invalid={href !== '' && !linkHref(href) ? true : undefined}
            className="h-11 min-w-0 flex-1 bg-transparent px-2 text-base outline-none desk:h-8 desk:text-sm"
          />
        </fieldset>
      )}
      <div
        ref={list}
        id={listId}
        role="listbox"
        aria-label={popup?.kind === 'slash' ? 'Commands' : 'People'}
        hidden={!open}
        style={{ top: anchor.top, left: anchor.left }}
        className="absolute z-50 max-h-72 w-72 max-w-full overflow-y-auto border bg-popover p-1 text-popover-foreground shadow-md"
      >
        {popup?.kind === 'slash' &&
          popup.items.map((c, i) => (
            <div
              key={isTemplate(c) ? `template-${c.id}` : c.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === highlighted}
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
              onKeyDown={() => {}}
              className={cn(
                'flex min-h-11 cursor-pointer flex-col justify-center px-2 py-1 desk:min-h-9',
                i === highlighted && 'bg-accent text-accent-foreground',
              )}
            >
              <span className="flex items-baseline gap-2 text-sm">
                <span className="flex-1 truncate">
                  {isTemplate(c) ? c.name : c.label}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {isTemplate(c) ? 'template' : c.markdown}
                </span>
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {isTemplate(c) ? firstLine(c.body) : c.description}
              </span>
            </div>
          ))}
        {popup?.kind === 'mention' &&
          popup.items.map((p, i) => (
            <div
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === highlighted}
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
              onKeyDown={() => {}}
              className={cn(
                'flex min-h-11 cursor-pointer items-center gap-2 px-2 text-sm desk:min-h-8',
                i === highlighted && 'bg-accent text-accent-foreground',
              )}
            >
              <span className="flex-1 truncate">{p.name}</span>
              {p.role && (
                <span className="text-xs text-muted-foreground">{p.role}</span>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}

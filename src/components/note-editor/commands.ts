import type { Editor } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { type EditorState, TextSelection } from '@tiptap/pm/state';
import {
  type BlockKind,
  type CommandId,
  type Context,
  type CreateCommandId,
  markOf,
  personLine,
  planCommand,
} from '#shared/composer';
import { type DocNode, inlineToMarkdown } from '#shared/note-doc';

/**
 * The composer's commands carried out on the editor (#376). What each one
 * does is decided in `shared/composer.ts` (`planCommand`); this is only
 * the part that needs ProseMirror.
 */

export interface CaretLine {
  /** The caret's line up to the caret, a mention as one character. */
  text: string;
  /** Where the line starts in the document. */
  start: number;
}

/** The line the caret is on, for the `/` and `@` menus; none in code. */
export function caretLine(state: EditorState): CaretLine | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const { $from } = selection;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return null;
  return {
    text: $from.parent.textBetween(0, $from.parentOffset, undefined, '￼'),
    start: $from.start(),
  };
}

const ITEMS = new Set(['listItem', 'taskItem']);

/** Whether the caret is in a list item (Tab stays put there). */
export function inList(state: EditorState): boolean {
  const { $from } = state.selection;
  return $from.depth > 1 && ITEMS.has($from.node(-1).type.name);
}

/** A formatting key's mark (`**`, `_`, `` ` ``, `~~`), on or off. */
export function applyFormat(editor: Editor, wrap: string) {
  editor.chain().focus().toggleMark(markOf(wrap)).run();
}

function isKind(editor: Editor, kind: BlockKind): boolean {
  switch (kind) {
    case 'h1':
    case 'h2':
    case 'h3':
      return editor.isActive('heading', { level: Number(kind[1]) });
    case 'bullet':
      return editor.isActive('bulletList');
    case 'numbered':
      return editor.isActive('orderedList');
    case 'checklist':
      return editor.isActive('taskList');
    case 'quote':
      return editor.isActive('blockquote');
    case 'code':
      return editor.isActive('codeBlock');
    default:
      return false;
  }
}

/**
 * Make the selected lines `kind`. When they already are, they go back to
 * body text: applying twice undoes, as it did in the textarea.
 */
export function setLineKind(editor: Editor, kind: BlockKind) {
  const chain = editor.chain().focus().clearNodes();
  if (kind === 'text' || isKind(editor, kind)) {
    chain.run();
    return;
  }
  switch (kind) {
    case 'h1':
    case 'h2':
    case 'h3':
      chain.setHeading({ level: Number(kind[1]) as 1 | 2 | 3 });
      break;
    case 'bullet':
      chain.toggleBulletList();
      break;
    case 'numbered':
      chain.toggleOrderedList();
      break;
    case 'checklist':
      chain.toggleTaskList();
      break;
    case 'quote':
      chain.setBlockquote();
      break;
    case 'code':
      chain.setCodeBlock();
      break;
  }
  chain.run();
}

/** The caret's line as Markdown, without its block marker. */
function lineMarkdown(state: EditorState): string {
  const json = state.selection.$from.parent.toJSON() as DocNode;
  return inlineToMarkdown(json.content);
}

/** The caret to the end of its line. */
function toLineEnd(editor: Editor) {
  editor
    .chain()
    .focus()
    .setTextSelection(editor.state.selection.$from.end())
    .run();
}

/** Spaces at the end of the caret's line go, as the textarea's did. */
function trimLineEnd(editor: Editor) {
  const { $from } = editor.state.selection;
  const text = $from.parent.textContent;
  const spaces = text.length - text.trimEnd().length;
  if (spaces === 0) return;
  const end = $from.end();
  editor.commands.deleteRange({ from: end - spaces, to: end });
}

/** Take the caret's line out: its list item, or the list or quote it was. */
function removeLine(editor: Editor) {
  const { state } = editor;
  const { $from } = state.selection;
  let depth = $from.depth;
  const parent = (d: number) => $from.node(d - 1);
  if (depth > 1 && ITEMS.has(parent(depth).type.name)) depth--;
  if (depth > 1 && parent(depth).childCount === 1) depth--;
  const from = $from.before(depth);
  const to = $from.after(depth);
  const { tr } = state;
  if (depth === 1 && state.doc.childCount === 1) {
    tr.replaceWith(from, to, state.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, 1));
  } else {
    tr.delete(from, to);
    tr.setSelection(
      TextSelection.near(
        tr.doc.resolve(Math.min(from, tr.doc.content.size)),
        -1,
      ),
    );
  }
  editor.view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
}

/**
 * Run a `/` command (or its key) at the caret. A create command asks
 * `make` first, with the line's text, and changes the line only when it
 * made something (or the line was empty).
 */
export function runCommand(
  editor: Editor,
  id: CommandId,
  ctx: Context,
  arg: string,
  make: (id: CreateCommandId, line: string) => boolean,
) {
  const plan = planCommand(id, ctx, arg);
  if ('block' in plan) {
    setLineKind(editor, plan.block);
    return;
  }
  if ('divider' in plan) {
    editor.chain().focus().setHorizontalRule().run();
    return;
  }
  if ('insert' in plan) {
    editor
      .chain()
      .focus()
      .insertContent({ type: 'text', text: plan.insert })
      .run();
    return;
  }
  const line = lineMarkdown(editor.state).trim();
  if (line && !make(plan.create, line)) return;
  switch (plan.line) {
    case 'checklist':
      if (!editor.isActive('taskList')) setLineKind(editor, 'checklist');
      trimLineEnd(editor);
      toLineEnd(editor);
      break;
    case 'mention': {
      if (!line) break;
      const { $from } = editor.state.selection;
      const text = personLine(line);
      editor
        .chain()
        .focus()
        .insertContentAt(
          { from: $from.start(), to: $from.end() },
          { type: 'text', text },
        )
        .run();
      break;
    }
    case 'remove':
      if (line) removeLine(editor);
      break;
    default:
      toLineEnd(editor);
  }
}

/**
 * Put a document's blocks in at the caret. Pasted, they join the line
 * they land in, as a paste does. A template goes in place of an empty
 * line, otherwise from the next line, with the caret after it.
 */
export function insertDoc(
  editor: Editor,
  doc: DocNode,
  { template = false }: { template?: boolean } = {},
) {
  const { state } = editor;
  const fragment = Fragment.fromJSON(state.schema, doc.content ?? []);
  const { tr } = state;
  if (!template) {
    tr.replaceSelection(Slice.maxOpen(fragment));
  } else {
    const { $from } = state.selection;
    const block = $from.node(1);
    const empty = block.type.name === 'paragraph' && block.content.size === 0;
    const from = empty ? $from.before(1) : $from.after(1);
    const to = empty ? $from.after(1) : from;
    tr.replaceWith(from, to, fragment);
    const end = Math.min(from + fragment.size, tr.doc.content.size);
    tr.setSelection(TextSelection.near(tr.doc.resolve(end), -1));
  }
  editor.view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
}

/** ⌘K in a link takes the link off; true when it did. */
export function toggleLinkAt(editor: Editor): boolean {
  if (!editor.isActive('link')) return false;
  editor.chain().focus().extendMarkRange('link').unsetMark('link').run();
  return true;
}

/** Link the range to `href`; an empty range gets the address as its text. */
export function setLink(
  editor: Editor,
  range: { from: number; to: number },
  href: string,
) {
  const chain = editor.chain().focus();
  if (range.from === range.to) {
    chain
      .insertContentAt(range.from, {
        type: 'text',
        text: href,
        marks: [{ type: 'link', attrs: { href } }],
      })
      .unsetMark('link')
      .run();
    return;
  }
  chain
    .setTextSelection(range)
    .setMark('link', { href })
    .setTextSelection(range.to)
    .run();
}

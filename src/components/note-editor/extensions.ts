import {
  type AnyExtension,
  Extension,
  InputRule,
  Mark,
  markInputRule,
  mergeAttributes,
  Node,
} from '@tiptap/core';
import Blockquote from '@tiptap/extension-blockquote';
import Bold from '@tiptap/extension-bold';
import Code from '@tiptap/extension-code';
import CodeBlock from '@tiptap/extension-code-block';
import Document from '@tiptap/extension-document';
import Heading from '@tiptap/extension-heading';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import Italic, {
  starInputRegex,
  underscoreInputRegex,
} from '@tiptap/extension-italic';
import {
  BulletList,
  ListItem,
  ListKeymap,
  OrderedList,
  TaskItem,
  TaskList,
} from '@tiptap/extension-list';
import Paragraph from '@tiptap/extension-paragraph';
import Strike from '@tiptap/extension-strike';
import Text from '@tiptap/extension-text';
import {
  Dropcursor,
  Gapcursor,
  Placeholder,
  UndoRedo,
} from '@tiptap/extensions';
import { Plugin } from '@tiptap/pm/state';
import { safeHref } from '#shared/markdown';
import { type DocNode, docToMarkdown } from '#shared/note-doc';

/**
 * The note editor's schema (#376): exactly what `shared/markdown.ts`
 * reads, no more. One paragraph per line, lists of single lines (no
 * nesting), quotes of plain lines, and the marks bold, italic, strike,
 * code and link, plus mentions. The attributes that are not shown
 * (`marker`, `delim`) keep how a line was written, so it is stored the
 * same way (`shared/note-doc.ts`).
 *
 * The formatting keys are the composer's own (`FORMAT_SHORTCUTS`), so the
 * extensions' default keys go, except the ones that move around lists
 * and code blocks.
 */

/** An extension with some of its default keys taken away. */
function withoutKeys<T extends AnyExtension>(ext: T, drop: string[]): T {
  return ext.extend({
    addKeyboardShortcuts() {
      const keys = { ...(this.parent?.() ?? {}) };
      for (const k of drop) delete keys[k];
      return keys;
    },
  }) as T;
}

/** An extension with none of its default keys. */
function noKeys<T extends AnyExtension>(ext: T): T {
  return ext.extend({ addKeyboardShortcuts: () => ({}) }) as T;
}

const hidden = (fallback: string) => ({
  default: fallback,
  rendered: false,
  keepOnSplit: true,
});

/** `@Name`, a person picked from the `@` menu. */
const Mention = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return {
      id: { default: null, rendered: false },
      label: { default: '', rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: 'span.mention[data-label]' }];
  },
  renderHTML({ node }) {
    return [
      'span',
      {
        class: 'mention',
        'data-person': node.attrs.id ?? undefined,
        'data-label': node.attrs.label,
      },
      `@${node.attrs.label}`,
    ];
  },
  renderText({ node }) {
    return `@${node.attrs.label}`;
  },
});

/** `[label](https://…)` typed out becomes a link. */
const LINK_TYPED = /\[([^\]\n]+)\]\(([^)\s]+)\)$/;

/**
 * A link: `[label](url)`. Tiptap's own link extension does far more
 * (autolinking, link on paste, opening on click) than notes want, and
 * brings a URL parser with it; bare URLs stay text, as they are stored.
 */
const Link = Mark.create({
  name: 'link',
  inclusive: false,
  addAttributes() {
    return { href: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'a[href]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['a', HTMLAttributes, 0];
  },
  addInputRules() {
    return [
      new InputRule({
        find: LINK_TYPED,
        handler: ({ state, range, match }) => {
          const href = safeHref(match[2] ?? '');
          const label = match[1] ?? '';
          if (!href || !label) return null;
          state.tr
            .replaceWith(
              range.from,
              range.to,
              state.schema.text(label, [this.type.create({ href })]),
            )
            .removeStoredMark(this.type);
        },
      }),
    ];
  },
});

/** `- [ ] ` typed in a bulleted item makes it a checklist item. */
const BulletToTask = Extension.create({
  name: 'bulletToTask',
  addInputRules() {
    return [
      new InputRule({
        find: /^\[([ xX])?\]\s$/,
        handler: ({ range, match, chain, state }) => {
          const $from = state.doc.resolve(range.from);
          if ($from.node(-1)?.type.name !== 'listItem') return null;
          if ($from.node(-2)?.type.name !== 'bulletList') return null;
          chain()
            .deleteRange(range)
            .clearNodes()
            .toggleTaskList()
            .updateAttributes('taskItem', {
              checked: /x/i.test(match[1] ?? ''),
            })
            .run();
        },
      }),
    ];
  },
});

/**
 * Shift+Enter: a new line that does not carry on the list (a new line in
 * a code block). There are no line breaks inside a line.
 */
const ShiftEnter = Extension.create({
  name: 'shiftEnter',
  addKeyboardShortcuts() {
    return {
      'Shift-Enter': ({ editor }) => {
        if (editor.isActive('codeBlock')) {
          return editor.commands.newlineInCode();
        }
        for (const item of ['listItem', 'taskItem']) {
          if (editor.isActive(item)) {
            return editor.chain().splitListItem(item).liftListItem(item).run();
          }
        }
        return editor.commands.splitBlock();
      },
    };
  },
});

/** Tab in a list stays put: lists do not nest. */
const listTab = { Tab: () => true };

/**
 * A transaction that would store more than `max()` characters does not
 * happen, unless it makes the text shorter.
 */
function lengthLimit(max: () => number | undefined) {
  return Extension.create({
    name: 'lengthLimit',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          filterTransaction(tr, state) {
            const limit = max();
            if (!tr.docChanged || !limit || tr.getMeta('preventUpdate')) {
              return true;
            }
            const size = (doc: typeof state.doc) =>
              docToMarkdown(doc.toJSON() as DocNode).length;
            const next = size(tr.doc);
            return next <= limit || next < size(state.doc);
          },
        }),
      ];
    },
  });
}

export function noteExtensions({
  placeholder,
  maxLength,
}: {
  placeholder: () => string;
  maxLength: () => number | undefined;
}): AnyExtension[] {
  return [
    Document,
    noKeys(Paragraph),
    Text,
    noKeys(
      Heading.extend({
        renderHTML({ node, HTMLAttributes }) {
          const level = Math.min(Math.max(node.attrs.level, 1), 3);
          return [
            `h${level + 2}`,
            mergeAttributes(HTMLAttributes, { class: `note-h${level}` }),
            0,
          ];
        },
      }).configure({ levels: [1, 2, 3] }),
    ),
    noKeys(Blockquote.extend({ content: 'paragraph+' })),
    withoutKeys(CodeBlock.configure({ languageClassPrefix: 'language-' }), [
      'Mod-Alt-c',
    ]),
    HorizontalRule,
    noKeys(BulletList),
    noKeys(
      OrderedList.extend({
        addAttributes() {
          return { ...this.parent?.(), delim: hidden('.') };
        },
      }),
    ),
    ListItem.extend({
      content: 'paragraph',
      addAttributes() {
        return { marker: hidden('-') };
      },
      addKeyboardShortcuts() {
        return { ...this.parent?.(), ...listTab };
      },
    }),
    noKeys(TaskList),
    TaskItem.extend({
      content: 'paragraph',
      addAttributes() {
        return { ...this.parent?.(), marker: hidden('-') };
      },
      addKeyboardShortcuts() {
        return { ...this.parent?.(), ...listTab };
      },
    }).configure({
      nested: false,
      a11y: {
        checkboxLabel: (node, checked) => {
          const text = node.textBetween(0, node.content.size, ' ', (leaf) =>
            leaf.type.name === 'mention' ? `@${leaf.attrs.label}` : '',
          );
          return `${checked ? 'Done' : 'To do'}: ${text || 'empty item'}`;
        },
      },
    }),
    ListKeymap,
    BulletToTask,
    ShiftEnter,
    noKeys(Bold),
    noKeys(
      Italic.extend({
        addAttributes() {
          return { marker: { default: '_', rendered: false } };
        },
        addInputRules() {
          return [
            markInputRule({
              find: starInputRegex,
              type: this.type,
              getAttributes: () => ({ marker: '*' }),
            }),
            markInputRule({ find: underscoreInputRegex, type: this.type }),
          ];
        },
      }),
    ),
    noKeys(Strike),
    // Code can carry the other marks, as `**`code`**` does in Markdown.
    noKeys(Code.extend({ excludes: 'code' })),
    Link,
    Mention,
    UndoRedo,
    Dropcursor.configure({ class: 'note-drop' }),
    Gapcursor,
    Placeholder.configure({ placeholder }),
    lengthLimit(maxLength),
  ];
}

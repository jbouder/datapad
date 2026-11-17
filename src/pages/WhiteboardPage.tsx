import { GENERAL_BOARD, type Project } from '#shared/types';
import { Board } from '@/components/board/Board';
import { BoardMenu } from '@/components/board/BoardMenu';
import { useDatapad } from '@/hooks/useDatapad';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSpaces } from '@/providers/DatapadProvider';

/**
 * The space's own whiteboard (`/whiteboard`), full height below the top
 * bar, reached from All and ⌘K. A project's board is its room's
 * Whiteboard tab (#334): `ProjectBoard` and `ProjectBoardMenu` below,
 * in this same chunk.
 */
export function WhiteboardPage() {
  const { state } = useDatapad();
  const { current: space } = useSpaces();
  usePageTitle('Whiteboard');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-h-12 items-center gap-1 border-b px-2 sm:px-4">
        <h1 className="shrink-0 px-1 font-heading text-base font-semibold tracking-tight">
          Whiteboard
        </h1>
        {state && <BoardMenu boardId={GENERAL_BOARD} name={space.name} />}
      </header>
      {state ? (
        <Board boardId={GENERAL_BOARD} label="Space whiteboard" />
      ) : (
        <p className="px-4 pt-6 text-sm text-muted-foreground">Loading…</p>
      )}
    </div>
  );
}

/** A project's board, filling what its room leaves below the tabs. */
export function ProjectBoard({ project }: { project: Project }) {
  return (
    <Board boardId={project.id} label={`Whiteboard for ${project.name}`} />
  );
}

/** A project board's menu (export), at the end of the room's tabs. */
export function ProjectBoardMenu({ project }: { project: Project }) {
  return <BoardMenu boardId={project.id} name={project.name} />;
}

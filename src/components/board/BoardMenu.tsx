import {
  DotsThreeIcon,
  FileImageIcon,
  FileSvgIcon,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { itemsOf } from '#shared/board';
import {
  measureExportText,
  resolvePalette,
  saveBlob,
  svgBlob,
  svgToPng,
} from '@/components/board/download';
import { boardSvg, exportName } from '@/components/board/export';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDatapad } from '@/hooks/useDatapad';
import { useToast } from '@/providers/ToastProvider';

/** A menu row: 44px to a finger. */
const ROW = 'min-h-11 desk:min-h-0';

/**
 * The board's own menu, in its header: Download as PNG and Download as
 * SVG. The SVG is built from the items with the current theme's colors
 * resolved, so it opens anywhere; the PNG is that SVG drawn on a canvas
 * at 2×. Nothing leaves the device.
 */
export function BoardMenu({
  boardId,
  name,
}: {
  boardId: string;
  /** The board's name, for the file and the SVG's title. */
  name: string;
}) {
  const { state } = useDatapad();
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const items = state ? itemsOf(state.boardItems, boardId) : [];
  const empty = items.length === 0;

  const build = () =>
    boardSvg(items, {
      palette: resolvePalette(),
      title: `${name} whiteboard`,
      people: state?.people,
      measure: measureExportText,
    });

  const downloadSvg = () => {
    const out = build();
    if (!out) return;
    saveBlob(exportName(name, 'svg'), svgBlob(out.svg));
  };

  const downloadPng = async () => {
    const out = build();
    if (!out) return;
    setBusy(true);
    try {
      saveBlob(
        exportName(name, 'png'),
        await svgToPng(out.svg, out.width, out.height),
      );
    } catch {
      show('Could not make the PNG. Try Download as SVG.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="press ml-auto flex size-11 shrink-0 items-center justify-center outline-ring/50 transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 desk:size-9"
            aria-label="Board menu"
            title="Board menu"
          />
        }
      >
        <DotsThreeIcon aria-hidden className="size-5" weight="bold" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {empty ? 'Nothing to download yet' : 'Download'}
          </DropdownMenuLabel>
          <DropdownMenuItem
            className={ROW}
            disabled={empty || busy}
            onClick={() => void downloadPng()}
          >
            <FileImageIcon aria-hidden />
            Download as PNG
          </DropdownMenuItem>
          <DropdownMenuItem
            className={ROW}
            disabled={empty}
            onClick={downloadSvg}
          >
            <FileSvgIcon aria-hidden />
            Download as SVG
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

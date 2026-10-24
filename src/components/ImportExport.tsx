import {
  type ChangeEvent,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { localDate } from '#shared/dates';
import {
  type Counts,
  countDocuments,
  describeIssue,
  ExportSchema,
  issuePath,
} from '#shared/protocol';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { fetchExport, postImport, SignedOutError } from '@/lib/api';
import { useToast } from '@/providers/ToastProvider';

/**
 * Export (a plain file download, clipboard as the fallback) and Import (a
 * file picker, validated here first, confirmed, then merged by id on the
 * server). The import accepts the artifact's `ledger-*.json` unchanged.
 */

/** "14 projects, 212 tasks, 96 notes, 31 events, 9 people". */
export function describeCounts(counts: Counts): string {
  const n = (count: number, one: string, many: string) =>
    `${count} ${count === 1 ? one : many}`;
  return [
    n(counts.projects, 'project', 'projects'),
    n(counts.tasks, 'task', 'tasks'),
    n(counts.notes, 'note', 'notes'),
    n(counts.events, 'event', 'events'),
    n(counts.people, 'person', 'people'),
  ].join(', ');
}

function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  // Give the download a moment to start before the URL goes.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

interface Proposal {
  name: string;
  file: unknown;
  counts: Counts;
}

function useImportExportState() {
  const { show } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);

  const failed = useCallback(
    (error: unknown, fallback: string) => {
      if (error instanceof SignedOutError) {
        window.location.reload();
        return;
      }
      show(error instanceof Error && error.message ? error.message : fallback);
    },
    [show],
  );

  const exportNow = useCallback(async () => {
    let text: string;
    try {
      text = await fetchExport();
    } catch (error) {
      failed(error, 'Export failed. Try again.');
      return;
    }
    const name = `datapad-${localDate(new Date())}.json`;
    try {
      saveFile(name, text);
      show(`Exported ${name}`);
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        show('Could not save a file, so the export is on your clipboard');
      } catch {
        show('Export failed: no download and no clipboard here');
      }
    }
  }, [failed, show]);

  const chooseImport = useCallback(() => {
    input.current?.click();
  }, []);

  const onFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const picked = event.target.files?.[0];
      event.target.value = ''; // the same file can be picked again
      if (!picked) return;
      let file: unknown;
      try {
        file = JSON.parse(await picked.text());
      } catch {
        show(`${picked.name} is not JSON`);
        return;
      }
      const parsed = ExportSchema.safeParse(file);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        show(
          issue
            ? `Not imported. ${issuePath(issue)}: ${describeIssue(issue)}`
            : 'Not imported: that is not a Datapad export',
        );
        return;
      }
      const { exportedAt: _, ...documents } = parsed.data;
      setProposal({
        name: picked.name,
        file,
        counts: countDocuments(documents),
      });
    },
    [show],
  );

  const confirm = useCallback(async () => {
    if (!proposal) return;
    setBusy(true);
    try {
      const result = await postImport(proposal.file);
      setProposal(null);
      show(`Imported ${describeCounts(result.imported)}`);
    } catch (error) {
      failed(error, 'Import failed. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }, [proposal, failed, show]);

  const element = (
    <>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={onFile}
      />
      <Dialog
        open={proposal !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setProposal(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import {proposal?.name}?</DialogTitle>
            <DialogDescription>
              Import {proposal ? describeCounts(proposal.counts) : ''}; same ids
              are replaced. Everything else you have stays.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />} disabled={busy}>
              Cancel
            </DialogClose>
            <Button onClick={confirm} disabled={busy}>
              {busy ? 'Importing…' : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  return { exportNow, chooseImport, element };
}

interface ImportExport {
  exportNow: () => Promise<void>;
  /** Opens the file picker. Call from a click (it needs the gesture). */
  chooseImport: () => void;
}

const ImportExportContext = createContext<ImportExport | null>(null);

/**
 * One file picker and one confirmation dialog for the whole app, so the
 * rail footer and the Preferences menu share them.
 */
export function ImportExportProvider({ children }: { children: ReactNode }) {
  const { exportNow, chooseImport, element } = useImportExportState();
  const value = useMemo(
    () => ({ exportNow, chooseImport }),
    [exportNow, chooseImport],
  );
  return (
    <ImportExportContext.Provider value={value}>
      {children}
      {element}
    </ImportExportContext.Provider>
  );
}

export function useImportExport(): ImportExport {
  const value = useContext(ImportExportContext);
  if (!value) {
    throw new Error('useImportExport must be used inside ImportExportProvider');
  }
  return value;
}

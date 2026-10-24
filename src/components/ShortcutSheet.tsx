import { ShortcutList } from '@/components/ShortcutList';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { linkProps } from '@/lib/router';

/**
 * `?`: every shortcut, from the one list in `src/lib/shortcuts.ts`, and
 * the way to the Help page.
 */
export function ShortcutSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Single letters work when you are not typing and nothing is open.
          </DialogDescription>
        </DialogHeader>
        <ShortcutList />
        <p className="text-sm">
          The rest, from Markdown to backups, is in{' '}
          <a
            {...linkProps({ name: 'help', section: 'keyboard' })}
            onClickCapture={() => onOpenChange(false)}
            className="underline underline-offset-4"
          >
            Help
          </a>
          .
        </p>
      </DialogContent>
    </Dialog>
  );
}

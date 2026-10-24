import { ShortcutList } from '@/components/ShortcutList';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** `?`: every shortcut, from the one list in `src/lib/shortcuts.ts`. */
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
      </DialogContent>
    </Dialog>
  );
}

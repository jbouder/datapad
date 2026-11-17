import { removeQuestion } from '@/components/people/PersonForm';
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

/**
 * Remove on a person's room's menu (#335): asks first, the same question
 * the person form's Remove asks.
 */
export function RemovePersonDialog({
  open,
  onOpenChange,
  name,
  assigned,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  /** How many tasks are assigned to them. */
  assigned: number;
  onRemove: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove person</DialogTitle>
          <DialogDescription>
            {removeQuestion(name, assigned)}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose
            render={
              <Button
                type="button"
                variant="outline"
                className="h-11 desk:h-8"
              />
            }
          >
            Keep them
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            className="press h-11 desk:h-8"
            onClick={onRemove}
          >
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

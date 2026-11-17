import { deleteQuestion } from '@/components/projects/ProjectForm';
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
 * Delete on a project room's menu (#334): asks first, naming what goes
 * with it, the same question the project form's Delete asks.
 */
export function DeleteProjectDialog({
  open,
  onOpenChange,
  name,
  tasks,
  notes,
  milestones,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  tasks: number;
  notes: number;
  milestones: number;
  onDelete: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete project</DialogTitle>
          <DialogDescription>
            {deleteQuestion(name, tasks, notes, milestones)} This cannot be
            undone.
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
            Cancel
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            className="press h-11 desk:h-8"
            onClick={onDelete}
          >
            Delete project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

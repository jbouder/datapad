import { FolderPlusIcon, PlusIcon, UserPlusIcon } from '@phosphor-icons/react';
import { useNewPerson } from '@/components/people/useNewPerson';
import { useProjectForm } from '@/components/projects/ProjectFormProvider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/** A menu row: 44px to a finger. */
const ROW = 'min-h-11 desk:min-h-0';

/**
 * Add a room where the rooms are: the `+` beside Rooms in the rail and on
 * the phone's Rooms page. New project opens the project form; New person
 * opens the person form. Either one lands in the new room on save.
 */
export function AddRoomMenu({ className }: { className?: string }) {
  const { openProjectForm } = useProjectForm();
  const newPerson = useNewPerson();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Add a room"
              title="Add a room"
              className={cn('press text-muted-foreground', className)}
            />
          }
        >
          <PlusIcon weight="bold" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem className={ROW} onClick={() => openProjectForm()}>
            <FolderPlusIcon />
            New project
          </DropdownMenuItem>
          <DropdownMenuItem className={ROW} onClick={newPerson.open}>
            <UserPlusIcon />
            New person
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {newPerson.form}
    </>
  );
}

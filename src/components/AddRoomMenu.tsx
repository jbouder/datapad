import { FolderPlusIcon, PlusIcon, UserPlusIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { PersonForm } from '@/components/people/PersonForm';
import { useProjectForm } from '@/components/projects/ProjectFormProvider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { navigate } from '@/lib/router';
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
  // A new session each time, so the form starts empty.
  const [person, setPerson] = useState<{ key: number; open: boolean } | null>(
    null,
  );

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
          <DropdownMenuItem
            className={ROW}
            onClick={() => setPerson({ key: Date.now(), open: true })}
          >
            <UserPlusIcon />
            New person
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {person && (
        <PersonForm
          key={person.key}
          open={person.open}
          onClose={() => setPerson((p) => (p ? { ...p, open: false } : p))}
          onExited={() => setPerson((p) => (p?.open ? p : null))}
          onAdded={(id) => navigate({ name: 'person', id })}
        />
      )}
    </>
  );
}

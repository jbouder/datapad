import { AppShell } from '@/components/AppShell';
import { EventFormProvider } from '@/components/events/EventFormProvider';
import { EventNotesProvider } from '@/components/events/EventNotesProvider';
import { ImportExportProvider } from '@/components/ImportExport';
import { NotesProvider } from '@/components/notes/NotesProvider';
import { ProjectFormProvider } from '@/components/projects/ProjectFormProvider';
import { SummaryProvider } from '@/components/summary/SummaryProvider';
import { TaskPanelProvider } from '@/components/tasks/TaskPanelProvider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DatapadProvider } from '@/providers/DatapadProvider';
import { MotionProvider } from '@/providers/MotionProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { ToastProvider } from '@/providers/ToastProvider';

export default function App() {
  return (
    <MotionProvider>
      <ThemeProvider>
        <TooltipProvider>
          <ToastProvider>
            <DatapadProvider>
              <ImportExportProvider>
                <SummaryProvider>
                  <ProjectFormProvider>
                    <TaskPanelProvider>
                      <EventFormProvider>
                        <EventNotesProvider>
                          <NotesProvider>
                            <AppShell />
                          </NotesProvider>
                        </EventNotesProvider>
                      </EventFormProvider>
                    </TaskPanelProvider>
                  </ProjectFormProvider>
                </SummaryProvider>
              </ImportExportProvider>
            </DatapadProvider>
          </ToastProvider>
        </TooltipProvider>
      </ThemeProvider>
    </MotionProvider>
  );
}

import { AppShell } from '@/components/AppShell';
import { ImportExportProvider } from '@/components/ImportExport';
import { MeetingFormProvider } from '@/components/meetings/MeetingFormProvider';
import { NotesProvider } from '@/components/notes/NotesProvider';
import { ProjectFormProvider } from '@/components/projects/ProjectFormProvider';
import { NewSpaceProvider } from '@/components/SpaceSwitcher';
import { SummaryProvider } from '@/components/summary/SummaryProvider';
import { BlockedProvider } from '@/components/tasks/BlockedProvider';
import { TaskPanelProvider } from '@/components/tasks/TaskPanelProvider';
import { TemplateFormProvider } from '@/components/templates/TemplateFormProvider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DatapadProvider } from '@/providers/DatapadProvider';
import { MotionProvider } from '@/providers/MotionProvider';
import { PagePrefsProvider } from '@/providers/PagePrefsProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { ToastProvider } from '@/providers/ToastProvider';

export default function App() {
  return (
    <MotionProvider>
      <ThemeProvider>
        <TooltipProvider>
          <ToastProvider>
            <DatapadProvider>
              <PagePrefsProvider>
                <NewSpaceProvider>
                  <ImportExportProvider>
                    <SummaryProvider>
                      <BlockedProvider>
                        <TemplateFormProvider>
                          <ProjectFormProvider>
                            <NotesProvider>
                              <TaskPanelProvider>
                                <MeetingFormProvider>
                                  <AppShell />
                                </MeetingFormProvider>
                              </TaskPanelProvider>
                            </NotesProvider>
                          </ProjectFormProvider>
                        </TemplateFormProvider>
                      </BlockedProvider>
                    </SummaryProvider>
                  </ImportExportProvider>
                </NewSpaceProvider>
              </PagePrefsProvider>
            </DatapadProvider>
          </ToastProvider>
        </TooltipProvider>
      </ThemeProvider>
    </MotionProvider>
  );
}

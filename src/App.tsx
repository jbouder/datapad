import { AppShell } from '@/components/AppShell';
import { DecisionPanelProvider } from '@/components/decisions/DecisionPanelProvider';
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
import { ThemeProvider } from '@/providers/ThemeProvider';
import { ToastProvider } from '@/providers/ToastProvider';

export default function App() {
  return (
    <MotionProvider>
      <ThemeProvider>
        <TooltipProvider>
          <ToastProvider>
            <DatapadProvider>
              <NewSpaceProvider>
                <ImportExportProvider>
                  <SummaryProvider>
                    <BlockedProvider>
                      <DecisionPanelProvider>
                        <TemplateFormProvider>
                          <ProjectFormProvider>
                            <TaskPanelProvider>
                              <MeetingFormProvider>
                                <NotesProvider>
                                  <AppShell />
                                </NotesProvider>
                              </MeetingFormProvider>
                            </TaskPanelProvider>
                          </ProjectFormProvider>
                        </TemplateFormProvider>
                      </DecisionPanelProvider>
                    </BlockedProvider>
                  </SummaryProvider>
                </ImportExportProvider>
              </NewSpaceProvider>
            </DatapadProvider>
          </ToastProvider>
        </TooltipProvider>
      </ThemeProvider>
    </MotionProvider>
  );
}

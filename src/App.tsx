import { lazy, Suspense } from 'react';
import { AppShell } from '@/components/AppShell';
import {
  AppError,
  CrashForTests,
  ErrorBoundary,
  SignedOutPage,
} from '@/components/ErrorBoundary';
import { ImportExportProvider } from '@/components/ImportExport';
import { ListPanelProvider } from '@/components/lists/ListPanelProvider';
import { MeetingFormProvider } from '@/components/meetings/MeetingFormProvider';
import { NotesProvider } from '@/components/notes/NotesProvider';
import { ProjectFormProvider } from '@/components/projects/ProjectFormProvider';
import { NewSpaceProvider } from '@/components/SpaceSwitcher';
import { SummaryProvider } from '@/components/summary/SummaryProvider';
import { BlockedProvider } from '@/components/tasks/BlockedProvider';
import { TaskPanelProvider } from '@/components/tasks/TaskPanelProvider';
import { TemplateFormProvider } from '@/components/templates/TemplateFormProvider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useSignedOut } from '@/lib/session';
import { DatapadProvider } from '@/providers/DatapadProvider';
import { MotionProvider } from '@/providers/MotionProvider';
import { PagePrefsProvider } from '@/providers/PagePrefsProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { ToastProvider } from '@/providers/ToastProvider';
import { isV2Path } from '@/v2/nav';

export default function App() {
  return (
    <MotionProvider>
      <ThemeProvider>
        <TooltipProvider>
          <ErrorBoundary where="app" fallback={() => <AppError />}>
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
                                    <ListPanelProvider>
                                      <Shell />
                                    </ListPanelProvider>
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
          </ErrorBoundary>
        </TooltipProvider>
      </ThemeProvider>
    </MotionProvider>
  );
}

/** Prototype: Day, Rooms, Library (`src/v2`), at `/v2`. */
const V2App = lazy(() => import('@/v2/V2App'));

/** The app, or "Sign in again" once the Access session has ended. */
function Shell() {
  const signedOut = useSignedOut();
  return (
    <>
      {signedOut ? (
        <SignedOutPage />
      ) : isV2Path(window.location.pathname) ? (
        <Suspense fallback={null}>
          <V2App />
        </Suspense>
      ) : (
        <AppShell />
      )}
      {__DEV_ROUTES__ && <CrashForTests where="app" />}
    </>
  );
}

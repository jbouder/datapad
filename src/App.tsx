import { AppShell } from '@/components/AppShell';
import { ImportExportProvider } from '@/components/ImportExport';
import { ProjectFormProvider } from '@/components/projects/ProjectFormProvider';
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
                <ProjectFormProvider>
                  <AppShell />
                </ProjectFormProvider>
              </ImportExportProvider>
            </DatapadProvider>
          </ToastProvider>
        </TooltipProvider>
      </ThemeProvider>
    </MotionProvider>
  );
}

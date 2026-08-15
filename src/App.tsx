// NOTE: This file should normally not be modified unless you are adding a new provider.
// To add new routes, edit the AppRouter.tsx file.

import { createHead, UnheadProvider } from '@unhead/react/client';
import { InferSeoMetaPlugin } from '@unhead/addons';
import { Suspense } from 'react';
import { TooltipProvider } from "@/components/ui/tooltip";
import AppRouter from './AppRouter';

const head = createHead({
  plugins: [
    InferSeoMetaPlugin(),
  ],
});

export function App() {
  return (
    <UnheadProvider head={head}>
      <TooltipProvider>
        <Suspense>
          <AppRouter />
        </Suspense>
      </TooltipProvider>
    </UnheadProvider>
  );
}

export default App;

import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ScrollToTop } from "./components/ScrollToTop";

import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Privacy from "./pages/Privacy";

export function AppRouter() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Index />} />
        {/* On GitHub Pages, a direct (non-app-navigated) request to this
            path - e.g. Google Play's own automated check of the privacy
            policy URL - is served by dist/privacy.html, a copy of
            index.html the build script produces alongside dist/404.html
            (see package.json's build/test scripts). Without that file this
            path 404s at the HTTP layer for anyone who didn't arrive via
            in-app client-side navigation, even though the SPA fallback
            (404.html) would still render the right content once its JS
            loads - some automated URL checks look at the raw status code
            and stop there. */}
        <Route path="/privacy" element={<Privacy />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
export default AppRouter;

import { useSeoMeta } from '@unhead/react';
import { useLocation, useNavigate } from 'react-router-dom';

const EFFECTIVE_DATE = 'September 9, 2026';
const CONTACT_EMAIL = 'contact@armadagames.tech';

// A plain, standalone route (not gated behind showTitleScreen or any other
// game state) so it's reachable both from a link inside the app's own
// Settings menu and directly from the Play Store listing / AdMob console,
// as Google Play's developer policies require. Same policy covers the
// Android app and this GitHub Pages web build - one codebase, one set of
// data practices.
function Privacy() {
  useSeoMeta({
    title: 'Armada Privacy Policy',
    description: "How the Armada naval combat game collects, uses, and doesn't collect your data.",
  });
  const navigate = useNavigate();
  const location = useLocation();

  // location.key is only 'default' for the very first entry in this tab's
  // history - a fresh/direct visit to this page (e.g. someone opening the
  // privacy policy link from the Play Store listing, who was never "in"
  // the app to begin with). There's nothing in-app to go back to in that
  // case, so the link is hidden entirely rather than showing a "Back"
  // control that visibly does nothing when clicked - the browser's own
  // back button already does the right thing for that visitor. Reached
  // via in-app navigation (the Settings menu), location.key is always a
  // real pushed entry, and navigate(-1) correctly returns to the game
  // rather than hardcoding a destination that would be wrong for the
  // direct-visit case (it used to always link to "/", which meant a
  // browser visitor following the Play Store's privacy policy link and
  // clicking this ended up on the GitHub Pages web build of the game
  // instead of back wherever they actually came from).
  const canGoBack = location.key !== 'default';

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-slate-300">
      <div className="mx-auto max-w-2xl">
        {canGoBack ? (
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-400 hover:text-cyan-300"
          >
            &larr; Back to Armada
          </button>
        ) : null}

        <h1 className="mt-6 text-3xl font-bold text-white">Privacy Policy</h1>
        <p className="mt-2 text-sm text-slate-400">Effective {EFFECTIVE_DATE}</p>

        <div className="mt-8 space-y-8 leading-relaxed">
          <section>
            <p>
              Armada is a naval combat game published by Armada Games ("we", "us"). This policy explains what
              information the app collects, how it's used, and the choices you have - for both the Android app on
              Google Play and this web version.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-cyan-300">Information we do not collect</h2>
            <p className="mt-2">
              Armada has no account system - you're never asked for your name, email address, or any other
              personal information to play. The app doesn't request your location, contacts, photos, camera, or
              microphone, and no gameplay data is ever sent to us: there's no server on our end, and no way for us
              to identify who's playing.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-cyan-300">Information stored on your device</h2>
            <p className="mt-2">
              Your progress - ship placements, weapon inventories, settings like the Singles toggle, and your
              lifetime statistics - is saved only in local storage on your own device or browser. It never leaves
              your device, and we never see it. Uninstalling the app, or clearing its storage, permanently deletes
              it.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-cyan-300">Advertising</h2>
            <p className="mt-2">
              Armada offers optional rewarded video ads: watching one grants extra weapon charges or an extra game,
              entirely by your choice - the app never shows an ad without you first agreeing to watch one. These
              ads are served by Google AdMob. To show and measure ads, Google's Mobile Ads SDK may collect device
              identifiers (such as your Android Advertising ID), IP address, and general device and app usage
              information, and may use that information to personalize the ads you see unless you've limited ad
              tracking (see "Your choices" below). We don't control what Google collects for this purpose - see
              Google's{' '}
              <a
                href="https://policies.google.com/privacy"
                target="_blank"
                rel="noreferrer"
                className="text-cyan-400 underline hover:text-cyan-300"
              >
                Privacy Policy
              </a>{' '}
              and its page on{' '}
              <a
                href="https://policies.google.com/technologies/partner-sites"
                target="_blank"
                rel="noreferrer"
                className="text-cyan-400 underline hover:text-cyan-300"
              >
                how it uses information from sites and apps that use its services
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-cyan-300">Your choices</h2>
            <p className="mt-2">You can opt out of personalized advertising at any time:</p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>
                On Android: Settings &gt; Google &gt; Ads &gt; "Opt out of Ads Personalization" (exact wording
                varies by Android version).
              </li>
              <li>
                Or visit Google's{' '}
                <a
                  href="https://adssettings.google.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan-400 underline hover:text-cyan-300"
                >
                  Ads Settings
                </a>
                .
              </li>
            </ul>
            <p className="mt-2">Opting out doesn't reduce how many ads you see - it only stops them from being personalized to you.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-cyan-300">Children's privacy</h2>
            <p className="mt-2">
              Armada is not directed at children under 13, and we do not knowingly collect personal information
              from children. If you believe a child has provided us with personal information, contact us below
              and we'll address it.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-cyan-300">Data security</h2>
            <p className="mt-2">
              Because we don't operate a server or collect personal data, there's no account or database of yours
              to secure. Data stored on your device is protected by your device's own operating system and app
              sandboxing.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-cyan-300">Changes to this policy</h2>
            <p className="mt-2">
              We may update this policy as the app changes - for example, if a new feature uses data differently.
              The "Effective date" above will always reflect the latest version.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-cyan-300">Contact us</h2>
            <p className="mt-2">
              Questions about this policy? Email{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-cyan-400 underline hover:text-cyan-300">
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

export default Privacy;

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';

// Regression coverage for a reported bug: on mobile, clicking New Game could
// leave the swipe carousel between "My Navy" and "Enemy Navy" showing a
// sliver of both panels instead of snapping cleanly to one. The root cause
// was that the carousel's CSS transition (`transition-transform
// duration-1000 ease-out`) applied unconditionally, so every *programmatic*
// activeView reset (initial load, New Game) animated over a full second just
// like a manual swipe does - long enough that a screenshot or a glance right
// after the click could catch it mid-slide. The fix suppresses that
// transition for programmatic resets (see `instantViewSwitch` in Index.tsx)
// while leaving it in place for an actual manual swipe.
function getSwipeWrapper(container: HTMLElement): HTMLDivElement {
  const wrapper = Array.from(container.querySelectorAll('div')).find((el) =>
    el.className.includes('w-[200%]'),
  );
  if (!wrapper) {
    throw new Error('swipe carousel wrapper not found - is the mobile layout active?');
  }
  return wrapper as HTMLDivElement;
}

// The title screen is the first thing every fresh mount renders (see
// showTitleScreen in Index.tsx) and has to be dismissed before any of the
// board/carousel is on screen to interact with.
function dismissTitleScreen() {
  fireEvent.click(screen.getByRole('button', { name: 'Play' }));
}

describe('mobile swipe carousel view switching', () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.clear();
    randomSpy = vi.spyOn(Math, 'random');
  });

  afterEach(() => {
    randomSpy.mockRestore();
    window.localStorage.clear();
  });

  // createGameState's very first Math.random() call is the 50/50
  // currentTurn coin flip, made before createNavy's own (many) calls for
  // ship placement - overriding just that one call forces a predictable
  // starting activeView ('player', since currentTurn 'app' maps to it)
  // without touching ship placement's own randomness.
  function forcePlayerViewNextGame() {
    randomSpy.mockReturnValueOnce(0.9);
  }

  it('does not animate the very first view placement on mount', async () => {
    forcePlayerViewNextGame();
    const { container } = render(<App />);
    dismissTitleScreen();
    const wrapper = getSwipeWrapper(container);
    expect(wrapper.className).not.toContain('transition-transform');

    // Settles back to animated once the instant snap has had a chance to
    // paint, so a later manual swipe still slides as expected.
    await waitFor(() => expect(wrapper.className).toContain('transition-transform'));
  });

  it('keeps the transition enabled for a manual swipe via the arrow buttons', async () => {
    forcePlayerViewNextGame();
    const { container } = render(<App />);
    dismissTitleScreen();
    const wrapper = getSwipeWrapper(container);
    await waitFor(() => expect(wrapper.className).toContain('transition-transform'));

    fireEvent.click(screen.getByLabelText('Show enemy navy'));

    expect(wrapper.className).toContain('transition-transform');
  });

  it('snaps instantly, without animating, when New Game resets the active view', async () => {
    forcePlayerViewNextGame();
    const { container } = render(<App />);
    dismissTitleScreen();
    const wrapper = getSwipeWrapper(container);
    await waitFor(() => expect(wrapper.className).toContain('transition-transform'));

    // Swipe over to the enemy panel first, same as the reported scenario.
    fireEvent.click(screen.getByLabelText('Show enemy navy'));
    await waitFor(() => expect(wrapper.style.transform).toContain('-50%'));

    forcePlayerViewNextGame();
    const settingsButton = screen.getAllByLabelText('Open settings')[0];
    // Radix's DropdownMenuTrigger opens on pointerdown, gated on
    // `event.button === 0 && event.ctrlKey === false` - fireEvent's default
    // PointerEvent leaves ctrlKey undefined, which fails that check unless
    // it's set explicitly.
    fireEvent.pointerDown(settingsButton, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByText('New Game'));

    // The reset snaps straight back to the new game's starting view (player)
    // with no transition class present in that same update.
    expect(wrapper.style.transform).not.toContain('-50%');
    expect(wrapper.className).not.toContain('transition-transform');

    // And the transition re-arms afterward, for the next manual swipe.
    await waitFor(() => expect(wrapper.className).toContain('transition-transform'));
  });
});

// Google Play requires the privacy policy to be linked from within the app
// itself, not just the store listing - this covers that link actually
// reaching the standalone /privacy route (see AppRouter.tsx, Privacy.tsx).
describe('Privacy Policy navigation', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    // Restore a clean starting URL for any tests that run after this block.
    // import.meta.env.BASE_URL is "/" under vitest regardless of the "/armada/"
    // base the real GitHub Pages build uses - Vite only applies that to an
    // actual build/dev-server, not to Vitest's env injection - so BrowserRouter's
    // basename here is "/" and paths in this describe block are bare, unprefixed.
    window.history.pushState(null, '', '/');
  });

  it('opens the Privacy Policy page from the Settings menu, with a working Back link', async () => {
    render(<App />);
    dismissTitleScreen();

    const settingsButton = screen.getAllByLabelText('Open settings')[0];
    fireEvent.pointerDown(settingsButton, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByText('Privacy Policy'));

    expect(await screen.findByRole('heading', { name: 'Privacy Policy' })).toBeInTheDocument();
    expect(screen.getByText('contact@armadagames.tech')).toBeInTheDocument();

    // Reached via in-app navigation, so there's somewhere real to go back
    // to - the Back link should be there, and should actually work.
    fireEvent.click(screen.getByText('← Back to Armada'));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Privacy Policy' })).not.toBeInTheDocument());
  });

  // Regression coverage: this page is also linked directly from the Play
  // Store listing / AdMob console, reached with no prior in-app history at
  // all. The Back link used to be a hardcoded link to "/" regardless, which
  // meant a browser visitor following that link and clicking it landed on
  // the GitHub Pages web build of the game instead of back wherever they
  // actually came from (the Play Store listing, most likely) - see
  // Privacy.tsx's own comment. It's hidden entirely in this case now,
  // rather than offering a destination that's wrong for this visitor.
  it('hides the Back link on a direct visit with no in-app history to return to', () => {
    window.history.pushState(null, '', '/privacy');
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Privacy Policy' })).toBeInTheDocument();
    expect(screen.queryByText('← Back to Armada')).not.toBeInTheDocument();
  });
});

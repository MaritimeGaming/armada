import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import { __resetTitleScreenSessionFlagForTests } from '@/pages/Index';

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
    __resetTitleScreenSessionFlagForTests();
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
    __resetTitleScreenSessionFlagForTests();
  });

  afterEach(() => {
    window.localStorage.clear();
    // Restore a clean starting URL for any tests that run after this block.
    // import.meta.env.BASE_URL is "/" under vitest - and the real build now
    // serves from "/" too (custom domain, see vite.config.ts) - so
    // BrowserRouter's basename here is "/" and paths in this describe block
    // are bare, unprefixed.
    window.history.pushState(null, '', '/');
  });

  it('opens the Privacy Policy page from the Settings menu, with a working Back link', async () => {
    render(<App />);
    dismissTitleScreen();

    const settingsButton = screen.getAllByLabelText('Open settings')[0];
    fireEvent.pointerDown(settingsButton, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByText('Privacy Policy'));

    expect(await screen.findByRole('heading', { name: 'Privacy Policy' })).toBeInTheDocument();
    expect(screen.getByText('contact@maritimegaming.com')).toBeInTheDocument();

    // Reached via in-app navigation, so there's somewhere real to go back
    // to - the Back link should be there, and should actually work.
    fireEvent.click(screen.getByText('← Back to Armada'));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Privacy Policy' })).not.toBeInTheDocument());

    // Regression coverage: navigating to /privacy and back unmounts and
    // remounts Index (a route change, not just a state toggle), which used
    // to reset showTitleScreen's plain useState back to its initial `true`
    // - re-showing the splash after a completely unrelated trip to the
    // Settings menu, discovered by actually playing the app on a real
    // device. hasShownTitleScreenThisSession (Index.tsx) fixes this; the
    // title screen's own Play button must NOT be back on screen here.
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
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

// A fake `window.Audio` for the Sound Effects toggle tests below - jsdom
// itself throws "Not implemented" for real HTMLMediaElement playback, and
// even if it didn't, these tests care whether playAudioCue (Index.tsx)
// constructs an Audio at all, not whether one actually produces sound.
class FakeAudio {
  static instances: FakeAudio[] = [];
  src: string;
  preload = '';
  currentTime = 0;

  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }

  addEventListener() {
    // No-op: nothing in these tests needs 'ended'/'error' to actually fire.
  }

  load() {
    // No-op: satisfies the audio-prewarming effect's own call to this.
  }

  play() {
    return Promise.resolve();
  }
}

describe('Sound Effects setting', () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.clear();
    __resetTitleScreenSessionFlagForTests();
    randomSpy = vi.spyOn(Math, 'random');
    FakeAudio.instances = [];
    vi.stubGlobal('Audio', FakeAudio);
  });

  afterEach(() => {
    randomSpy.mockRestore();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  // createGameState's currentTurn coin flip (armada-game.ts) picks 'player'
  // below 0.5 - unlike the swipe-carousel tests above (which force 'app' so
  // the *player's* board shows first), these tests need the *enemy* board
  // showing so there's a cell to click and fire a shot at.
  function forceEnemyViewNextGame() {
    randomSpy.mockReturnValueOnce(0.1);
  }

  function openSettingsMenu() {
    const settingsButton = screen.getAllByLabelText('Open settings')[0];
    // Radix's DropdownMenuTrigger opens on pointerdown, gated on
    // `event.button === 0 && event.ctrlKey === false` - fireEvent's default
    // PointerEvent leaves ctrlKey undefined, which fails that check unless
    // it's set explicitly.
    fireEvent.pointerDown(settingsButton, { button: 0, ctrlKey: false });
  }

  function fireAShot() {
    const [cell] = screen.getAllByLabelText('Unknown cell, untargeted');
    fireEvent.mouseDown(cell);
    fireEvent.mouseUp(cell);
  }

  it('is checked by default, with no stored preference', async () => {
    render(<App />);
    dismissTitleScreen();
    openSettingsMenu();

    const item = await screen.findByRole('menuitemcheckbox', { name: 'Sound Effects' });
    expect(item).toHaveAttribute('aria-checked', 'true');
  });

  it('persists to localStorage and unchecks the menu item when turned off', async () => {
    render(<App />);
    dismissTitleScreen();
    openSettingsMenu();

    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Sound Effects' }));
    expect(window.localStorage.getItem('armada:sound-effects-enabled')).toBe('false');

    openSettingsMenu();
    expect(await screen.findByRole('menuitemcheckbox', { name: 'Sound Effects' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('still plays a cue for a shot while enabled (sanity check for the test below)', async () => {
    forceEnemyViewNextGame();
    render(<App />);
    dismissTitleScreen();

    // The audio-prewarming effect (Index.tsx) constructs one Audio per
    // AUDIO_FILES entry on mount regardless of this setting, by design -
    // reset the count here so only the shot's own cue is being measured.
    FakeAudio.instances = [];
    fireAShot();
    expect(FakeAudio.instances.length).toBeGreaterThan(0);
  });

  it('stops a shot from constructing any Audio once turned off', async () => {
    forceEnemyViewNextGame();
    render(<App />);
    dismissTitleScreen();
    openSettingsMenu();
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Sound Effects' }));

    FakeAudio.instances = [];
    fireAShot();
    expect(FakeAudio.instances.length).toBe(0);
  });
});

// Regression coverage for a reported bug: toggling Singles while at 0 game
// tokens correctly opened the New Game ad-confirmation dialog, but
// shipSetOptions itself was already persisted and applied (handleSinglesToggle
// used to do this directly, before requestNewGame even ran) by the time that
// dialog appeared. Declining left the setting - and the Ship Legend, which
// reads shipSetOptions - saying the new value while the game still on screen
// (the previous game, built with the old value) never adopted it: the grids
// would show no E/H/L after enabling Singles and declining, but the legend
// would list them anyway, and the game could never finish since it kept
// waiting for ships that were never placed. handleNewGame (Index.tsx) now
// commits shipSetOptions itself, only once a game genuinely starts.
describe('Singles toggle vs. the New Game ad gate', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetTitleScreenSessionFlagForTests();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  function openSettingsMenu() {
    const settingsButton = screen.getAllByLabelText('Open settings')[0];
    // Radix's DropdownMenuTrigger opens on pointerdown, gated on
    // `event.button === 0 && event.ctrlKey === false` - fireEvent's default
    // PointerEvent leaves ctrlKey undefined, which fails that check unless
    // it's set explicitly.
    fireEvent.pointerDown(settingsButton, { button: 0, ctrlKey: false });
  }

  it('leaves the persisted Singles setting unchanged if a required ad is declined', async () => {
    // Forces the very first game (created on mount) to immediately need an
    // ad for the *next* one, same as a returning player who already spent
    // their tokens in an earlier session.
    window.localStorage.setItem('armada:game-tokens', '0');
    render(<App />);
    dismissTitleScreen();

    const baselineOptions = window.localStorage.getItem('armada:ship-set-options');
    expect(JSON.parse(baselineOptions ?? '{}').includeSingles).toBe(true);

    openSettingsMenu();
    const singlesItem = await screen.findByRole('menuitemcheckbox', { name: 'Singles (E H L)' });
    expect(singlesItem).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(singlesItem);

    // Toggling with no tokens left opens the ad-confirmation dialog instead
    // of starting the new game outright.
    const noButton = await screen.findByRole('button', { name: 'No' });
    fireEvent.click(noButton);

    // Declining must leave the persisted setting exactly as it was - not
    // flipped to includeSingles: false while the old game stays on screen.
    expect(window.localStorage.getItem('armada:ship-set-options')).toBe(baselineOptions);

    openSettingsMenu();
    expect(await screen.findByRole('menuitemcheckbox', { name: 'Singles (E H L)' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import { __resetTitleScreenSessionFlagForTests } from '@/pages/Index';
import { createGameState, getMoabTargetIndexes, SPECIAL_WEAPON_QUOTA, type GameState } from '@/lib/armada-game';

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

// The phone buzzes (navigator.vibrate) when someone scores a hit or sets off
// the oil slick - once per turn however many cells/ships that turn hit, a
// single pulse for the player and a double pulse for the computer - unless
// the Vibration setting is off. jsdom has no navigator.vibrate, so it's
// stubbed here.
describe('Hit haptics', () => {
  let vibrate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    __resetTitleScreenSessionFlagForTests();
    vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { configurable: true, writable: true, value: vibrate });
    // jsdom's Audio.play() returns undefined, which the game's own cue
    // playback can't handle - see the Sound Effects tests above.
    vi.stubGlobal('Audio', FakeAudio);
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'vibrate');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  // Seeds a saved game (see the game-state-loading effect in Index.tsx) so
  // the layout is known up front: the player's turn, with a MOAB in play,
  // unless mutate says otherwise.
  function seedGame(mutate?: (state: GameState) => void) {
    const state = createGameState();
    state.currentTurn = 'player';
    state.activeWeaponTypes = ['moab', 'torpedo', 'drone'];
    mutate?.(state);
    window.localStorage.setItem('armada:game-state', JSON.stringify(state));
    return state;
  }

  function fireAt(cellIndex: number) {
    const cell = within(screen.getByLabelText('Enemy Navy grid')).getAllByRole('button')[cellIndex];
    fireEvent.mouseDown(cell);
    fireEvent.mouseUp(cell);
  }

  function openSettingsMenu() {
    // See the same helper in the Sound Effects tests above for why ctrlKey
    // has to be set explicitly.
    fireEvent.pointerDown(screen.getAllByLabelText('Open settings')[0], { button: 0, ctrlKey: false });
  }

  // Lets any delayed audio cue the shot scheduled (an ignition or MOAB
  // plays extra explosions at 300/600ms) fire while the Audio stub is
  // still in place, and gives a stray extra buzz time to show up.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 700));

  it('buzzes once for a plain shot that hits a ship', () => {
    const cells = seedGame().enemy.cells;
    render(<App />);
    dismissTitleScreen();

    fireAt(cells.findIndex((cell) => cell.occupied));

    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(50);
  });

  it('does not buzz for a plain shot that misses', () => {
    const cells = seedGame().enemy.cells;
    render(<App />);
    dismissTitleScreen();

    fireAt(cells.findIndex((cell) => !cell.occupied));

    expect(vibrate).not.toHaveBeenCalled();
  });

  it('buzzes only once when a MOAB hits several cells at once', async () => {
    const cells = seedGame().enemy.cells;
    // A MOAB's blast covers several cells (getMoabTargetIndexes) - pick a
    // target where more than one of them holds a ship it can actually
    // damage. The 2-cell 'S' vessel is immune to MOABs (exposed, never
    // hit), so it doesn't count toward that.
    const damageableCount = (index: number) =>
      getMoabTargetIndexes(index).filter(
        (footprintIndex) => cells[footprintIndex]?.occupied && cells[footprintIndex].shipCode !== 'S',
      ).length;
    const targetIndex = cells.findIndex((_, index) => damageableCount(index) >= 2);
    expect(targetIndex).toBeGreaterThanOrEqual(0);

    render(<App />);
    dismissTitleScreen();
    fireEvent.click(screen.getAllByRole('button', { name: /MOAB/ }).find((button) => !(button as HTMLButtonElement).disabled)!);
    fireAt(targetIndex);
    await settle();

    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  describe('oil slick detonation', () => {
    // A lone oil cell over open water: nothing under it to hit, so
    // detonating it is the only thing that can happen.
    function seedOilOnOpenWater() {
      let oilIndex = -1;
      seedGame((state) => {
        oilIndex = state.enemy.cells.findIndex((cell) => !cell.occupied);
        state.enemy.cells[oilIndex] = { ...state.enemy.cells[oilIndex], oil: true };
      });
      return oilIndex;
    }

    it('buzzes even though it hits no ship', async () => {
      const oilIndex = seedOilOnOpenWater();
      render(<App />);
      dismissTitleScreen();

      // Ignition is a 1-in-OIL_IGNITION_ODDS roll on randomInt(1, ODDS) - a
      // Math.random() of 0 always wins it.
      vi.spyOn(Math, 'random').mockReturnValue(0);
      fireAt(oilIndex);
      await settle();

      expect(vibrate).toHaveBeenCalledTimes(1);
      expect(vibrate).toHaveBeenCalledWith(50);
    });

    // Regression coverage for a real bug: a Torpedo/Rocket/Harpoon launched
    // onto oil over open water can ignite the slick without the launch being
    // a "hit" (see the matching armada-game.test.ts test), and the launch
    // handling only animated/played sound for isHit steps - so the slick
    // detonated with no explosion and no sound.
    it('animates, sounds and buzzes for a Torpedo launched onto open-water oil that ignites', async () => {
      let oilIndex = -1;
      seedGame((state) => {
        // Keep the computer to plain shots so its turn stays simple.
        state.appWeaponsUsed = SPECIAL_WEAPON_QUOTA;
        oilIndex = state.enemy.cells.findIndex((cell) => !cell.occupied);
        // Clear the launch cell's whole row of ships so the rest of the
        // Torpedo's run is empty water - the launch is then the only thing
        // that can happen.
        const rowStart = oilIndex - (oilIndex % 10);
        for (let index = rowStart; index < rowStart + 10; index += 1) {
          state.enemy.cells[index] = { ...state.enemy.cells[index], occupied: false, shipCode: undefined };
        }
        state.enemy.cells[oilIndex] = { ...state.enemy.cells[oilIndex], oil: true };
      });
      render(<App />);
      dismissTitleScreen();
      fireEvent.click(screen.getAllByRole('button', { name: /TORPEDO/ }).find((button) => !(button as HTMLButtonElement).disabled)!);

      // The Torpedo's flight (and the computer's turn after it) run on
      // timers - fake them so they can be run to completion below instead of
      // leaking into whatever test comes next.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        FakeAudio.instances = [];
        fireAt(oilIndex);

        expect(screen.getByLabelText('Enemy Navy grid').querySelector('.cell-explosion')).not.toBeNull();
        expect(FakeAudio.instances.length).toBeGreaterThan(0);
        expect(vibrate).toHaveBeenCalledWith(50);

        await vi.advanceTimersByTimeAsync(15000);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not buzz when the same shot fails to ignite it (control for the ignition tests above)', async () => {
      const oilIndex = seedOilOnOpenWater();
      render(<App />);
      dismissTitleScreen();

      vi.spyOn(Math, 'random').mockReturnValue(0.99);
      fireAt(oilIndex);
      await settle();

      expect(vibrate).not.toHaveBeenCalled();
    });
  });

  it("gives the computer's hit a distinct double pulse", async () => {
    seedGame((state) => {
      state.currentTurn = 'app';
      // No special weapons for the computer, so it takes a plain shot.
      state.appWeaponsUsed = SPECIAL_WEAPON_QUOTA;
      // Leave exactly one cell untargeted - a ship cell - so that's the only
      // place the computer's shot can go.
      const targetIndex = state.player.cells.findIndex((cell) => cell.occupied);
      state.player.cells = state.player.cells.map((cell, index) =>
        index === targetIndex ? cell : { ...cell, effect: 'targeted' },
      );
    });
    render(<App />);
    dismissTitleScreen();

    await waitFor(() => expect(vibrate).toHaveBeenCalledWith([50, 70, 50]), { timeout: 4000 });
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('does not throw where the Vibration API is unavailable', () => {
    Reflect.deleteProperty(navigator, 'vibrate');
    const cells = seedGame().enemy.cells;
    render(<App />);
    dismissTitleScreen();

    expect(() => fireAt(cells.findIndex((cell) => cell.occupied))).not.toThrow();
  });

  describe('Vibration setting', () => {
    it('is checked by default, listed right after Sound Effects', async () => {
      render(<App />);
      dismissTitleScreen();
      openSettingsMenu();

      const items = await screen.findAllByRole('menuitemcheckbox');
      const names = items.map((item) => item.textContent);
      expect(names.indexOf('Vibration')).toBe(names.indexOf('Sound Effects') + 1);
      expect(screen.getByRole('menuitemcheckbox', { name: 'Vibration' })).toHaveAttribute('aria-checked', 'true');
    });

    it('persists to localStorage and unchecks the menu item when turned off', async () => {
      render(<App />);
      dismissTitleScreen();
      openSettingsMenu();

      fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Vibration' }));
      expect(window.localStorage.getItem('armada:vibration-enabled')).toBe('false');

      openSettingsMenu();
      expect(await screen.findByRole('menuitemcheckbox', { name: 'Vibration' })).toHaveAttribute('aria-checked', 'false');
    });

    it('stops a hit from buzzing once turned off, without touching Sound Effects', () => {
      window.localStorage.setItem('armada:vibration-enabled', 'false');
      const cells = seedGame().enemy.cells;
      render(<App />);
      dismissTitleScreen();

      FakeAudio.instances = [];
      fireAt(cells.findIndex((cell) => cell.occupied));

      expect(vibrate).not.toHaveBeenCalled();
      expect(FakeAudio.instances.length).toBeGreaterThan(0);
    });
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
    const singlesItem = await screen.findByRole('menuitemcheckbox', { name: 'Singles (E H P)' });
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
    expect(await screen.findByRole('menuitemcheckbox', { name: 'Singles (E H P)' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

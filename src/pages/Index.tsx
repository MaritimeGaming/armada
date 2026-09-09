import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useSeoMeta } from '@unhead/react';
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  ArrowUp,
  ArrowUpDown,
  ArrowUpLeft,
  ArrowUpRight,
  Bomb,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  MoveDiagonal,
  Radar,
  Settings,
} from 'lucide-react';

import {
  applyMineWanderOilDetonation,
  applyShotOutcome,
  areAllShipsSunk,
  AUDIO_FILES,
  computeSessionStatsUpdate,
  createGameState,
  DEFAULT_SESSION_STATS,
  DEFAULT_SHIP_SET_OPTIONS,
  DRONE_SHOT_OUTCOME,
  fireDrone,
  fireHarpoon,
  fireMoab,
  fireRocket,
  fireTorpedo,
  GAME_STATE_VERSION,
  getLocalDateString,
  getMoabTargetIndexes,
  getRevealedTargetIndexes,
  getShips,
  GRID_SIZE,
  moveMine,
  resolveMineHit,
  resolveMineIndexAfterDrop,
  resolveTargetingSequence,
  shotOutcomeFromTargetingResult,
  shotOutcomeFromTravelSteps,
  SPECIAL_WEAPON_QUOTA,
  selectAppTargetIndex,
  selectAppWeaponChoice,
  selectAppWeaponTargetIndex,
  setCellState,
  setCellTargeting,
  WEAPON_TYPE_USE_CAP,
} from '@/lib/armada-game';
import type { AudioCue, AudioSequence, CellState, ExposureState, GameState, NavySide, NavyState, SessionStats, ShipDefinition, ShipSetOptions, ShotOutcome, TurnOwner, WeaponTravelStep, WeaponType, Winner } from '@/lib/armada-game';
import { TitleScreen } from '@/components/TitleScreen';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getCellPresentation, MINE_GLYPH, MINE_GLYPH_COLOR_CLASS } from '@/lib/cell-presentation';
import { cn } from '@/lib/utils';

type GameOverState = {
  isOpen: boolean;
  winner: Winner | null;
};

const STORAGE_KEY = 'armada:game-state';
const navyViewOrder: NavySide[] = ['player', 'enemy'];
const SHIP_SET_STORAGE_KEY = 'armada:ship-set-options';
const MOAB_COUNT_STORAGE_KEY = 'armada:moab-count';
// Starting inventory the first time someone plays; not the same as the
// refill amount below - see the "no progression" philosophy in
// GAME_DESIGN.md, weapon charges are a standing inventory, not a per-round
// resource, so this only ever applies once, before anything is persisted.
const MOAB_STARTING_COUNT = 2;
// How many charges a "Procuring Weapons" refill grants once the player runs out.
const MOAB_REFILL_COUNT = 3;
const MINE_COUNT_STORAGE_KEY = 'armada:mine-count';
const MINE_STARTING_COUNT = 2;
const MINE_REFILL_COUNT = 3;
const TORPEDO_COUNT_STORAGE_KEY = 'armada:torpedo-count';
const TORPEDO_STARTING_COUNT = 2;
const TORPEDO_REFILL_COUNT = 3;
const ROCKET_COUNT_STORAGE_KEY = 'armada:rocket-count';
const ROCKET_STARTING_COUNT = 2;
const ROCKET_REFILL_COUNT = 3;
const HARPOON_COUNT_STORAGE_KEY = 'armada:harpoon-count';
const HARPOON_STARTING_COUNT = 2;
const HARPOON_REFILL_COUNT = 3;
const DRONE_COUNT_STORAGE_KEY = 'armada:drone-count';
const DRONE_STARTING_COUNT = 2;
const DRONE_REFILL_COUNT = 3;
// How long each traveled cell (beyond the launch cell) stays lit with the
// targeting highlight before it resolves and the weapon moves on. Shared by
// the Torpedo, Rocket, and Harpoon - direct counterparts, differing only in
// orientation.
const WEAPON_TRAVEL_STEP_DELAY_MS = 500;
// How long a cell's explosion visual plays, and (for an instant weapon
// with no further animation) how long its use-count dot keeps flashing
// after firing before settling to solid red.
const WEAPON_FIRE_ANIMATION_MS = 380;
// A standing inventory, not part of GameState - survives New Game and
// browser restarts, same as the weapon counts above, and likewise
// untouched by Reset Statistics (that only resets SessionStats). Spent one
// at a time on every new game (see requestNewGame) - the very first game a
// brand-new install ever creates included, no special-casing - and
// refilled by watching a rewarded ad once the balance reaches 0.
const GAME_TOKENS_STORAGE_KEY = 'armada:game-tokens';
// Deliberately more than one "free" game before a new install can hit the
// ad gate at all, so a first-time player gets a little room to get hooked
// before that ever comes up.
const GAME_TOKENS_STARTING_COUNT = 3;
// How many tokens one rewarded-ad view grants - enough for roughly one ad
// every other game once the standing balance runs dry.
const GAME_TOKENS_AD_REWARD = 2;
// How long the stubbed rewarded-ad flow "plays" before crediting - see
// requestNewGame's own doc comment for the real integration point this
// stands in for.
const NEW_GAME_AD_DELAY_MS = 2000;
// Lifetime records, not part of GameState: survive New Game and browser
// restarts. Superseded by SESSION_STATS_STORAGE_KEY below, kept only as a
// one-time migration source (see loadSessionStats) for anyone who already
// has games-played/games-won saved from before the rest of the Statistics
// panel existed.
const GAMES_PLAYED_STORAGE_KEY = 'armada:games-played';
const GAMES_WON_STORAGE_KEY = 'armada:games-won';
const SESSION_STATS_STORAGE_KEY = 'armada:session-stats';
const DESKTOP_LAYOUT_QUERY = '(min-width: 1024px)';

// Wide enough to show both navies side by side (laptop/desktop) instead of
// the mobile swipe-between-panels layout.
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mediaQueryList = window.matchMedia(query);
    const handleChange = () => setMatches(mediaQueryList.matches);

    handleChange();
    mediaQueryList.addEventListener('change', handleChange);
    return () => mediaQueryList.removeEventListener('change', handleChange);
  }, [query]);

  return matches;
}

function readStoredCount(storageKey: string, fallback: number): number {
  const storedCount = window.localStorage.getItem(storageKey);

  if (storedCount === null) {
    return fallback;
  }

  const parsedCount = Number(storedCount);
  return Number.isFinite(parsedCount) ? parsedCount : fallback;
}

// Reads the persisted SessionStats blob, migrating a pre-Statistics-panel
// install's separate games-played/games-won counts into it the first time
// this runs (so upgrading never quietly resets someone's win/loss history)
// rather than losing them under DEFAULT_SESSION_STATS's own zeros.
function loadSessionStats(): SessionStats {
  const stored = window.localStorage.getItem(SESSION_STATS_STORAGE_KEY);

  if (stored) {
    try {
      return { ...DEFAULT_SESSION_STATS, ...(JSON.parse(stored) as Partial<SessionStats>) };
    } catch {
      return DEFAULT_SESSION_STATS;
    }
  }

  const legacyGamesPlayed = window.localStorage.getItem(GAMES_PLAYED_STORAGE_KEY);
  const legacyGamesWon = window.localStorage.getItem(GAMES_WON_STORAGE_KEY);

  if (legacyGamesPlayed === null && legacyGamesWon === null) {
    return DEFAULT_SESSION_STATS;
  }

  return {
    ...DEFAULT_SESSION_STATS,
    gamesPlayed: readStoredCount(GAMES_PLAYED_STORAGE_KEY, 0),
    gamesWon: readStoredCount(GAMES_WON_STORAGE_KEY, 0),
  };
}

// A Torpedo or Rocket can now hit more than one ship in a single run, so
// whether the dialog/view-switch needs the longer "staggered explosion"
// pause has to scan every step it took, not just the last one.
function weaponHasStaggeredOutcome(steps: WeaponTravelStep[]): boolean {
  return steps.some((step) => Boolean(step.ignited) || step.audioSequence.includes('sink'));
}

const Index = () => {
  useSeoMeta({
    title: 'Armada',
    description: 'A mobile-first Armada board showing randomized navy setup for both fleets.',
  });

  // Shown once per app launch (cold start), never again for the rest of the
  // session -- New Game, the win/lose dialog, etc. all skip straight back to
  // the board. Game-state loading below isn't gated on this, so the board is
  // already ready the moment the player taps past the title screen instead
  // of flashing "Preparing fleets" right after.
  const [showTitleScreen, setShowTitleScreen] = useState(true);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [activeView, setActiveView] = useState<NavySide>('player');
  // Starts true so the very first render never animates into place. Every
  // *programmatic* activeView reset (initial load from storage, New Game)
  // sets this back to true for one render, so the mobile swipe carousel
  // snaps straight to the target panel instead of sliding - see the
  // instantViewSwitch effect below for why that matters. A manual swipe
  // (the arrow buttons) leaves this alone, so it still animates.
  const [instantViewSwitch, setInstantViewSwitch] = useState(true);
  const [gameOver, setGameOver] = useState<GameOverState>({ isOpen: false, winner: null });
  // gameOver.isOpen only flips true after concludeGame()'s 2-second reveal
  // delay, but the game is already decided the instant a winning shot
  // resolves - concludeGame sets gameOver.winner immediately, well before
  // isOpen. Every "is it still safe to act" guard below needs this earlier
  // signal, not isOpen: currentTurn alone isn't enough, since it stays
  // pointed at the winner for the rest of that delay (see
  // nextTurnAfterPlayerFire/nextTurnAfterAppFire) - which is exactly the
  // condition the *winning* side's own turn-effect or handlers would
  // otherwise treat as "my turn, go again," previewing or firing a target
  // that no longer means anything.
  const isGameConcluded = gameOver.winner !== null;
  const [shipSetOptions, setShipSetOptions] = useState<ShipSetOptions>(() => {
    const storedOptions = window.localStorage.getItem(SHIP_SET_STORAGE_KEY);

    if (!storedOptions) {
      return DEFAULT_SHIP_SET_OPTIONS;
    }

    try {
      const parsedOptions = JSON.parse(storedOptions) as Partial<ShipSetOptions>;
      return {
        includeSingles: parsedOptions.includeSingles !== false,
      };
    } catch {
      return DEFAULT_SHIP_SET_OPTIONS;
    }
  });
  // Standing inventories, not part of GameState: they must survive a New
  // Game (and browser restarts) untouched. The only way to increase either
  // is through its "Procuring Weapons" refill flow.
  const [moabCount, setMoabCount] = useState<number>(() => readStoredCount(MOAB_COUNT_STORAGE_KEY, MOAB_STARTING_COUNT));
  const [mineCount, setMineCount] = useState<number>(() => readStoredCount(MINE_COUNT_STORAGE_KEY, MINE_STARTING_COUNT));
  const [torpedoCount, setTorpedoCount] = useState<number>(() => readStoredCount(TORPEDO_COUNT_STORAGE_KEY, TORPEDO_STARTING_COUNT));
  const [rocketCount, setRocketCount] = useState<number>(() => readStoredCount(ROCKET_COUNT_STORAGE_KEY, ROCKET_STARTING_COUNT));
  const [harpoonCount, setHarpoonCount] = useState<number>(() => readStoredCount(HARPOON_COUNT_STORAGE_KEY, HARPOON_STARTING_COUNT));
  const [droneCount, setDroneCount] = useState<number>(() => readStoredCount(DRONE_COUNT_STORAGE_KEY, DRONE_STARTING_COUNT));
  // Mirrors the weapon counts above - a standing inventory of its own, not
  // part of GameState, not reset by Reset Statistics. See requestNewGame.
  const [gameTokens, setGameTokens] = useState<number>(() => readStoredCount(GAME_TOKENS_STORAGE_KEY, GAME_TOKENS_STARTING_COUNT));
  // Mirrors procuringWeapon below, for the same stubbed-ad reason - see
  // requestNewGame.
  const [isWatchingAdForNewGame, setIsWatchingAdForNewGame] = useState(false);
  const [sessionStats, setSessionStats] = useState<SessionStats>(loadSessionStats);
  // The Victory/Defeat dialog's own "what changed this game" callout (see
  // concludeGame) - a plain-English line per record set or streak
  // extended/broken, cleared on the next New Game.
  const [gameOverRecordUpdates, setGameOverRecordUpdates] = useState<string[]>([]);
  // A Torpedo's or Rocket's travel can take several seconds; turn ownership
  // deliberately doesn't pass to the computer until it fully resolves (see
  // handleEnemyCellPressEnd's torpedo/rocket branches), so this blocks the
  // player from acting again mid-flight the way "currentTurn !== 'player'" would
  // for every other weapon.
  const [isWeaponInFlight, setIsWeaponInFlight] = useState(false);
  const appPreviewIndexRef = useRef<number | null>(null);
  // undefined = not yet decided this turn; null = decided not to use a
  // weapon; a WeaponType = the weapon it decided to fire.
  const appWeaponChoiceRef = useRef<WeaponType | null | undefined>(undefined);
  // Blocks the AI-turn effect from re-entering while the computer's own
  // torpedo or rocket is still traveling (currentTurn stays 'app'
  // throughout, so the effect's usual currentTurn guard wouldn't otherwise
  // stop it).
  const appWeaponInFlightRef = useRef(false);
  const userPreviewIndexRef = useRef<number | null>(null);
  const playerShotExtendedDelayRef = useRef(false);
  const [explosionCells, setExplosionCells] = useState<Record<NavySide, number[]>>({
    player: [],
    enemy: [],
  });
  const audioRef = useRef<Record<AudioCue, HTMLAudioElement[]>>({
    splash: [],
    sink: [],
    lifeboat: [],
    ensign: [],
    helicopter: [],
    explosion: [],
    wingame: [],
    deflect: [],
  });
  const [panelWidth, setPanelWidth] = useState(0);
  const swipeResizeObserverRef = useRef<ResizeObserver | null>(null);
  const swipeInstantSwitchFrameRef = useRef(0);
  const isDesktopLayout = useMediaQuery(DESKTOP_LAYOUT_QUERY);
  const [armedWeapon, setArmedWeapon] = useState<WeaponType | null>(null);
  // Which weapon type currently has a "pending" shot in progress on each
  // side - armed (about to fire) or firing (fired, animation not yet
  // settled) - drives the flashing use-count dot on that weapon's button.
  // Separate from armedWeapon because the dot should keep flashing through
  // the firing animation, after armedWeapon itself has already cleared.
  const [firingWeaponType, setFiringWeaponType] = useState<WeaponType | null>(null);
  const [appArmedWeapon, setAppArmedWeapon] = useState<WeaponType | null>(null);
  const [appFiringWeaponType, setAppFiringWeaponType] = useState<WeaponType | null>(null);
  const [procuringWeapon, setProcuringWeapon] = useState<WeaponType | null>(null);
  // The weapon awaiting the player's Yes/No confirmation before
  // beginWeaponProcurement launches the ad-stub below. Unlike the New Game
  // gate (requestNewGame), running dry on a weapon mid-game isn't a natural
  // break point the player is already expecting, so here we ask first
  // instead of launching the ad immediately - see GAME_DESIGN.md. Declining
  // just closes this dialog: no charge, no ad, and the weapon stays
  // unarmed, same as before the click.
  const [pendingWeaponProcurement, setPendingWeaponProcurement] = useState<WeaponType | null>(null);
  const [infoDialog, setInfoDialog] = useState<'ships' | 'weapons' | 'statistics' | null>(null);

  // A callback ref, not an effect: the swipe viewport only exists once
  // gameState is loaded, so an effect with an empty dependency array would
  // fire before it mounts and never measure it. This runs exactly when the
  // node actually attaches (and detaches), regardless of that timing.
  const swipeViewportRef = useCallback((node: HTMLDivElement | null) => {
    swipeResizeObserverRef.current?.disconnect();
    swipeResizeObserverRef.current = null;

    if (!node) {
      return;
    }

    setPanelWidth(node.clientWidth);

    const observer = new ResizeObserver(() => setPanelWidth(node.clientWidth));
    observer.observe(node);
    swipeResizeObserverRef.current = observer;
  }, []);

  useEffect(() => {
    const storedState = window.localStorage.getItem(STORAGE_KEY);

    if (storedState) {
      try {
        const parsedState = JSON.parse(storedState) as Partial<GameState>;

        if (parsedState.version === GAME_STATE_VERSION) {
          const currentShipCodes = new Set(getShips(shipSetOptions).map((ship) => ship.code));
          const persistedShipCodes = new Set(
            [parsedState.player, parsedState.enemy]
              .flatMap((navy) => navy?.ships?.map((ship) => ship.code) ?? [])
          );

          const hasMatchingShipSet =
            currentShipCodes.size === persistedShipCodes.size &&
            Array.from(currentShipCodes).every((code) => persistedShipCodes.has(code));

          if (hasMatchingShipSet) {
            const restoredState = parsedState as GameState;
            setGameState(restoredState);
            setActiveView(restoredState.currentTurn === 'app' ? 'player' : 'enemy');
            setInstantViewSwitch(true);
            return;
          }
        }

        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }

    // No valid save to restore - a genuinely fresh install, or one whose
    // save didn't survive a GAME_STATE_VERSION bump - so this is a new
    // game start like any other and goes through the same token gate
    // (see requestNewGame). If that means a rewarded ad has to play (only
    // possible for a *returning* player who already spent their standing
    // tokens before this happened - a fresh install always starts well
    // stocked), its own overlay only ever renders once the title screen
    // is dismissed (see the early `if (showTitleScreen)` return below), so
    // it can't collide with the splash - it simply finishes in the
    // background, often before the player has even tapped past it.
    requestNewGame();
    // requestNewGame is deliberately omitted below - it's recreated every
    // render (it closes over gameTokens/shipSetOptions), so depending on
    // it would re-run this effect on every render instead of only when
    // shipSetOptions actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipSetOptions]);

  const activeIndex = navyViewOrder.indexOf(activeView);
  const canGoLeft = activeIndex > 0;
  const canGoRight = activeIndex < navyViewOrder.length - 1;

  // Re-arms the swipe transition after an instant (untransitioned) view
  // switch has actually painted. Without this, the fix above for one snap
  // would permanently disable the animation for every swipe after it: a
  // single rAF here would still land in the same frame the instant switch
  // itself painted in on most browsers, since effects and the following
  // paint aren't guaranteed to be separated by only one frame - a second
  // rAF reliably lands one full frame after the first has painted.
  useEffect(() => {
    // The carousel doesn't exist in the DOM at all until the title screen is
    // dismissed (see showTitleScreen's early return below), so this can't
    // start counting frames toward "has the instant switch painted yet"
    // before then - otherwise this fires and re-arms the transition while
    // the title screen is still up, long before the carousel's real first
    // paint, silently reintroducing the animated-first-placement bug this
    // effect exists to prevent.
    if (!instantViewSwitch || showTitleScreen) {
      return;
    }

    const firstFrame = requestAnimationFrame(() => {
      const secondFrame = requestAnimationFrame(() => setInstantViewSwitch(false));
      swipeInstantSwitchFrameRef.current = secondFrame;
    });
    swipeInstantSwitchFrameRef.current = firstFrame;

    return () => cancelAnimationFrame(swipeInstantSwitchFrameRef.current);
  }, [instantViewSwitch, showTitleScreen]);

  const activeNavy = useMemo(() => {
    if (!gameState) return null;
    return activeView === 'player' ? gameState.player : gameState.enemy;
  }, [activeView, gameState]);

  const playAudioCue = (cue: AudioCue) => {
    const audio = new Audio(AUDIO_FILES[cue]);
    audio.preload = 'auto';
    audioRef.current[cue].push(audio);

    const cleanupAudio = () => {
      audioRef.current[cue] = audioRef.current[cue].filter((item) => item !== audio);
    };

    audio.addEventListener('ended', cleanupAudio, { once: true });
    audio.addEventListener('error', cleanupAudio, { once: true });

    audio.currentTime = 0;
    void audio.play().catch((error) => {
      console.warn(`Audio playback failed for ${cue}`, error);
      cleanupAudio();
    });
  };

  const playAudioSequence = (sequence: AudioSequence) => {
    sequence.forEach((cue) => {
      playAudioCue(cue);
    });
  };

  const playIgnitionSequence = (sequence: AudioSequence) => {
    playAudioCue('explosion');
    window.setTimeout(() => playAudioCue('explosion'), 300);
    window.setTimeout(() => playAudioCue('explosion'), 600);
    playAudioSequence(sequence);
  };

  // The MOAB always gets its own double-explosion, hit or miss - any
  // specialized cues (sink, single-cell-ship sounds) still layer on top, but
  // the plain per-cell 'explosion'/'splash' cues are dropped so they don't
  // compete with it.
  const playMoabSequence = (sequence: AudioSequence) => {
    playAudioCue('explosion');
    window.setTimeout(() => playAudioCue('explosion'), 300);
    playAudioSequence(sequence.filter((cue) => cue !== 'explosion' && cue !== 'splash'));
  };

  const triggerCellExplosions = (side: NavySide, cellIndexes: number[]) => {
    if (cellIndexes.length === 0) {
      return;
    }

    setExplosionCells((current) => ({
      ...current,
      [side]: Array.from(new Set([...current[side], ...cellIndexes])),
    }));

    window.setTimeout(() => {
      setExplosionCells((current) => ({
        ...current,
        [side]: current[side].filter((index) => !cellIndexes.includes(index)),
      }));
    }, WEAPON_FIRE_ANIMATION_MS);
  };

  // Marks weapon as "firing" (keeps its use-count dot flashing) and, for an
  // instant weapon with no further animation of its own, clears it again
  // after WEAPON_FIRE_ANIMATION_MS. Traveling weapons (Torpedo/Rocket/
  // Harpoon) call setType(weapon) directly instead and clear it themselves
  // once their travel animation actually finishes.
  const flashWeaponFiring = (setType: (value: WeaponType | null | ((current: WeaponType | null) => WeaponType | null)) => void, weapon: WeaponType) => {
    setType(weapon);
    window.setTimeout(() => setType((current) => (current === weapon ? null : current)), WEAPON_FIRE_ANIMATION_MS);
  };

  // Animates a Torpedo's or Rocket's travel steps (everything after the
  // launch cell) one at a time: highlight the cell for
  // WEAPON_TRAVEL_STEP_DELAY_MS, then apply its resolved state and any hit
  // effects, then move on to the next step. Only called with the steps
  // *after* the launch cell - the launch itself resolves immediately, like
  // any other shot, before this ever runs.
  const runWeaponTravelSteps = (
    navySide: NavySide,
    steps: WeaponTravelStep[],
    stepIndex: number,
    onComplete: () => void,
  ) => {
    if (stepIndex >= steps.length) {
      onComplete();
      return;
    }

    const step = steps[stepIndex];

    setGameState((current) => {
      if (!current) {
        return current;
      }

      const navy = navySide === 'enemy' ? current.enemy : current.player;
      const highlighted = setCellTargeting(navy, step.cellIndex, true);
      return navySide === 'enemy' ? { ...current, enemy: highlighted } : { ...current, player: highlighted };
    });

    window.setTimeout(() => {
      setGameState((current) => {
        if (!current) {
          return current;
        }

        const nextState: GameState = navySide === 'enemy' ? { ...current, enemy: step.navy } : { ...current, player: step.navy };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
        return nextState;
      });

      if (step.isHit) {
        if (step.ignited && step.ignitedCellIndexes) {
          triggerCellExplosions(navySide, step.ignitedCellIndexes);
        } else {
          triggerCellExplosions(navySide, [step.cellIndex]);
        }
      }

      if (step.audioSequence.length > 0) {
        if (step.ignited) {
          playIgnitionSequence(step.audioSequence);
        } else {
          playAudioSequence(step.audioSequence);
        }
      }

      runWeaponTravelSteps(navySide, steps, stepIndex + 1, onComplete);
    }, WEAPON_TRAVEL_STEP_DELAY_MS);
  };

  const handleNewGame = (nextOptions: ShipSetOptions = shipSetOptions) => {
      const nextState = createGameState(nextOptions);
      appPreviewIndexRef.current = null;
      userPreviewIndexRef.current = null;
      appWeaponInFlightRef.current = false;
      setIsWeaponInFlight(false);
      setExplosionCells({ player: [], enemy: [] });
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
      setGameState(nextState);

    setActiveView(nextState.currentTurn === 'app' ? 'player' : 'enemy');
    setInstantViewSwitch(true);
    setGameOver({ isOpen: false, winner: null });
    setGameOverRecordUpdates([]);
  };

  /**
   * The single gate every "start a new game" moment in the app routes
   * through - finishing a game (Victory/Defeat's OK or its X), Settings ->
   * New Game, toggling Singles, and the very first game a fresh install
   * ever creates (see the game-state-loading effect below). Charges one
   * game token and starts immediately if any are available; otherwise
   * shows a rewarded ad first (currently stubbed - see below) and only
   * starts once that's done.
   *
   * Deliberately spends the token on every single one of those, with no
   * exception for the first-ever game: a free unlimited first game (or a
   * free replay via toggling Singles back and forth) would just be a hole
   * in the same economy this exists to enforce.
   */
  const requestNewGame = (nextOptions: ShipSetOptions = shipSetOptions) => {
    if (gameTokens > 0) {
      const nextTokenCount = gameTokens - 1;
      window.localStorage.setItem(GAME_TOKENS_STORAGE_KEY, String(nextTokenCount));
      setGameTokens(nextTokenCount);
      handleNewGame(nextOptions);
      return;
    }

    setIsWatchingAdForNewGame(true);

    // Stub for the real rewarded-ad SDK call. The one rule that has to
    // survive that swap: tokens are only ever credited from the ad's own
    // genuine reward-earned callback, never optimistically (a timeout, the
    // ad view merely closing, a promise that resolves regardless of
    // outcome) - otherwise a player could back out of a real ad mid-flight
    // (close the app, kill it, background it past whatever timeout) and
    // still walk away credited. Backgrounding or killing the app during a
    // real rewarded ad never fires that callback, so nothing is credited
    // and the gate is still standing the next time they try - see
    // GAME_DESIGN.md.
    window.setTimeout(() => {
      setIsWatchingAdForNewGame(false);
      setGameTokens((current) => {
        const nextTokenCount = current + GAME_TOKENS_AD_REWARD - 1;
        window.localStorage.setItem(GAME_TOKENS_STORAGE_KEY, String(nextTokenCount));
        return nextTokenCount;
      });
      handleNewGame(nextOptions);
    }, NEW_GAME_AD_DELAY_MS);
  };

  const handleSinglesToggle = (includeSingles: boolean) => {
    const nextOptions: ShipSetOptions = { includeSingles };
    window.localStorage.setItem(SHIP_SET_STORAGE_KEY, JSON.stringify(nextOptions));
    setShipSetOptions(nextOptions);
    requestNewGame(nextOptions);
  };

  const handleResetStatistics = () => {
    window.localStorage.removeItem(GAMES_PLAYED_STORAGE_KEY);
    window.localStorage.removeItem(GAMES_WON_STORAGE_KEY);
    window.localStorage.setItem(SESSION_STATS_STORAGE_KEY, JSON.stringify(DEFAULT_SESSION_STATS));
    setSessionStats(DEFAULT_SESSION_STATS);
  };

  const handleWeaponButtonClick = (weapon: WeaponType) => {
    if (!gameState || gameState.currentTurn !== 'player' || isGameConcluded || isWeaponInFlight) {
      return;
    }

    if (gameState.playerWeaponsUsed >= SPECIAL_WEAPON_QUOTA) {
      return;
    }

    // Only one mine may be active on the grid at a time.
    if (weapon === 'mine' && gameState.playerMineIndex !== null) {
      return;
    }

    // Only whichever 3 of the 6 weapon types were drawn into this game are
    // usable, and each is capped at WEAPON_TYPE_USE_CAP uses regardless of
    // standing inventory.
    if (!gameState.activeWeaponTypes.includes(weapon)) {
      return;
    }

    if ((gameState.playerWeaponUseCounts[weapon] ?? 0) >= WEAPON_TYPE_USE_CAP) {
      return;
    }

    const counts: Record<WeaponType, number> = {
      moab: moabCount,
      mine: mineCount,
      torpedo: torpedoCount,
      rocket: rocketCount,
      harpoon: harpoonCount,
      drone: droneCount,
    };
    const count = counts[weapon];

    if (count > 0) {
      setArmedWeapon((current) => (current === weapon ? null : weapon));
      return;
    }

    // Ask before spending an ad on this - see pendingWeaponProcurement.
    setPendingWeaponProcurement(weapon);
  };

  // Actually launches the ad-stub, once the player has said Yes to
  // pendingWeaponProcurement's confirmation dialog. On completion, this
  // refills and arms the weapon - it does NOT fire it. The player still has
  // to target a cell to actually take the shot, and can still click the
  // weapon again first to disarm it and choose something else instead,
  // exactly as with a weapon that was never out of stock.
  const beginWeaponProcurement = (weapon: WeaponType) => {
    const storageKeys: Record<WeaponType, string> = {
      moab: MOAB_COUNT_STORAGE_KEY,
      mine: MINE_COUNT_STORAGE_KEY,
      torpedo: TORPEDO_COUNT_STORAGE_KEY,
      rocket: ROCKET_COUNT_STORAGE_KEY,
      harpoon: HARPOON_COUNT_STORAGE_KEY,
      drone: DRONE_COUNT_STORAGE_KEY,
    };
    const setCounts: Record<WeaponType, (value: number) => void> = {
      moab: setMoabCount,
      mine: setMineCount,
      torpedo: setTorpedoCount,
      rocket: setRocketCount,
      harpoon: setHarpoonCount,
      drone: setDroneCount,
    };

    const storageKey = storageKeys[weapon];
    const refillCount = WEAPON_REFILL_COUNTS[weapon];
    const setCount = setCounts[weapon];

    setProcuringWeapon(weapon);

    window.setTimeout(() => {
      setProcuringWeapon(null);
      window.localStorage.setItem(storageKey, String(refillCount));
      setCount(refillCount);
      setArmedWeapon(weapon);
    }, 2000);
  };

  // Yes on the confirmation dialog: dismiss it and hand off to the ad-stub
  // above. Reward crediting still only ever happens from that stub's own
  // completion callback (never a timeout/close signal), so backgrounding
  // or exiting mid-"ad" can't be used to farm a free refill here either -
  // same invariant as requestNewGame's game-token gate.
  const confirmWeaponProcurement = () => {
    const weapon = pendingWeaponProcurement;
    if (!weapon) {
      return;
    }
    setPendingWeaponProcurement(null);
    beginWeaponProcurement(weapon);
  };

  // No (or the dialog's own close button/Escape/outside click): just
  // dismiss it. No charge, no ad, no weapon armed - the player is back
  // exactly where they were before clicking the empty weapon.
  const cancelWeaponProcurement = () => {
    setPendingWeaponProcurement(null);
  };

  const concludeGame = (winner: Winner, state: GameState) => {
      appPreviewIndexRef.current = null;
      userPreviewIndexRef.current = null;
      // Set immediately, not just when the dialog opens 2 seconds from now
      // (isOpen below) - this is what every turn-effect/handler guard below
      // actually needs, so the winning side doesn't keep acting on its own
      // win during the reveal delay (see isGameConcluded).
      setGameOver({ isOpen: false, winner });
      // Deliberately not clearing explosionCells here: this runs in the same
      // tick as the triggerCellExplosions() call for the winning shot, and
      // clearing synchronously would erase that explosion before React ever
      // paints it - the animation's own 380ms timeout (or handleNewGame,
      // for the next round) already cleans it up.

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    setGameState(state);

    // The losing side is whichever navy just lost its last ship - the same
    // one the fatal shot's explosion is already animating on - so force it
    // on screen for the two-second hold below, regardless of whatever view
    // happened to be active a moment ago.
    const losingSide: NavySide = winner === 'player' ? 'enemy' : 'player';
    const winningSide: NavySide = winner === 'player' ? 'player' : 'enemy';
    setActiveView(losingSide);

    const { next: nextSessionStats, updates } = computeSessionStatsUpdate(sessionStats, state, winner, getLocalDateString(new Date()));
    window.localStorage.setItem(SESSION_STATS_STORAGE_KEY, JSON.stringify(nextSessionStats));
    setSessionStats(nextSessionStats);
    setGameOverRecordUpdates(updates);

    // Give the losing navy's final explosion (audio + animation, already
    // queued by whatever shot or weapon just resolved) two full seconds to
    // play out - an oil ignition or MOAB kill queues a second/third
    // "explosion" cue 300-600ms after the first, and that cue alone is a
    // ~1.5s clip - before cutting away to reveal the winning navy's
    // survivors and opening the dialog.
    window.setTimeout(() => {
      const revealedState = revealRemainingShipsInWinningNavy(state, winner);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(revealedState));
      setGameState(revealedState);
      setActiveView(winningSide);

      if (winner === 'player') {
        playAudioCue('wingame');
      }

      setGameOver({ isOpen: true, winner });
    }, 2000);
  };

  // The side that just sank the opponent's whole fleet has won and must NOT
  // hand the turn to the loser: concludeGame's 2-second reveal delay runs
  // before gameOver.isOpen flips true, and both the opposing side's AI-turn
  // effect and this side's own cell-press handler gate purely on
  // currentTurn - leaving it pointed at the winner is what actually blocks
  // stray input (or a stray AI turn) during that window.
  const nextTurnAfterPlayerFire = (updatedEnemy: NavyState): TurnOwner =>
    areAllShipsSunk(updatedEnemy, shipSetOptions) ? 'player' : 'app';

  const nextTurnAfterAppFire = (updatedPlayer: NavyState): TurnOwner =>
    areAllShipsSunk(updatedPlayer, shipSetOptions) ? 'app' : 'player';

  // Folds a turn's ShotOutcome (see armada-game.ts) into baseState for
  // whichever side just fired, plus any oil detonation that side's own
  // mine triggered on its passive wander this same turn (0 when there
  // wasn't an active mine, or it didn't ignite anything) - the single spot
  // every weapon-fire branch below routes its nextState through so the
  // Statistics panel's per-turn counters (turns taken, hit streak, oil
  // detonation) stay in sync with every other field on that same object.
  const finalizeShotState = (
    baseState: GameState,
    side: TurnOwner,
    outcome: ShotOutcome,
    mineWanderOilDetonationSize: number,
  ): GameState => applyMineWanderOilDetonation(applyShotOutcome(baseState, side, outcome), side, mineWanderOilDetonationSize);

  const handleEnemyCellPressStart = (cellIndex: number) => {
    if (activeView !== 'enemy' || isWeaponInFlight) {
      return;
    }

    flushSync(() => {
      setGameState((currentState) => {
        if (!currentState || currentState.currentTurn !== 'player' || isGameConcluded) {
          return currentState;
        }

        const targetCell = currentState.enemy.cells[cellIndex];

        if (!targetCell || targetCell.effect !== 'untargeted' || targetCell.targeting) {
          return currentState;
        }

        userPreviewIndexRef.current = cellIndex;

        const nextEnemy = setCellTargeting(currentState.enemy, cellIndex, true);
        const nextState: GameState = {
          ...currentState,
          enemy: nextEnemy,
        };

        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
        return nextState;
      });
    });
  };

  const handleEnemyCellPressEnd = (cellIndex: number) => {
    if (isWeaponInFlight) {
      return;
    }

    setGameState((state) => {
      if (!state || state.currentTurn !== 'player' || isGameConcluded) {
        return state;
      }

      const previewIndex = userPreviewIndexRef.current;
      const releaseIndex = previewIndex ?? cellIndex;
      const targetCell = state.enemy.cells[releaseIndex];

      if (targetCell?.targeting) {
        userPreviewIndexRef.current = null;

        // An active mine (placed on a prior turn) moves automatically the
        // moment the player takes any turn, regardless of what that turn's
        // own action turns out to be.
        let currentEnemy = state.enemy;
        let mineIndex = state.playerMineIndex;
        let mineCausedExtendedDelay = false;
        // A mine's own passive wander never counts toward the player's Hit
        // Streak (see ShotOutcome), but a chain reaction it triggers can
        // still set a Biggest Oil Detonation record - applied below
        // alongside whatever this turn's own chosen action did (see
        // applyMineWanderOilDetonation).
        let mineWanderOilDetonationSize = 0;

        if (mineIndex !== null) {
          const moveResult = moveMine(currentEnemy, mineIndex);
          currentEnemy = moveResult.navy;
          mineIndex = moveResult.mineIndex;

          if (moveResult.hit) {
            if (moveResult.ignited && moveResult.ignitedCellIndexes) {
              triggerCellExplosions('enemy', moveResult.ignitedCellIndexes);
              mineWanderOilDetonationSize = moveResult.ignitedCellIndexes.length;
            } else if (moveResult.hitIndexes) {
              triggerCellExplosions('enemy', moveResult.hitIndexes);
            }

            mineCausedExtendedDelay = moveResult.audioSequence.includes('sink') || Boolean(moveResult.ignited);

            if (moveResult.ignited) {
              playIgnitionSequence(moveResult.audioSequence);
            } else {
              playAudioSequence(moveResult.audioSequence);
            }
          }
        }

        if (armedWeapon === 'moab') {
          const moabResult = fireMoab(currentEnemy, releaseIndex);
          const { navy: updatedEnemy, audioSequence, ignited, ignitedCellIndexes } = moabResult;
          const shotOutcome = shotOutcomeFromTargetingResult(moabResult, moabResult.targetedIndexes ?? [], true);

          // Always animate the MOAB's full blast footprint (hit, miss, or
          // already-targeted) so the explosion visually covers every cell
          // in range, not just the ones whose targeting data actually
          // changed. If it also ignited the oil slick, that chain reaction
          // can reach further than the blast itself, so include those too.
          const moabFootprint = getMoabTargetIndexes(releaseIndex);
          const explosionIndexes = ignited && ignitedCellIndexes
            ? Array.from(new Set([...moabFootprint, ...ignitedCellIndexes]))
            : moabFootprint;
          triggerCellExplosions('enemy', explosionIndexes);

          playerShotExtendedDelayRef.current = mineCausedExtendedDelay || audioSequence.includes('sink') || Boolean(ignited);

          setArmedWeapon(null);
          flashWeaponFiring(setFiringWeaponType, 'moab');
          setMoabCount((current) => {
            const nextCount = current - 1;
            window.localStorage.setItem(MOAB_COUNT_STORAGE_KEY, String(nextCount));
            return nextCount;
          });

          const nextState: GameState = finalizeShotState(
            {
              ...state,
              currentTurn: nextTurnAfterPlayerFire(updatedEnemy),
              enemy: updatedEnemy,
              playerWeaponsUsed: state.playerWeaponsUsed + 1,
              playerWeaponUseCounts: { ...state.playerWeaponUseCounts, moab: state.playerWeaponUseCounts.moab + 1 },
              playerMineIndex: mineIndex,
            },
            'player',
            shotOutcome,
            mineWanderOilDetonationSize,
          );

          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));

          if (ignited) {
            playIgnitionSequence(audioSequence);
          } else {
            playMoabSequence(audioSequence);
          }

          if (areAllShipsSunk(updatedEnemy, shipSetOptions)) {
            concludeGame('player', nextState);
          }

          return nextState;
        }

        if (armedWeapon === 'mine') {
          const mineResult = resolveMineHit(currentEnemy, releaseIndex);
          const { navy: updatedEnemy, audioSequence, ignited, ignitedCellIndexes, targetedIndexes } = mineResult;
          // A drop that lands on empty water doesn't count toward the hit
          // streak either way - the mine is still armed and pending (see
          // ShotOutcome) - but one that lands on any occupied cell (hit or
          // immune) fully resolves this turn, so it does.
          const shotOutcome = shotOutcomeFromTargetingResult(mineResult, targetedIndexes ?? [], targetCell.occupied);

          if (ignited && ignitedCellIndexes) {
            triggerCellExplosions('enemy', ignitedCellIndexes);
          } else {
            const hitIndexes = (targetedIndexes ?? []).filter((index) => currentEnemy.cells[index]?.occupied);
            if (hitIndexes.length > 0) {
              triggerCellExplosions('enemy', hitIndexes);
            }
          }

          playerShotExtendedDelayRef.current = mineCausedExtendedDelay || audioSequence.includes('sink') || Boolean(ignited);

          setArmedWeapon(null);
          flashWeaponFiring(setFiringWeaponType, 'mine');
          setMineCount((current) => {
            const nextCount = current - 1;
            window.localStorage.setItem(MINE_COUNT_STORAGE_KEY, String(nextCount));
            return nextCount;
          });

          const nextMineIndex = resolveMineIndexAfterDrop(shotOutcome, mineIndex, releaseIndex);

          const nextState: GameState = finalizeShotState(
            {
              ...state,
              currentTurn: nextTurnAfterPlayerFire(updatedEnemy),
              enemy: updatedEnemy,
              playerWeaponsUsed: state.playerWeaponsUsed + 1,
              playerWeaponUseCounts: { ...state.playerWeaponUseCounts, mine: state.playerWeaponUseCounts.mine + 1 },
              playerMineIndex: nextMineIndex,
            },
            'player',
            shotOutcome,
            mineWanderOilDetonationSize,
          );

          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));

          if (ignited) {
            playIgnitionSequence(audioSequence);
          } else {
            playAudioSequence(audioSequence);
          }

          if (areAllShipsSunk(updatedEnemy, shipSetOptions)) {
            concludeGame('player', nextState);
          }

          return nextState;
        }

        if (armedWeapon === 'torpedo') {
          const result = fireTorpedo(currentEnemy, releaseIndex);
          const [launchStep, ...travelSteps] = result.steps;
          const shotOutcome = shotOutcomeFromTravelSteps(result.steps);

          if (launchStep.isHit) {
            if (launchStep.ignited && launchStep.ignitedCellIndexes) {
              triggerCellExplosions('enemy', launchStep.ignitedCellIndexes);
            } else {
              triggerCellExplosions('enemy', [launchStep.cellIndex]);
            }
          }
          if (launchStep.audioSequence.length > 0) {
            if (launchStep.ignited) {
              playIgnitionSequence(launchStep.audioSequence);
            } else {
              playAudioSequence(launchStep.audioSequence);
            }
          }

          setArmedWeapon(null);
          setFiringWeaponType('torpedo');
          setTorpedoCount((current) => {
            const nextCount = current - 1;
            window.localStorage.setItem(TORPEDO_COUNT_STORAGE_KEY, String(nextCount));
            return nextCount;
          });

          const hasTravel = travelSteps.length > 0;

          if (hasTravel) {
            setIsWeaponInFlight(true);
          }

          const nextState: GameState = finalizeShotState(
            {
              ...state,
              // A miss keeps travelling for several more seconds of animation -
              // turn ownership doesn't pass to the computer until that finishes,
              // so its own turn can't start mid-flight (see runWeaponTravelSteps).
              currentTurn: hasTravel ? 'player' : nextTurnAfterPlayerFire(launchStep.navy),
              enemy: launchStep.navy,
              playerWeaponsUsed: state.playerWeaponsUsed + 1,
              playerWeaponUseCounts: { ...state.playerWeaponUseCounts, torpedo: state.playerWeaponUseCounts.torpedo + 1 },
              playerMineIndex: mineIndex,
            },
            'player',
            shotOutcome,
            mineWanderOilDetonationSize,
          );

          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));

          if (!hasTravel) {
            playerShotExtendedDelayRef.current = mineCausedExtendedDelay || weaponHasStaggeredOutcome(result.steps);
            window.setTimeout(() => setFiringWeaponType((current) => (current === 'torpedo' ? null : current)), WEAPON_FIRE_ANIMATION_MS);

            if (areAllShipsSunk(launchStep.navy, shipSetOptions)) {
              concludeGame('player', nextState);
            }

            return nextState;
          }

          runWeaponTravelSteps('enemy', travelSteps, 0, () => {
            setFiringWeaponType((current) => (current === 'torpedo' ? null : current));
            setGameState((current) => {
              if (!current) {
                return current;
              }

              const hasStaggered = weaponHasStaggeredOutcome(result.steps);

              setIsWeaponInFlight(false);

              if (areAllShipsSunk(current.enemy, shipSetOptions)) {
                concludeGame('player', current);
                return current;
              }

              playerShotExtendedDelayRef.current = mineCausedExtendedDelay || hasStaggered;

              const resolvedState: GameState = { ...current, currentTurn: 'app' };
              window.localStorage.setItem(STORAGE_KEY, JSON.stringify(resolvedState));
              return resolvedState;
            });
          });

          return nextState;
        }

        if (armedWeapon === 'rocket') {
          const result = fireRocket(currentEnemy, releaseIndex);
          const [launchStep, ...travelSteps] = result.steps;
          const shotOutcome = shotOutcomeFromTravelSteps(result.steps);

          if (launchStep.isHit) {
            if (launchStep.ignited && launchStep.ignitedCellIndexes) {
              triggerCellExplosions('enemy', launchStep.ignitedCellIndexes);
            } else {
              triggerCellExplosions('enemy', [launchStep.cellIndex]);
            }
          }
          if (launchStep.audioSequence.length > 0) {
            if (launchStep.ignited) {
              playIgnitionSequence(launchStep.audioSequence);
            } else {
              playAudioSequence(launchStep.audioSequence);
            }
          }

          setArmedWeapon(null);
          setFiringWeaponType('rocket');
          setRocketCount((current) => {
            const nextCount = current - 1;
            window.localStorage.setItem(ROCKET_COUNT_STORAGE_KEY, String(nextCount));
            return nextCount;
          });

          const hasTravel = travelSteps.length > 0;

          if (hasTravel) {
            setIsWeaponInFlight(true);
          }

          const nextState: GameState = finalizeShotState(
            {
              ...state,
              // A miss keeps travelling for several more seconds of animation -
              // turn ownership doesn't pass to the computer until that finishes,
              // so its own turn can't start mid-flight (see runWeaponTravelSteps).
              currentTurn: hasTravel ? 'player' : nextTurnAfterPlayerFire(launchStep.navy),
              enemy: launchStep.navy,
              playerWeaponsUsed: state.playerWeaponsUsed + 1,
              playerWeaponUseCounts: { ...state.playerWeaponUseCounts, rocket: state.playerWeaponUseCounts.rocket + 1 },
              playerMineIndex: mineIndex,
            },
            'player',
            shotOutcome,
            mineWanderOilDetonationSize,
          );

          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));

          if (!hasTravel) {
            playerShotExtendedDelayRef.current = mineCausedExtendedDelay || weaponHasStaggeredOutcome(result.steps);
            window.setTimeout(() => setFiringWeaponType((current) => (current === 'rocket' ? null : current)), WEAPON_FIRE_ANIMATION_MS);

            if (areAllShipsSunk(launchStep.navy, shipSetOptions)) {
              concludeGame('player', nextState);
            }

            return nextState;
          }

          runWeaponTravelSteps('enemy', travelSteps, 0, () => {
            setFiringWeaponType((current) => (current === 'rocket' ? null : current));
            setGameState((current) => {
              if (!current) {
                return current;
              }

              const hasStaggered = weaponHasStaggeredOutcome(result.steps);

              setIsWeaponInFlight(false);

              if (areAllShipsSunk(current.enemy, shipSetOptions)) {
                concludeGame('player', current);
                return current;
              }

              playerShotExtendedDelayRef.current = mineCausedExtendedDelay || hasStaggered;

              const resolvedState: GameState = { ...current, currentTurn: 'app' };
              window.localStorage.setItem(STORAGE_KEY, JSON.stringify(resolvedState));
              return resolvedState;
            });
          });

          return nextState;
        }

        if (armedWeapon === 'harpoon') {
          const result = fireHarpoon(currentEnemy, releaseIndex);
          const [launchStep, ...travelSteps] = result.steps;
          const shotOutcome = shotOutcomeFromTravelSteps(result.steps);

          if (launchStep.isHit) {
            if (launchStep.ignited && launchStep.ignitedCellIndexes) {
              triggerCellExplosions('enemy', launchStep.ignitedCellIndexes);
            } else {
              triggerCellExplosions('enemy', [launchStep.cellIndex]);
            }
          }
          if (launchStep.audioSequence.length > 0) {
            if (launchStep.ignited) {
              playIgnitionSequence(launchStep.audioSequence);
            } else {
              playAudioSequence(launchStep.audioSequence);
            }
          }

          setArmedWeapon(null);
          setFiringWeaponType('harpoon');
          setHarpoonCount((current) => {
            const nextCount = current - 1;
            window.localStorage.setItem(HARPOON_COUNT_STORAGE_KEY, String(nextCount));
            return nextCount;
          });

          const hasTravel = travelSteps.length > 0;

          if (hasTravel) {
            setIsWeaponInFlight(true);
          }

          const nextState: GameState = finalizeShotState(
            {
              ...state,
              // A miss keeps travelling for several more seconds of animation -
              // turn ownership doesn't pass to the computer until that finishes,
              // so its own turn can't start mid-flight (see runWeaponTravelSteps).
              currentTurn: hasTravel ? 'player' : nextTurnAfterPlayerFire(launchStep.navy),
              enemy: launchStep.navy,
              playerWeaponsUsed: state.playerWeaponsUsed + 1,
              playerWeaponUseCounts: { ...state.playerWeaponUseCounts, harpoon: state.playerWeaponUseCounts.harpoon + 1 },
              playerMineIndex: mineIndex,
            },
            'player',
            shotOutcome,
            mineWanderOilDetonationSize,
          );

          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));

          if (!hasTravel) {
            playerShotExtendedDelayRef.current = mineCausedExtendedDelay || weaponHasStaggeredOutcome(result.steps);
            window.setTimeout(() => setFiringWeaponType((current) => (current === 'harpoon' ? null : current)), WEAPON_FIRE_ANIMATION_MS);

            if (areAllShipsSunk(launchStep.navy, shipSetOptions)) {
              concludeGame('player', nextState);
            }

            return nextState;
          }

          runWeaponTravelSteps('enemy', travelSteps, 0, () => {
            setFiringWeaponType((current) => (current === 'harpoon' ? null : current));
            setGameState((current) => {
              if (!current) {
                return current;
              }

              const hasStaggered = weaponHasStaggeredOutcome(result.steps);

              setIsWeaponInFlight(false);

              if (areAllShipsSunk(current.enemy, shipSetOptions)) {
                concludeGame('player', current);
                return current;
              }

              playerShotExtendedDelayRef.current = mineCausedExtendedDelay || hasStaggered;

              const resolvedState: GameState = { ...current, currentTurn: 'app' };
              window.localStorage.setItem(STORAGE_KEY, JSON.stringify(resolvedState));
              return resolvedState;
            });
          });

          return nextState;
        }

        if (armedWeapon === 'drone') {
          const { navy: updatedEnemy } = fireDrone(currentEnemy, releaseIndex);

          setArmedWeapon(null);
          flashWeaponFiring(setFiringWeaponType, 'drone');
          setDroneCount((current) => {
            const nextCount = current - 1;
            window.localStorage.setItem(DRONE_COUNT_STORAGE_KEY, String(nextCount));
            return nextCount;
          });

          playerShotExtendedDelayRef.current = mineCausedExtendedDelay;

          const nextState: GameState = finalizeShotState(
            {
              ...state,
              currentTurn: 'app',
              enemy: updatedEnemy,
              playerWeaponsUsed: state.playerWeaponsUsed + 1,
              playerWeaponUseCounts: { ...state.playerWeaponUseCounts, drone: state.playerWeaponUseCounts.drone + 1 },
              playerMineIndex: mineIndex,
            },
            'player',
            DRONE_SHOT_OUTCOME,
            mineWanderOilDetonationSize,
          );

          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));

          return nextState;
        }

        const enemyWithTargetedCell = setCellState(currentEnemy, releaseIndex, {
          effect: 'targeted',
          targeting: false,
        });
        const plainShotResult = resolveTargetingSequence(enemyWithTargetedCell, [releaseIndex]);
        const { navy: updatedEnemy, audioSequence, ignited, ignitedCellIndexes } = plainShotResult;

        if (ignited && ignitedCellIndexes) {
          triggerCellExplosions('enemy', ignitedCellIndexes);
        } else if (targetCell.occupied) {
          triggerCellExplosions('enemy', [releaseIndex]);
        }

        playerShotExtendedDelayRef.current = mineCausedExtendedDelay || audioSequence.includes('sink') || Boolean(ignited);

        if (updatedEnemy === currentEnemy && mineIndex === state.playerMineIndex) {
          return state;
        }

        const shotOutcome = shotOutcomeFromTargetingResult(plainShotResult, [releaseIndex], true);
        const nextState: GameState = finalizeShotState(
          {
            ...state,
            currentTurn: nextTurnAfterPlayerFire(updatedEnemy),
            enemy: updatedEnemy,
            playerMineIndex: mineIndex,
          },
          'player',
          shotOutcome,
          mineWanderOilDetonationSize,
        );

      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
      if (ignited) {
        playIgnitionSequence(audioSequence);
      } else {
        playAudioSequence(audioSequence);
      }

        if (areAllShipsSunk(updatedEnemy, shipSetOptions)) {
          concludeGame('player', nextState);
        }

        return nextState;
      }

      userPreviewIndexRef.current = null;

      const targetingIndex = state.enemy.cells.findIndex((cell) => cell.targeting);

      if (targetingIndex === -1) {
        return state;
      }

      const nextEnemy = setCellTargeting(state.enemy, targetingIndex, false);
      const nextState: GameState = {
        ...state,
        enemy: nextEnemy,
      };

      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
      return nextState;
    });
  };

  const handleTargetEnemyCell = (cellIndex: number) => {
    handleEnemyCellPressEnd(cellIndex);
  };

  const handleEnemyCellPressCancel = (cellIndex: number) => {
    if (isWeaponInFlight) {
      return;
    }

    setGameState((state) => {
      if (!state) {
        return state;
      }

      // Only cancel if THIS cell is the one actually being previewed. A blur
      // firing on some other, previously-focused cell (e.g. focus moving
      // from the last cell you fired at to the one you're pressing now)
      // must not touch the current press just because a preview happens to
      // be active somewhere on the board.
      if (!state.enemy.cells[cellIndex]?.targeting) {
        return state;
      }

      userPreviewIndexRef.current = null;

      const nextEnemy = setCellTargeting(state.enemy, cellIndex, false);
      const nextState: GameState = {
        ...state,
        enemy: nextEnemy,
      };

      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
      return nextState;
    });
  };

  useEffect(() => {
    // The computer's own torpedo can still be mid-flight (its travel steps
    // are driven by their own setTimeout chain, outside this effect) while
    // currentTurn is still 'app' - don't let this effect re-enter and start
    // a second turn on top of it.
    if (appWeaponInFlightRef.current) {
      return;
    }

    if (!gameState || isGameConcluded || gameState.currentTurn !== 'app') {
      appPreviewIndexRef.current = null;
      appWeaponChoiceRef.current = undefined;
      return;
    }

    if (appWeaponChoiceRef.current === undefined) {
      // A cell the computer's own Drone has already revealed as a ship is a
      // free, confirmed kill - firing another weapon (or hunting elsewhere)
      // instead would be wasting a sure thing, so this skips weapon choice
      // entirely and falls through to a plain shot, which selectAppTargetIndex
      // will then aim at that revealed cell (see its own top-priority check).
      const hasRevealedTarget = getRevealedTargetIndexes(gameState.player).length > 0;

      appWeaponChoiceRef.current = hasRevealedTarget
        ? null
        : selectAppWeaponChoice({
            appWeaponsUsed: gameState.appWeaponsUsed,
            activeWeaponTypes: gameState.activeWeaponTypes,
            appMoabCount: gameState.appMoabCount,
            appMineCount: gameState.appMineCount,
            appMineIndex: gameState.appMineIndex,
            appTorpedoCount: gameState.appTorpedoCount,
            appRocketCount: gameState.appRocketCount,
            appHarpoonCount: gameState.appHarpoonCount,
            appDroneCount: gameState.appDroneCount,
          });

      setAppArmedWeapon(appWeaponChoiceRef.current);
    }

    const weaponChoice = appWeaponChoiceRef.current;

    const previewIndex = appPreviewIndexRef.current ?? (
      weaponChoice
        ? selectAppWeaponTargetIndex(gameState.player, weaponChoice)
        : selectAppTargetIndex(gameState.player)
    );

    if (previewIndex === null) {
      return;
    }

    appPreviewIndexRef.current = previewIndex;

    const playerShotExtendedDelay = playerShotExtendedDelayRef.current;
    playerShotExtendedDelayRef.current = false;

    const showPlayerDelay = window.setTimeout(() => {
      setActiveView('player');
    }, playerShotExtendedDelay ? 1700 : 700);

    const previewDelay = window.setTimeout(() => {
      setGameState((currentState) => {
        if (!currentState || currentState.currentTurn !== 'app') {
          return currentState;
        }

        const currentlyTargetingIndex = currentState.player.cells.findIndex((cell) => cell.targeting);
        let nextPlayer = currentState.player;

        if (currentlyTargetingIndex !== -1 && currentlyTargetingIndex !== previewIndex) {
          nextPlayer = setCellTargeting(nextPlayer, currentlyTargetingIndex, false);
        }

        if (!nextPlayer.cells[previewIndex]?.targeting) {
          nextPlayer = setCellTargeting(nextPlayer, previewIndex, true);
        }

        if (nextPlayer === currentState.player) {
          return currentState;
        }

        const nextState: GameState = {
          ...currentState,
          player: nextPlayer,
        };

        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
        return nextState;
      });
    }, 1400);

    const executeTargetingDelay = window.setTimeout(() => {
      setGameState((currentState) => {
        if (!currentState || currentState.currentTurn !== 'app') {
          return currentState;
        }

        appPreviewIndexRef.current = null;
        appWeaponChoiceRef.current = undefined;
        setAppArmedWeapon(null);
        if (weaponChoice) {
          setAppFiringWeaponType(weaponChoice);
        }

        // An active mine (placed on a prior computer turn) moves automatically
        // the moment the computer takes any turn, regardless of what that
        // turn's own action turns out to be.
        let currentPlayer = currentState.player;
        let appMineIndex = currentState.appMineIndex;
        let mineCausedExtendedDelay = false;
        // See the player-side mine-wander block above for why this is
        // tracked separately from the turn's own ShotOutcome.
        let mineWanderOilDetonationSize = 0;

        if (appMineIndex !== null) {
          const moveResult = moveMine(currentPlayer, appMineIndex);
          currentPlayer = moveResult.navy;
          appMineIndex = moveResult.mineIndex;

          if (moveResult.hit) {
            if (moveResult.ignited && moveResult.ignitedCellIndexes) {
              triggerCellExplosions('player', moveResult.ignitedCellIndexes);
              mineWanderOilDetonationSize = moveResult.ignitedCellIndexes.length;
            } else if (moveResult.hitIndexes) {
              triggerCellExplosions('player', moveResult.hitIndexes);
            }

            mineCausedExtendedDelay = moveResult.audioSequence.includes('sink') || Boolean(moveResult.ignited);

            if (moveResult.ignited) {
              playIgnitionSequence(moveResult.audioSequence);
            } else {
              playAudioSequence(moveResult.audioSequence);
            }
          }
        }

        if (weaponChoice === 'moab') {
          const moabResult = fireMoab(currentPlayer, previewIndex);
          const { navy: updatedPlayer, audioSequence, ignited, ignitedCellIndexes } = moabResult;
          const shotOutcome = shotOutcomeFromTargetingResult(moabResult, moabResult.targetedIndexes ?? [], true);

          const moabFootprint = getMoabTargetIndexes(previewIndex);
          const explosionIndexes = ignited && ignitedCellIndexes
            ? Array.from(new Set([...moabFootprint, ...ignitedCellIndexes]))
            : moabFootprint;
          triggerCellExplosions('player', explosionIndexes);
          window.setTimeout(() => setAppFiringWeaponType((current) => (current === 'moab' ? null : current)), WEAPON_FIRE_ANIMATION_MS);

          const hasStaggered = true;

          const nextState: GameState = finalizeShotState(
            {
              ...currentState,
              currentTurn: nextTurnAfterAppFire(updatedPlayer),
              player: updatedPlayer,
              appMoabCount: currentState.appMoabCount - 1,
              appWeaponsUsed: currentState.appWeaponsUsed + 1,
              appMineIndex,
            },
            'app',
            shotOutcome,
            mineWanderOilDetonationSize,
          );

          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
          if (ignited) {
            playIgnitionSequence(audioSequence);
          } else {
            playMoabSequence(audioSequence);
          }

          if (areAllShipsSunk(updatedPlayer, shipSetOptions)) {
            concludeGame('app', nextState);
          } else {
            window.setTimeout(() => {
              setActiveView('enemy');
            }, hasStaggered ? 2000 : 1000);
          }

          return nextState;
        }

        if (weaponChoice === 'mine') {
          const targetCell = currentPlayer.cells[previewIndex];
          const mineResult = resolveMineHit(currentPlayer, previewIndex);
          const { navy: updatedPlayer, audioSequence, ignited, ignitedCellIndexes, targetedIndexes } = mineResult;
          const shotOutcome = shotOutcomeFromTargetingResult(mineResult, targetedIndexes ?? [], Boolean(targetCell?.occupied));

          if (ignited && ignitedCellIndexes) {
            triggerCellExplosions('player', ignitedCellIndexes);
          } else {
            const hitIndexes = (targetedIndexes ?? []).filter((index) => currentPlayer.cells[index]?.occupied);
            if (hitIndexes.length > 0) {
              triggerCellExplosions('player', hitIndexes);
            }
          }

          window.setTimeout(() => setAppFiringWeaponType((current) => (current === 'mine' ? null : current)), WEAPON_FIRE_ANIMATION_MS);

          const hasStaggered = mineCausedExtendedDelay || audioSequence.includes('sink') || Boolean(ignited);

          const nextAppMineIndex = resolveMineIndexAfterDrop(shotOutcome, appMineIndex, previewIndex);

          const nextState: GameState = finalizeShotState(
            {
              ...currentState,
              currentTurn: nextTurnAfterAppFire(updatedPlayer),
              player: updatedPlayer,
              appMineCount: currentState.appMineCount - 1,
              appWeaponsUsed: currentState.appWeaponsUsed + 1,
              appMineIndex: nextAppMineIndex,
            },
            'app',
            shotOutcome,
            mineWanderOilDetonationSize,
          );

          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
          if (ignited) {
            playIgnitionSequence(audioSequence);
          } else {
            playAudioSequence(audioSequence);
          }

          if (areAllShipsSunk(updatedPlayer, shipSetOptions)) {
            concludeGame('app', nextState);
          } else {
            window.setTimeout(() => {
              setActiveView('enemy');
            }, hasStaggered ? 2000 : 1000);
          }

          return nextState;
        }

        if (weaponChoice === 'torpedo') {
          const result = fireTorpedo(currentPlayer, previewIndex);
          const [launchStep, ...travelSteps] = result.steps;
          const shotOutcome = shotOutcomeFromTravelSteps(result.steps);

          if (launchStep.isHit) {
            if (launchStep.ignited && launchStep.ignitedCellIndexes) {
              triggerCellExplosions('player', launchStep.ignitedCellIndexes);
            } else {
              triggerCellExplosions('player', [launchStep.cellIndex]);
            }
          }
          if (launchStep.audioSequence.length > 0) {
            if (launchStep.ignited) {
              playIgnitionSequence(launchStep.audioSequence);
            } else {
              playAudioSequence(launchStep.audioSequence);
            }
          }

          const hasTravel = travelSteps.length > 0;

          if (hasTravel) {
            // Keeps currentTurn at 'app' through the whole travel animation,
            // so the player can't act (or this effect re-enter) until the
            // torpedo fully resolves - see the top-of-effect guard above.
            appWeaponInFlightRef.current = true;
          }

          const nextState: GameState = finalizeShotState(
            {
              ...currentState,
              currentTurn: hasTravel ? 'app' : nextTurnAfterAppFire(launchStep.navy),
              player: launchStep.navy,
              appTorpedoCount: currentState.appTorpedoCount - 1,
              appWeaponsUsed: currentState.appWeaponsUsed + 1,
              appMineIndex,
            },
            'app',
            shotOutcome,
            mineWanderOilDetonationSize,
          );

          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));

          if (!hasTravel) {
            const hasStaggered = mineCausedExtendedDelay || weaponHasStaggeredOutcome(result.steps);
            window.setTimeout(() => setAppFiringWeaponType((current) => (current === 'torpedo' ? null : current)), WEAPON_FIRE_ANIMATION_MS);

            if (areAllShipsSunk(launchStep.navy, shipSetOptions)) {
              concludeGame('app', nextState);
            } else {
              window.setTimeout(() => {
                setActiveView('enemy');
              }, hasStaggered ? 2000 : 1000);
            }

            return nextState;
          }

          runWeaponTravelSteps('player', travelSteps, 0, () => {
            setAppFiringWeaponType((current) => (current === 'torpedo' ? null : current));
            setGameState((current) => {
              if (!current) {
                return current;
              }

              const hasStaggered = mineCausedExtendedDelay || weaponHasStaggeredOutcome(result.steps);

              appWeaponInFlightRef.current = false;

              if (areAllShipsSunk(current.player, shipSetOptions)) {
                concludeGame('app', current);
                return current;
              }

              const resolvedState: GameState = { ...current, currentTurn: 'player' };
              window.localStorage.setItem(STORAGE_KEY, JSON.stringify(resolvedState));

              window.setTimeout(() => {
                setActiveView('enemy');
              }, hasStaggered ? 2000 : 1000);

              return resolvedState;
            });
          });

          return nextState;
        }

        if (weaponChoice === 'rocket') {
          const result = fireRocket(currentPlayer, previewIndex);
          const [launchStep, ...travelSteps] = result.steps;
          const shotOutcome = shotOutcomeFromTravelSteps(result.steps);

          if (launchStep.isHit) {
            if (launchStep.ignited && launchStep.ignitedCellIndexes) {
              triggerCellExplosions('player', launchStep.ignitedCellIndexes);
            } else {
              triggerCellExplosions('player', [launchStep.cellIndex]);
            }
          }
          if (launchStep.audioSequence.length > 0) {
            if (launchStep.ignited) {
              playIgnitionSequence(launchStep.audioSequence);
            } else {
              playAudioSequence(launchStep.audioSequence);
            }
          }

          const hasTravel = travelSteps.length > 0;

          if (hasTravel) {
            // Keeps currentTurn at 'app' through the whole travel animation,
            // so the player can't act (or this effect re-enter) until the
            // rocket fully resolves - see the top-of-effect guard above.
            appWeaponInFlightRef.current = true;
          }

          const nextState: GameState = finalizeShotState(
            {
              ...currentState,
              currentTurn: hasTravel ? 'app' : nextTurnAfterAppFire(launchStep.navy),
              player: launchStep.navy,
              appRocketCount: currentState.appRocketCount - 1,
              appWeaponsUsed: currentState.appWeaponsUsed + 1,
              appMineIndex,
            },
            'app',
            shotOutcome,
            mineWanderOilDetonationSize,
          );

          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));

          if (!hasTravel) {
            const hasStaggered = mineCausedExtendedDelay || weaponHasStaggeredOutcome(result.steps);
            window.setTimeout(() => setAppFiringWeaponType((current) => (current === 'rocket' ? null : current)), WEAPON_FIRE_ANIMATION_MS);

            if (areAllShipsSunk(launchStep.navy, shipSetOptions)) {
              concludeGame('app', nextState);
            } else {
              window.setTimeout(() => {
                setActiveView('enemy');
              }, hasStaggered ? 2000 : 1000);
            }

            return nextState;
          }

          runWeaponTravelSteps('player', travelSteps, 0, () => {
            setAppFiringWeaponType((current) => (current === 'rocket' ? null : current));
            setGameState((current) => {
              if (!current) {
                return current;
              }

              const hasStaggered = mineCausedExtendedDelay || weaponHasStaggeredOutcome(result.steps);

              appWeaponInFlightRef.current = false;

              if (areAllShipsSunk(current.player, shipSetOptions)) {
                concludeGame('app', current);
                return current;
              }

              const resolvedState: GameState = { ...current, currentTurn: 'player' };
              window.localStorage.setItem(STORAGE_KEY, JSON.stringify(resolvedState));

              window.setTimeout(() => {
                setActiveView('enemy');
              }, hasStaggered ? 2000 : 1000);

              return resolvedState;
            });
          });

          return nextState;
        }

        if (weaponChoice === 'harpoon') {
          const result = fireHarpoon(currentPlayer, previewIndex);
          const [launchStep, ...travelSteps] = result.steps;
          const shotOutcome = shotOutcomeFromTravelSteps(result.steps);

          if (launchStep.isHit) {
            if (launchStep.ignited && launchStep.ignitedCellIndexes) {
              triggerCellExplosions('player', launchStep.ignitedCellIndexes);
            } else {
              triggerCellExplosions('player', [launchStep.cellIndex]);
            }
          }
          if (launchStep.audioSequence.length > 0) {
            if (launchStep.ignited) {
              playIgnitionSequence(launchStep.audioSequence);
            } else {
              playAudioSequence(launchStep.audioSequence);
            }
          }

          const hasTravel = travelSteps.length > 0;

          if (hasTravel) {
            // Keeps currentTurn at 'app' through the whole travel animation,
            // so the player can't act (or this effect re-enter) until the
            // harpoon fully resolves - see the top-of-effect guard above.
            appWeaponInFlightRef.current = true;
          }

          const nextState: GameState = finalizeShotState(
            {
              ...currentState,
              currentTurn: hasTravel ? 'app' : nextTurnAfterAppFire(launchStep.navy),
              player: launchStep.navy,
              appHarpoonCount: currentState.appHarpoonCount - 1,
              appWeaponsUsed: currentState.appWeaponsUsed + 1,
              appMineIndex,
            },
            'app',
            shotOutcome,
            mineWanderOilDetonationSize,
          );

          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));

          if (!hasTravel) {
            const hasStaggered = mineCausedExtendedDelay || weaponHasStaggeredOutcome(result.steps);
            window.setTimeout(() => setAppFiringWeaponType((current) => (current === 'harpoon' ? null : current)), WEAPON_FIRE_ANIMATION_MS);

            if (areAllShipsSunk(launchStep.navy, shipSetOptions)) {
              concludeGame('app', nextState);
            } else {
              window.setTimeout(() => {
                setActiveView('enemy');
              }, hasStaggered ? 2000 : 1000);
            }

            return nextState;
          }

          runWeaponTravelSteps('player', travelSteps, 0, () => {
            setAppFiringWeaponType((current) => (current === 'harpoon' ? null : current));
            setGameState((current) => {
              if (!current) {
                return current;
              }

              const hasStaggered = mineCausedExtendedDelay || weaponHasStaggeredOutcome(result.steps);

              appWeaponInFlightRef.current = false;

              if (areAllShipsSunk(current.player, shipSetOptions)) {
                concludeGame('app', current);
                return current;
              }

              const resolvedState: GameState = { ...current, currentTurn: 'player' };
              window.localStorage.setItem(STORAGE_KEY, JSON.stringify(resolvedState));

              window.setTimeout(() => {
                setActiveView('enemy');
              }, hasStaggered ? 2000 : 1000);

              return resolvedState;
            });
          });

          return nextState;
        }

        if (weaponChoice === 'drone') {
          const { navy: updatedPlayer } = fireDrone(currentPlayer, previewIndex);
          window.setTimeout(() => setAppFiringWeaponType((current) => (current === 'drone' ? null : current)), WEAPON_FIRE_ANIMATION_MS);

          const nextState: GameState = finalizeShotState(
            {
              ...currentState,
              currentTurn: 'player',
              player: updatedPlayer,
              appDroneCount: currentState.appDroneCount - 1,
              appWeaponsUsed: currentState.appWeaponsUsed + 1,
              appMineIndex,
            },
            'app',
            DRONE_SHOT_OUTCOME,
            mineWanderOilDetonationSize,
          );

          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));

          window.setTimeout(() => {
            setActiveView('enemy');
          }, mineCausedExtendedDelay ? 2000 : 1000);

          return nextState;
        }

        const playerWithTargetedCell = setCellState(currentPlayer, previewIndex, {
          effect: 'targeted',
          targeting: false,
        });
        const plainShotResult = resolveTargetingSequence(playerWithTargetedCell, [previewIndex]);
        const { navy: updatedPlayer, audioSequence, ignited, ignitedCellIndexes } = plainShotResult;

        if (ignited && ignitedCellIndexes) {
          triggerCellExplosions('player', ignitedCellIndexes);
        } else if (currentPlayer.cells[previewIndex]?.occupied) {
          triggerCellExplosions('player', [previewIndex]);
        }

        const hasStaggered = mineCausedExtendedDelay || audioSequence.includes('sink') || Boolean(ignited);
        const shotOutcome = shotOutcomeFromTargetingResult(plainShotResult, [previewIndex], true);

        const nextState: GameState = finalizeShotState(
          {
            ...currentState,
            currentTurn: nextTurnAfterAppFire(updatedPlayer),
            player: updatedPlayer,
            appMineIndex,
          },
          'app',
          shotOutcome,
          mineWanderOilDetonationSize,
        );

        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
        if (ignited) {
          playIgnitionSequence(audioSequence);
        } else {
          playAudioSequence(audioSequence);
        }

        if (areAllShipsSunk(updatedPlayer, shipSetOptions)) {
          concludeGame('app', nextState);
        } else {
          window.setTimeout(() => {
            setActiveView('enemy');
          }, hasStaggered ? 2000 : 1000);
        }

        return nextState;
      });
    }, 1450);

    return () => {
      window.clearTimeout(showPlayerDelay);
      window.clearTimeout(previewDelay);
      window.clearTimeout(executeTargetingDelay);
    };
  }, [isGameConcluded, gameState, shipSetOptions]);

  // Safety net: an armed weapon only ever makes sense while it's the
  // player's move. If the turn moves on (or a new game starts) without it
  // being fired, drop the armed state instead of leaving it stuck armed.
  useEffect(() => {
    if (!gameState || gameState.currentTurn !== 'player' || isGameConcluded) {
      setArmedWeapon(null);
    }
  }, [gameState, isGameConcluded]);

  // Same safety net, mirrored for the computer's own armed/firing dot
  // indicators - only meaningful while it's the computer's move.
  useEffect(() => {
    if (!gameState || gameState.currentTurn !== 'app' || isGameConcluded) {
      setAppArmedWeapon(null);
      setAppFiringWeaponType(null);
    }
  }, [gameState, isGameConcluded]);

  // Null until at least one game has been completed. No longer shown as
  // its own header badge (see GAME_DESIGN.md) - now that the Statistics
  // dialog exists, a standing header badge just duplicated its own "Wins"
  // row - still used for the Statistics row itself and the Victory/Defeat
  // dialog's callout.
  const winsLabel = sessionStats.gamesPlayed > 0
    ? `Wins: ${sessionStats.gamesWon}/${sessionStats.gamesPlayed} (${Math.round((sessionStats.gamesWon / sessionStats.gamesPlayed) * 100)}%)`
    : null;

  // The Statistics dialog's full list - see GAME_DESIGN.md's Statistics
  // section for what each of these means and how it's tracked.
  // pluralize the same way the underlying records themselves are pluralized
  // (see armada-game.ts's own pluralize) so the two stay consistent.
  const pluralizeStat = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
  const statisticsRows: { label: string; value: string }[] = [
    // winsLabel already reads "Wins: X/Y (Z%)" for the header badge, which
    // would repeat the row's own "Wins" label here - strip that prefix so
    // the row just shows the ratio.
    { label: 'Wins', value: winsLabel ? winsLabel.replace(/^Wins:\s*/, '') : 'No games played yet' },
    { label: 'Current Daily Win Streak', value: String(sessionStats.currentDailyWinStreak) },
    { label: 'Best Daily Win Streak', value: String(sessionStats.bestDailyWinStreak) },
    { label: 'Quickest Win', value: sessionStats.quickestWin === null ? '—' : pluralizeStat(sessionStats.quickestWin, 'shot') },
    { label: 'Quickest Loss', value: sessionStats.quickestLoss === null ? '—' : pluralizeStat(sessionStats.quickestLoss, 'shot') },
    { label: 'Margin of Victory', value: sessionStats.marginOfVictory === null ? '—' : pluralizeStat(sessionStats.marginOfVictory, 'cell') },
    { label: 'Margin of Defeat', value: sessionStats.marginOfDefeat === null ? '—' : pluralizeStat(sessionStats.marginOfDefeat, 'cell') },
    { label: 'Current Win Streak', value: String(sessionStats.currentWinStreak) },
    { label: 'Best Win Streak', value: String(sessionStats.bestWinStreak) },
    { label: 'Longest Hit Streak (Me)', value: String(sessionStats.longestHitStreakPlayer) },
    { label: 'Longest Hit Streak (Enemy)', value: String(sessionStats.longestHitStreakApp) },
    { label: 'Biggest Oil Detonation (Me)', value: pluralizeStat(sessionStats.biggestOilDetonationPlayer, 'cell') },
    { label: 'Biggest Oil Detonation (Enemy)', value: pluralizeStat(sessionStats.biggestOilDetonationApp, 'cell') },
  ];

  const renderNavyPanel = (
    side: NavySide,
    navy: NavyState,
    { showArrows, showSettings }: { showArrows: boolean; showSettings: boolean },
  ) => (
    <NavyPanel
      key={side}
      navy={navy}
      shipSetOptions={shipSetOptions}
      onSinglesToggle={handleSinglesToggle}
      onNewGame={() => requestNewGame()}
      onShowStatistics={() => setInfoDialog('statistics')}
      onShowAboutShips={() => setInfoDialog('ships')}
      onShowAboutWeapons={() => setInfoDialog('weapons')}
      onGoLeft={showArrows && canGoLeft && side === activeView ? () => setActiveView('player') : undefined}
      onGoRight={showArrows && canGoRight && side === activeView ? () => setActiveView('enemy') : undefined}
      onTargetCell={side === 'enemy' ? (cellIndex) => handleTargetEnemyCell(cellIndex) : undefined}
      onCellPressStart={side === 'enemy' ? handleEnemyCellPressStart : undefined}
      onCellPressEnd={side === 'enemy' ? handleEnemyCellPressEnd : undefined}
      onCellPressCancel={side === 'enemy' ? handleEnemyCellPressCancel : undefined}
      isCellTargetable={side === 'enemy' ? (cell) => !isWeaponInFlight && cell.effect === 'untargeted' && !cell.targeting : undefined}
      explodingCellIndexes={explosionCells[side]}
      showSettings={showSettings}
      reserveArrowSpace={showArrows}
      mineIndex={side === 'enemy' ? gameState?.playerMineIndex : gameState?.appMineIndex}
      armedWeapon={side === 'enemy' ? armedWeapon : undefined}
      weaponsBarSlot={renderWeaponsBarForSide(side)}
    />
  );

  const isPlayerTurnActive = Boolean(gameState) && gameState?.currentTurn === 'player' && !isGameConcluded && !isWeaponInFlight;
  const playerWeaponsUsed = gameState?.playerWeaponsUsed ?? 0;
  const weaponQuotaReached = playerWeaponsUsed >= SPECIAL_WEAPON_QUOTA;
  const hasActiveMine = (gameState?.playerMineIndex ?? null) !== null;

  const isWeaponTypeDisabled = (weapon: WeaponType): boolean =>
    !isPlayerTurnActive
    || weaponQuotaReached
    || (gameState?.playerWeaponUseCounts[weapon] ?? 0) >= WEAPON_TYPE_USE_CAP
    || (weapon === 'mine' && hasActiveMine);

  // Each grid gets the weapons bar relevant to looking at it: the enemy
  // grid is where you'd arm and fire, so it gets "My Weapons"; your own
  // grid is where the computer's shots land, so it gets "Enemy Weapons" to
  // watch its count/dots change if it ever fires one. Only whichever 3 of
  // the 6 types were drawn into this game (gameState.activeWeaponTypes)
  // ever render a button, identically on both bars.
  const renderWeaponsBarForSide = (side: NavySide) => {
    const activeWeaponTypes = gameState?.activeWeaponTypes ?? [];

    if (side === 'player') {
      const appCounts: Record<WeaponType, number> = {
        moab: gameState?.appMoabCount ?? 0,
        mine: gameState?.appMineCount ?? 0,
        torpedo: gameState?.appTorpedoCount ?? 0,
        rocket: gameState?.appRocketCount ?? 0,
        harpoon: gameState?.appHarpoonCount ?? 0,
        drone: gameState?.appDroneCount ?? 0,
      };

      return (
        <WeaponsBar
          key="enemy-weapons"
          label="Enemy Weapons"
          weaponsUsed={gameState?.appWeaponsUsed ?? 0}
          weapons={activeWeaponTypes.map((type) => ({
            type,
            count: appCounts[type],
            // The computer's own per-type standing count starts at exactly
            // WEAPON_TYPE_USE_CAP and never resets mid-game, so uses-so-far
            // is just the cap minus whatever's left.
            useCount: WEAPON_TYPE_USE_CAP - appCounts[type],
            isArmed: false,
            isPending: appArmedWeapon === type || appFiringWeaponType === type,
            disabled: true,
          }))}
        />
      );
    }

    const playerCounts: Record<WeaponType, number> = {
      moab: moabCount,
      mine: mineCount,
      torpedo: torpedoCount,
      rocket: rocketCount,
      harpoon: harpoonCount,
      drone: droneCount,
    };

    return (
      <WeaponsBar
        key="my-weapons"
        label="My Weapons"
        weaponsUsed={playerWeaponsUsed}
        weapons={activeWeaponTypes.map((type) => ({
          type,
          count: playerCounts[type],
          useCount: gameState?.playerWeaponUseCounts[type] ?? 0,
          isArmed: armedWeapon === type,
          isPending: armedWeapon === type || firingWeaponType === type,
          disabled: isWeaponTypeDisabled(type),
          onClick: () => handleWeaponButtonClick(type),
        }))}
      />
    );
  };

  if (showTitleScreen) {
    return <TitleScreen onPlay={() => setShowTitleScreen(false)} />;
  }

  return (
    <>
      <main className="min-h-screen overflow-hidden bg-slate-950 text-slate-50">
      <div className="relative isolate min-h-screen bg-[radial-gradient(circle_at_top,_rgba(125,211,252,0.18),_transparent_40%),linear-gradient(180deg,_#020617_0%,_#0f172a_45%,_#111827_100%)]">
        <div className={cn('mx-auto flex min-h-screen w-full flex-col px-3 pb-3 pt-2 sm:px-4', isDesktopLayout ? 'max-w-5xl' : 'max-w-sm')}>
          {gameState && activeNavy ? (
            isDesktopLayout ? (
              <section className="flex min-h-0 flex-1 flex-col gap-3">
                <div className="rounded-[24px] border border-white/10 bg-white/5 p-2.5 shadow-[0_18px_60px_rgba(14,116,144,0.16)] backdrop-blur-md">
                  <div className="grid grid-cols-2 gap-6">
                    {navyViewOrder.map((side) =>
                      renderNavyPanel(side, side === 'player' ? gameState.player : gameState.enemy, {
                        showArrows: false,
                        showSettings: side === 'enemy',
                      }),
                    )}
                  </div>
                </div>
              </section>
            ) : (
              <section className="flex min-h-0 flex-1 flex-col gap-2">
                <div ref={swipeViewportRef} className="overflow-hidden rounded-[24px] border border-white/10 bg-white/5 shadow-[0_18px_60px_rgba(14,116,144,0.16)] backdrop-blur-md">
                  <div
                    className={`flex w-[200%] ${instantViewSwitch ? '' : 'transition-transform duration-1000 ease-out'}`}
                    style={
                      panelWidth
                        ? { width: panelWidth * 2, transform: `translateX(-${activeIndex * panelWidth}px)` }
                        : { transform: `translateX(-${activeIndex * 50}%)` }
                    }
                  >
                    {navyViewOrder.map((side) => (
                      <div
                        key={side}
                        className="flex w-1/2 shrink-0 flex-col gap-2 p-2.5"
                        style={panelWidth ? { width: panelWidth } : undefined}
                      >
                        {renderNavyPanel(side, side === 'player' ? gameState.player : gameState.enemy, {
                          showArrows: true,
                          showSettings: true,
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )
          ) : (
            <Card className="border-white/10 bg-white/5 text-white shadow-2xl shadow-cyan-950/20 backdrop-blur-md">
              <CardHeader>
                <CardTitle>Preparing fleets</CardTitle>
                <CardDescription className="text-slate-300">
                  Building a fresh random setup for both navies.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="h-3 rounded-full bg-white/10">
                    <div className="h-3 w-2/3 animate-pulse rounded-full bg-cyan-300/60" />
                  </div>
                  <div className="grid grid-cols-6 gap-2">
                    {Array.from({ length: 24 }, (_, index) => (
                      <div key={index} className="aspect-square rounded-md bg-white/10" />
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      </main>

      <Dialog
        open={gameOver.isOpen}
        modal={false}
        // The only sensible destination once a game has concluded - there's
        // no "cancel" that makes sense here, so the dialog's own close
        // button (top-right X, from DialogContent's built-in
        // DialogPrimitive.Close) does the same thing OK does instead of
        // silently doing nothing (Dialog is otherwise fully externally
        // controlled via gameOver.isOpen, so without this, that built-in
        // close button had nothing wired to actually call).
        onOpenChange={(open) => {
          if (!open) {
            requestNewGame();
          }
        }}
      >
        <DialogContent
          overlayClassName="pointer-events-none"
          // Anchored a fixed distance above the bottom edge (not the
          // previous top-[75%]/translate-y-[-50%] centering) so it only
          // ever grows upward, no matter how long the records list below
          // gets - a box centered on a fixed point can grow off the bottom
          // of the screen once it's tall enough, with no way to reach
          // whatever fell past the edge (position: fixed isn't page
          // scrollable). max-h/overflow-y-auto here is just a last-resort
          // safety net (e.g. a huge system font size) - the records list's
          // own scroll box below is what actually keeps this short in
          // ordinary cases.
          className="bottom-6 top-auto flex max-h-[80vh] max-w-sm translate-y-0 flex-col overflow-y-auto rounded-2xl border-white/10 bg-slate-950 text-white sm:bottom-6 sm:top-auto"
        >
          <DialogHeader>
            <DialogTitle>{gameOver.winner === 'player' ? 'Victory' : 'Defeat'}</DialogTitle>
            <DialogDescription className="text-slate-300">
              {gameOver.winner === 'player'
                ? 'Congratulations, you won! Click OK to play again.'
                : 'You lost! Click OK to play again.'}
            </DialogDescription>
          </DialogHeader>
          {winsLabel || gameOverRecordUpdates.length > 0 ? (
            <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
              {winsLabel ? <p className="font-semibold text-cyan-100">{winsLabel}</p> : null}
              {gameOverRecordUpdates.length > 0 ? (
                <ul className="space-y-1 text-slate-300">
                  {gameOverRecordUpdates.map((update) => (
                    <li key={update}>{update}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" onClick={() => requestNewGame()} className="w-full sm:w-auto">
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={infoDialog === 'statistics'} onOpenChange={(open) => setInfoDialog(open ? 'statistics' : null)}>
        <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto rounded-2xl border-white/10 bg-slate-950 text-white">
          <DialogHeader>
            <DialogTitle>Statistics</DialogTitle>
            <DialogDescription className="text-slate-300">Your lifetime record against the computer.</DialogDescription>
          </DialogHeader>
          <ul className="divide-y divide-white/10">
            {statisticsRows.map((row) => (
              <li key={row.label} className="flex items-baseline justify-between gap-4 py-2 text-sm">
                <span className="text-slate-300">{row.label}</span>
                <span className="whitespace-nowrap font-semibold text-cyan-100">{row.value}</span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button type="button" variant="destructive" onClick={handleResetStatistics} className="w-full sm:w-auto">
              Reset Statistics
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={infoDialog === 'ships'} onOpenChange={(open) => setInfoDialog(open ? 'ships' : null)}>
        <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto rounded-2xl border-white/10 bg-slate-950 text-white">
          <DialogHeader>
            <DialogTitle>About Ships</DialogTitle>
            <DialogDescription className="text-slate-300">Every ship in the fleet, alphabetically.</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2.5 text-sm text-slate-200">
            {SHIP_REFERENCE.map((ship) => (
              <li key={ship.code} className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 font-mono text-xs font-semibold text-cyan-100">
                  {ship.code}
                </span>
                <span>
                  <span className="font-semibold">{ship.name}</span>
                  {' - '}
                  {SHIP_REFERENCE_DESCRIPTIONS[ship.code]}
                </span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      <Dialog open={infoDialog === 'weapons'} onOpenChange={(open) => setInfoDialog(open ? 'weapons' : null)}>
        <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto rounded-2xl border-white/10 bg-slate-950 text-white">
          <DialogHeader>
            <DialogTitle>About Weapons</DialogTitle>
            <DialogDescription className="text-slate-300">
              Every weapon type, alphabetically. Three are chosen at random each game.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2.5 text-sm text-slate-200">
            {WEAPON_REFERENCE_ORDER.map((weaponType) => (
              <li key={weaponType} className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-cyan-100">
                  {WEAPON_DISPLAY[weaponType].icon}
                </span>
                <span>
                  <span className="font-semibold">{WEAPON_DISPLAY[weaponType].label}</span>
                  {' - '}
                  {WEAPON_REFERENCE_DESCRIPTIONS[weaponType]}
                </span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingWeaponProcurement !== null}
        onOpenChange={(open) => {
          if (!open) {
            cancelWeaponProcurement();
          }
        }}
      >
        <DialogContent className="max-w-sm rounded-2xl border-white/10 bg-slate-950 text-white">
          <DialogHeader>
            <DialogTitle>Out of {pendingWeaponProcurement ? WEAPON_DISPLAY[pendingWeaponProcurement].label : 'Ammo'}</DialogTitle>
            <DialogDescription className="text-slate-300">
              Watch an ad to procure {pendingWeaponProcurement ? WEAPON_REFILL_COUNTS[pendingWeaponProcurement] : ''} more?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={cancelWeaponProcurement} className="w-full sm:w-auto">
              No
            </Button>
            <Button type="button" onClick={confirmWeaponProcurement} className="w-full sm:w-auto">
              Watch Ad
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {procuringWeapon ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="rounded-2xl border border-white/10 bg-slate-950 px-6 py-5 text-center text-sm font-semibold uppercase tracking-[0.2em] text-cyan-100 shadow-2xl">
            Procuring Weapons
          </div>
        </div>
      ) : null}

      {/* Can never render while showTitleScreen is true - that branch
          returns above before reaching this JSX at all - so this never
          collides with the splash even when requestNewGame's own ad-gate
          fires from the very first game a fresh install creates. */}
      {isWatchingAdForNewGame ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="rounded-2xl border border-white/10 bg-slate-950 px-6 py-5 text-center text-sm font-semibold uppercase tracking-[0.2em] text-cyan-100 shadow-2xl">
            Loading Ad
          </div>
        </div>
      ) : null}
    </>
  );
};

// Centralizes each weapon type's icon/label so the (now data-driven)
// WeaponsBar doesn't need a hardcoded JSX block per type.
const WEAPON_DISPLAY: Record<WeaponType, { icon: ReactNode; label: string }> = {
  moab: { icon: <Bomb className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />, label: 'MOAB' },
  mine: { icon: <CircleDot className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />, label: 'MINE' },
  torpedo: { icon: <ArrowRightLeft className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />, label: 'TORPEDO' },
  rocket: { icon: <ArrowUpDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />, label: 'ROCKET' },
  harpoon: { icon: <MoveDiagonal className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />, label: 'HARPOON' },
  drone: { icon: <Radar className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />, label: 'DRONE' },
};

// How many charges a "Procuring Weapons" refill grants per weapon type -
// shared by beginWeaponProcurement (which actually applies it) and the
// confirmation dialog's copy (which quotes it up front), so the two can
// never drift out of sync if refill amounts ever vary by weapon.
const WEAPON_REFILL_COUNTS: Record<WeaponType, number> = {
  moab: MOAB_REFILL_COUNT,
  mine: MINE_REFILL_COUNT,
  torpedo: TORPEDO_REFILL_COUNT,
  rocket: ROCKET_REFILL_COUNT,
  harpoon: HARPOON_REFILL_COUNT,
  drone: DRONE_REFILL_COUNT,
};

// Reference copy for the "About Ships" dialog - characteristics only, no
// gameplay tactics (a future "Getting Started" sequence owns that). Always
// built from the full roster (Singles included) since this is a standing
// reference, not a reflection of the current game's ship-set toggle.
const SHIP_REFERENCE_DESCRIPTIONS: Record<string, string> = {
  A: 'The largest ship in the fleet, spanning 5 cells.',
  B: 'A 4-cell warship.',
  C: 'A 3-cell warship.',
  D: 'A 3-cell warship.',
  E: 'A lonely officer, floating in the waves. One of three optional "Singles" - only in play when Singles is turned on in Settings. Can be exposed but not damaged by Harpoons, Mines, Rockets, or Torpedoes',
  F: 'A 3-cell warship.',
  G: 'A 2-cell support vessel.',
  H: 'A rotor-wing aircraft. One of three optional "Singles" - only in play when Singles is turned on in Settings. Can be exposed but not damaged by Harpoons, Mines, or Torpedoes.',
  L: 'Women and children first! One of three optional "Singles" - only in play when Singles is turned on in Settings.',
  O: "A 3-cell vessel carrying a volatile cargo. Sinking it spills an oil slick that spreads across the board over time and can ignite if struck, taking out anything still underneath it.",
  S: 'A 2-cell vessel. Can be exposed but not damaged by MOABs or Rockets',
};
const SHIP_REFERENCE: ShipDefinition[] = getShips({ includeSingles: true })
  .slice()
  .sort((a, b) => a.name.localeCompare(b.name));

// Reference copy for the "About Weapons" dialog, in the same alphabetical
// (by label) order as WEAPON_DISPLAY's labels sort - characteristics only.
const WEAPON_REFERENCE_ORDER: WeaponType[] = ['drone', 'harpoon', 'mine', 'moab', 'rocket', 'torpedo'];
const WEAPON_REFERENCE_DESCRIPTIONS: Record<WeaponType, string> = {
  drone: 'Reveals the fog of war in a diamond-shaped area around the targeted cell, without attacking or firing a shot.',
  harpoon: "Launches on a fixed diagonal line, striking every ship it crosses along the way.",
  mine: "Deploys at a chosen cell and drifts to a neighboring cell every turn until it finds a ship. Only one Mine can be active at a time, and it always takes out two of a ship's cells when it strikes.",
  moab: 'Mother Of All Bombs. Detonates in a blast covering the targeted cell and all eight cells around it at once.',
  rocket: 'Launches on a fixed vertical line, striking every ship it crosses along the way.',
  torpedo: 'Launches on a fixed horizontal line, striking every ship it crosses along the way.',
};

type WeaponsBarProps = {
  label: string;
  weaponsUsed: number;
  /** Exactly ACTIVE_WEAPON_TYPE_COUNT (3) entries - whichever weapon types this game drew, in canonical order. */
  weapons: Array<{
    type: WeaponType;
    count: number;
    /** How many of this side's WEAPON_TYPE_USE_CAP uses of this type are already spent this game. */
    useCount: number;
    isArmed: boolean;
    /** Armed (about to fire) or fired-but-still-animating - flashes this type's next-to-spend dot. */
    isPending: boolean;
    disabled: boolean;
    onClick?: () => void;
  }>;
};

type WeaponButtonProps = {
  icon: ReactNode;
  label: string;
  count: number;
  useCount: number;
  isArmed: boolean;
  isPending: boolean;
  disabled: boolean;
  onClick?: () => void;
};

function WeaponButton({ icon, label, count, useCount, isArmed, isPending, disabled, onClick }: WeaponButtonProps) {
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={isArmed}
      className={cn(
        'relative h-auto w-full gap-1 rounded-full border px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-white',
        isArmed
          ? 'border-cyan-300 bg-cyan-400/20 text-cyan-100 shadow-[0_0_0_2px_rgba(103,232,249,0.4)] hover:bg-cyan-400/30'
          : 'border-white/10 bg-white/10 hover:bg-white/20',
      )}
    >
      <span
        className="absolute -top-1 -right-1 flex items-center gap-0.5"
        role="img"
        aria-label={`${WEAPON_TYPE_USE_CAP - useCount} of ${WEAPON_TYPE_USE_CAP} uses remaining this game`}
      >
        {Array.from({ length: WEAPON_TYPE_USE_CAP }, (_, index) => {
          const isPendingDot = isPending && index === useCount;
          return (
            <span
              key={index}
              className={cn(
                'h-2 w-2 rounded-full ring-2 ring-slate-950',
                index < useCount ? 'bg-red-500' : isPendingDot ? 'bg-green-400' : 'bg-green-500',
                isPendingDot ? 'animate-pulse' : null,
              )}
              // Tailwind's animate-pulse defaults to a 2s cycle - noticeably
              // quicker here so an armed/firing weapon reads as urgent, not
              // just "different."
              style={isPendingDot ? { animationDuration: '0.6s' } : undefined}
            />
          );
        })}
      </span>
      {icon}
      {label}
      <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-slate-950/60 px-1 text-[9px] font-bold">
        {count}
      </span>
    </Button>
  );
}

function WeaponsBar({ label, weaponsUsed, weapons }: WeaponsBarProps) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-md">
      <div className="relative flex min-h-6 items-center">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-100/70">
          {label}
        </div>

        <div
          className="ml-auto flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-1.5"
          role="img"
          aria-label={`${SPECIAL_WEAPON_QUOTA - weaponsUsed} of ${SPECIAL_WEAPON_QUOTA} special weapon uses remaining this game`}
        >
          {Array.from({ length: SPECIAL_WEAPON_QUOTA }, (_, index) => (
            <span
              key={index}
              className={cn('h-2 w-2 rounded-full', index < weaponsUsed ? 'bg-red-500' : 'bg-green-500')}
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {weapons.map((weapon) => (
          <WeaponButton
            key={weapon.type}
            icon={WEAPON_DISPLAY[weapon.type].icon}
            label={WEAPON_DISPLAY[weapon.type].label}
            count={weapon.count}
            useCount={weapon.useCount}
            isArmed={weapon.isArmed}
            isPending={weapon.isPending}
            disabled={weapon.disabled}
            onClick={weapon.onClick}
          />
        ))}
      </div>
    </div>
  );
}

type NavyPanelProps = {
  navy: NavyState;
  shipSetOptions: ShipSetOptions;
  onSinglesToggle: (includeSingles: boolean) => void;
  onNewGame: () => void;
  onShowStatistics: () => void;
  onShowAboutShips: () => void;
  onShowAboutWeapons: () => void;
  onGoLeft?: () => void;
  onGoRight?: () => void;
  onTargetCell?: (cellIndex: number) => void;
  onCellPressStart?: (cellIndex: number) => void;
  onCellPressEnd?: (cellIndex: number) => void;
  onCellPressCancel?: (cellIndex: number) => void;
  isCellTargetable?: (cell: CellState) => boolean;
  explodingCellIndexes?: number[];
  showSettings?: boolean;
  reserveArrowSpace?: boolean;
  /** Index within this navy's cells currently holding an active mine, if any. */
  mineIndex?: number | null;
  /** Which weapon (if any) is currently armed against this navy's grid. */
  armedWeapon?: WeaponType | null;
  /** Rendered between the grid and the ship registry, so arming/firing a weapon doesn't require hopping over the registry. */
  weaponsBarSlot?: ReactNode;
};

type SettingsMenuProps = {
  shipSetOptions: ShipSetOptions;
  onSinglesToggle: (includeSingles: boolean) => void;
  onNewGame: () => void;
  onShowStatistics: () => void;
  onShowAboutShips: () => void;
  onShowAboutWeapons: () => void;
};

function SettingsMenu({
  shipSetOptions,
  onSinglesToggle,
  onNewGame,
  onShowStatistics,
  onShowAboutShips,
  onShowAboutWeapons,
}: SettingsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="h-8 w-8 shrink-0 rounded-full border border-white/10 bg-white/10 text-white hover:bg-white/20"
          aria-label="Open settings"
        >
          <Settings className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={onNewGame}>New Game</DropdownMenuItem>
        <DropdownMenuCheckboxItem
          checked={shipSetOptions.includeSingles}
          onSelect={() => onSinglesToggle(!shipSetOptions.includeSingles)}
          indicatorAlign="right"
        >
          Singles (E H L)
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onShowStatistics}>Statistics</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onShowAboutShips}>About Ships</DropdownMenuItem>
        <DropdownMenuItem onSelect={onShowAboutWeapons}>About Weapons</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NavyPanel({
  navy,
  shipSetOptions,
  onSinglesToggle,
  onNewGame,
  onShowStatistics,
  onShowAboutShips,
  onShowAboutWeapons,
  onGoLeft,
  onGoRight,
  onTargetCell,
  onCellPressStart,
  onCellPressEnd,
  onCellPressCancel,
  isCellTargetable,
  explodingCellIndexes,
  showSettings = true,
  reserveArrowSpace = true,
  mineIndex = null,
  armedWeapon = null,
  weaponsBarSlot = null,
}: NavyPanelProps) {
  const availableShips = useMemo(() => getShips(shipSetOptions), [shipSetOptions]);
  const [openTooltipCode, setOpenTooltipCode] = useState<string | null>(null);
  const tooltipDismissTimeoutRef = useRef<number | null>(null);

  const revealShipTooltip = (code: string) => {
    if (tooltipDismissTimeoutRef.current) {
      window.clearTimeout(tooltipDismissTimeoutRef.current);
    }

    setOpenTooltipCode(code);
    tooltipDismissTimeoutRef.current = window.setTimeout(() => {
      setOpenTooltipCode(null);
      tooltipDismissTimeoutRef.current = null;
    }, 2000);
  };

  // Counts up as the fleet takes damage: a hit is any occupied cell no
  // longer 'untargeted' (targeted or sunk), out of every occupied cell
  // this navy started with - so it reaches occupiedCellCount exactly when
  // every ship is fully sunk.
  const occupiedCellCount = useMemo(
    () => navy.cells.filter((cell) => cell.occupied).length,
    [navy.cells],
  );
  const hitCellCount = useMemo(
    () => navy.cells.filter((cell) => cell.occupied && cell.effect !== 'untargeted').length,
    [navy.cells],
  );

  const shipStatusByCode = useMemo(() => {
    return availableShips.reduce<Record<string, { targetedCount: number; isSunk: boolean }>>((accumulator, ship) => {
      const shipCells = navy.cells.filter((cell) => cell.shipCode === ship.code);
      const targetedCount = shipCells.filter((cell) => cell.effect === 'targeted').length;
      const isSunk = shipCells.length > 0 && shipCells.every((cell) => cell.effect === 'sunk');

      accumulator[ship.code] = { targetedCount, isSunk };
      return accumulator;
    }, {});
  }, [availableShips, navy.cells]);

  // Length-descending, alphabetical within a tier - a "triangle" - split
  // roughly in half and the second half re-sorted length-ascending, so the
  // legend reads as an hourglass (two columns, tapering toward the middle)
  // instead of one tall column with several single-character rows at the
  // bottom. The right column re-sorts rather than just reversing the left
  // column's slice, since a plain .reverse() would also flip the
  // alphabetical order within each length tier to descending - it should
  // stay ascending on both sides, only the length direction mirrors.
  const [leftColumnShips, rightColumnShips] = useMemo(() => {
    const sorted = [...availableShips].sort((a, b) => b.length - a.length || a.code.localeCompare(b.code));

    // Manual aesthetic swap: Oil Tanker into the right column, Garbage Scow
    // into the left. Both are otherwise "filler" ships in the middle of the
    // triangle, but swapping them gives each column a cleaner, more
    // consistently tapering shape (left ends ...,3,3,2 instead of
    // ...,3,3,3; right becomes 1,1,1,2,3 instead of 1,1,1,2,2).
    const oilIndex = sorted.findIndex((ship) => ship.code === 'O');
    const scowIndex = sorted.findIndex((ship) => ship.code === 'G');
    if (oilIndex !== -1 && scowIndex !== -1) {
      [sorted[oilIndex], sorted[scowIndex]] = [sorted[scowIndex], sorted[oilIndex]];
    }

    const splitIndex = Math.ceil(sorted.length / 2);
    const rightColumn = sorted.slice(splitIndex).sort((a, b) => a.length - b.length || a.code.localeCompare(b.code));
    return [sorted.slice(0, splitIndex), rightColumn];
  }, [availableShips]);

  // leftColumnShips is always either the same length as rightColumnShips
  // (an even ship-type count - Singles off) or exactly one longer (an odd
  // count - Singles on, splitIndex rounds up), so the grid's very last row
  // already has an empty right-column cell in exactly the Singles-on case.
  // The Hits stat below reuses that existing gap there instead of adding a
  // whole extra row, and only adds one of its own when there isn't a gap
  // to reuse.
  const shipRowCount = Math.max(leftColumnShips.length, rightColumnShips.length);
  const hitsFillsTrailingGap = rightColumnShips.length < leftColumnShips.length;

  // The ship-legend grid below is centered (justify-center) and its own
  // columns are sized to max-content, so a cell placed *inside* it can only
  // ever be as wide as its own text - there's no slack left for justify-end
  // to align against, and the grid block itself sits narrower than, and
  // centered within, the surrounding padded container. To actually reach
  // that wider container's right edge (matching the grid/weapons bar above
  // it), this renders as an absolutely-positioned overlay against the
  // container instead of a normal grid cell - see the `relative` wrapper
  // and empty placeholder cell below.
  const hitsStat = (
    <div className="pointer-events-none absolute bottom-0 right-0 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/60">
      Hits: {hitCellCount}/{occupiedCellCount}
    </div>
  );

  return (
    <div className="flex h-full flex-col gap-1.5">
      <div className="relative flex min-h-8 items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100">
        {reserveArrowSpace ? (
          <div className="relative w-[75%] min-w-0">
            {onGoLeft ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    onClick={onGoLeft}
                    className="absolute left-0 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full border border-white/10 bg-white/10 text-white hover:bg-white/20"
                    aria-label="Show my navy"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-[10px] normal-case">
                  <p>Show My Navy</p>
                </TooltipContent>
              </Tooltip>
            ) : null}

            <div className="w-full text-center">{navy.side === 'player' ? 'My Navy' : 'Enemy Navy'}</div>

            {onGoRight ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    onClick={onGoRight}
                    className="absolute right-0 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full border border-white/10 bg-white/10 text-white hover:bg-white/20"
                    aria-label="Show enemy navy"
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-[10px] normal-case">
                  <p>Show Enemy Navy</p>
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        ) : (
          <div>{navy.side === 'player' ? 'My Navy' : 'Enemy Navy'}</div>
        )}

        {showSettings ? (
          <div className="ml-auto flex items-center gap-3">
            <SettingsMenu
              shipSetOptions={shipSetOptions}
              onSinglesToggle={onSinglesToggle}
              onNewGame={onNewGame}
              onShowStatistics={onShowStatistics}
              onShowAboutShips={onShowAboutShips}
              onShowAboutWeapons={onShowAboutWeapons}
            />
          </div>
        ) : null}
      </div>

      <div className="rounded-[18px] border border-cyan-200/10 bg-slate-950/80 shadow-inner shadow-cyan-950/20">
        <div
          className="grid w-full gap-px"
          style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, minmax(0, 1fr))` }}
          aria-label={`${navy.label} grid`}
        >
          {navy.cells.map((cell, index) => (
            <GridCell
              key={`${navy.side}-${index}`}
              cell={cell}
              cellIndex={index}
              isTargetable={isCellTargetable?.(cell) ?? false}
              onClick={onTargetCell ? () => onTargetCell(index) : undefined}
              onPressStart={onCellPressStart ? () => onCellPressStart(index) : undefined}
              onPressEnd={onCellPressEnd ? () => onCellPressEnd(index) : undefined}
              onPressCancel={onCellPressCancel ? () => onCellPressCancel(index) : undefined}
              isExploding={explodingCellIndexes?.includes(index) ?? false}
              hasMine={index === mineIndex}
              armedWeapon={armedWeapon}
            />
          ))}
        </div>
      </div>

      {weaponsBarSlot}

      <div className="relative px-6">
        <div className="grid grid-cols-[max-content_max-content] justify-center gap-x-7 gap-y-0.5">
          {Array.from({ length: shipRowCount }, (_, rowIndex) => {
            const leftShip = leftColumnShips[rowIndex];
            const rightShip = rightColumnShips[rowIndex];

            return (
              <Fragment key={rowIndex}>
                {leftShip ? (
                  <ShipRow
                    ship={leftShip}
                    status={shipStatusByCode[leftShip.code] ?? { targetedCount: 0, isSunk: false }}
                    isTooltipOpen={openTooltipCode === leftShip.code}
                    onReveal={() => revealShipTooltip(leftShip.code)}
                  />
                ) : (
                  <div />
                )}
                {rightShip ? (
                  <ShipRow
                    ship={rightShip}
                    status={shipStatusByCode[rightShip.code] ?? { targetedCount: 0, isSunk: false }}
                    isTooltipOpen={openTooltipCode === rightShip.code}
                    onReveal={() => revealShipTooltip(rightShip.code)}
                  />
                ) : (
                  <div />
                )}
              </Fragment>
            );
          })}
          {hitsFillsTrailingGap ? null : (
            <Fragment>
              <div />
              {/* An empty <div/> here would collapse to zero height (a
                  CSS Grid row's height comes from its tallest cell, and
                  both cells in this appended row would otherwise have no
                  content at all) - the absolutely-positioned hitsStat
                  below would then land right on top of the last real ship
                  row instead of in its own reserved row beneath it. This
                  invisible duplicate of hitsStat's own text reserves
                  exactly the line height that overlay needs, at the same
                  font size, without actually rendering a second copy. */}
              <div aria-hidden="true" className="invisible text-[10px] font-semibold uppercase tracking-[0.18em]">
                Hits: {hitCellCount}/{occupiedCellCount}
              </div>
            </Fragment>
          )}
        </div>
        {hitsStat}
      </div>
    </div>
  );
}

type ShipRowProps = {
  ship: ShipDefinition;
  status: { targetedCount: number; isSunk: boolean };
  isTooltipOpen: boolean;
  onReveal: () => void;
};

function ShipRow({ ship, status, isTooltipOpen, onReveal }: ShipRowProps) {
  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="relative flex w-full items-center justify-center py-0.5 text-center transition hover:bg-cyan-300/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
            aria-label={ship.name}
            onClick={onReveal}
          >
            <span className="relative inline-flex items-center justify-center font-mono text-[12px] tracking-[0.34em]">
              {status.isSunk ? (
                // A perfectly symmetric centered line reads as slightly
                // longer past the last character than before the first, so
                // the left inset gets a bit more room than the right to
                // balance it out visually.
                <span className="pointer-events-none absolute -left-[0.3rem] -right-[0.175rem] top-1/2 h-px -translate-y-1/2 bg-red-500" />
              ) : null}
              {Array.from({ length: ship.length }, (_, index) => (
                <span
                  key={`${ship.code}-${index}`}
                  className={status.isSunk || index < status.targetedCount ? 'text-red-500' : 'text-cyan-100'}
                >
                  {ship.code}
                  {index < ship.length - 1 ? '\u00A0' : ''}
                </span>
              ))}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{ship.name}</p>
        </TooltipContent>
      </Tooltip>
      {isTooltipOpen ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 -translate-x-1/2 overflow-hidden whitespace-nowrap rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md"
        >
          {ship.name}
        </div>
      ) : null}
    </div>
  );
}

// 'none' for MOAB/Mine (no travel direction). Torpedo/Rocket only ever use
// the two axis-aligned keys; Harpoon uses the four diagonal quadrant keys.
type WeaponDirectionKey = 'none' | 'right' | 'left' | 'down' | 'up' | 'down-right' | 'up-left' | 'down-left' | 'up-right';

const WEAPON_CURSOR_FILES: Record<WeaponType, Partial<Record<WeaponDirectionKey, string>>> = {
  moab: { none: 'moab-cursor.svg' },
  mine: { none: 'mine-cursor.svg' },
  torpedo: { right: 'torpedo-cursor.svg', left: 'torpedo-cursor-left.svg' },
  rocket: { down: 'rocket-cursor.svg', up: 'rocket-cursor-up.svg' },
  harpoon: {
    'down-right': 'harpoon-cursor-down-right.svg',
    'up-left': 'harpoon-cursor-up-left.svg',
    'down-left': 'harpoon-cursor-down-left.svg',
    'up-right': 'harpoon-cursor-up-right.svg',
  },
  drone: { none: 'drone-cursor.svg' },
};

// Torpedo/Rocket/Harpoon cursor SVGs render at 48x48 (double the other
// weapons' 24x24) for better visibility while aiming, so their CSS cursor
// hotspot must be recentered to 24 24 to match - MOAB/Mine/Drone stay at
// their native 24x24 size and keep the 12 12 hotspot.
const DOUBLED_CURSOR_WEAPONS = new Set<WeaponType>(['torpedo', 'rocket', 'harpoon']);

function getWeaponCursorHotspot(weapon: WeaponType): string {
  return DOUBLED_CURSOR_WEAPONS.has(weapon) ? '24 24' : '12 12';
}

// Used only for the grid cell's own mobile press-and-hold preview (see
// GridCell) - the weapons bar buttons hardcode their own icons directly,
// since a button has no cell position to point a direction at.
const WEAPON_PREVIEW_ICONS: Record<WeaponType, Partial<Record<WeaponDirectionKey, typeof Bomb>>> = {
  moab: { none: Bomb },
  mine: { none: CircleDot },
  torpedo: { right: ArrowRight, left: ArrowLeft },
  rocket: { down: ArrowDown, up: ArrowUp },
  harpoon: {
    'down-right': ArrowDownRight,
    'up-left': ArrowUpLeft,
    'down-left': ArrowDownLeft,
    'up-right': ArrowUpRight,
  },
  drone: { none: Radar },
};

/**
 * Torpedo travels rightward from columns 0-4 but leftward from 5-9;
 * Rocket downward from rows 0-4 but upward from 5-9. Harpoon travels
 * diagonally, with the direction on each axis determined independently by
 * the same column/row split, giving four quadrants (see
 * getWeaponTravelIndexes() in armada-game.ts, same splits). The cursor and
 * mobile preview icon match whichever direction that weapon would actually
 * travel if fired at cellIndex - MOAB and Mine have no direction.
 */
function getWeaponDirectionKey(weapon: WeaponType, cellIndex: number): WeaponDirectionKey {
  const column = cellIndex % GRID_SIZE;
  const row = Math.floor(cellIndex / GRID_SIZE);

  if (weapon === 'torpedo') {
    return column > 4 ? 'left' : 'right';
  }

  if (weapon === 'rocket') {
    return row > 4 ? 'up' : 'down';
  }

  if (weapon === 'harpoon') {
    const goesLeft = column > 4;
    const goesUp = row > 4;
    if (!goesLeft && !goesUp) return 'down-right';
    if (goesLeft && goesUp) return 'up-left';
    if (goesLeft && !goesUp) return 'down-left';
    return 'up-right';
  }

  return 'none';
}

function getWeaponCursorFile(weapon: WeaponType, cellIndex: number): string {
  const asset = WEAPON_CURSOR_FILES[weapon];
  const key = getWeaponDirectionKey(weapon, cellIndex);
  return asset[key] ?? Object.values(asset)[0]!;
}

function getWeaponPreviewIcon(weapon: WeaponType, cellIndex: number): typeof Bomb {
  const asset = WEAPON_PREVIEW_ICONS[weapon];
  const key = getWeaponDirectionKey(weapon, cellIndex);
  return asset[key] ?? Object.values(asset)[0]!;
}

function GridCell({
  cell,
  cellIndex,
  isTargetable,
  onClick,
  onPressStart,
  onPressEnd,
  onPressCancel,
  isExploding,
  hasMine,
  armedWeapon,
}: {
  cell: CellState;
  cellIndex: number;
  isTargetable?: boolean;
  onClick?: () => void;
  onPressStart?: () => void;
  onPressEnd?: () => void;
  onPressCancel?: () => void;
  isExploding?: boolean;
  hasMine?: boolean;
  armedWeapon?: WeaponType | null;
}) {
  const exposure = cell.exposure;
  const { className, value, label } = getCellPresentation(cell, hasMine ?? false);
  const WeaponIcon = armedWeapon ? getWeaponPreviewIcon(armedWeapon, cellIndex) : null;
  // The unoccupied case is handled by getCellPresentation() itself (value
  // becomes just MINE_GLYPH, already colored). An occupied cell keeps its
  // own value from that function untouched, and gets this second,
  // independently-centered glyph layered on top of it instead - so a mine
  // sitting on, say, an already-sunk ship still shows that ship's own
  // letter, with the mine glyph visibly overlaid on top of it rather than
  // replacing it.
  const hasMineOverlay = Boolean(hasMine) && cell.occupied;

  if (onClick) {
    const handlePressStart = () => {
      if (!isTargetable) {
        return;
      }

      onPressStart?.();
    };

    const handlePressEnd = () => {
      onPressEnd?.();
    };

    const handlePressCancel = () => {
      onPressCancel?.();
    };

    return (
      <button
        type="button"
        onMouseDown={handlePressStart}
        onMouseUp={handlePressEnd}
        onTouchStart={handlePressStart}
        onTouchEnd={handlePressEnd}
        onTouchCancel={handlePressCancel}
        onBlur={handlePressCancel}
        className={cn(
          'relative aspect-square overflow-hidden rounded-[2px] border-[0.5px] text-center text-[clamp(0.75rem,3.3vw,1.04rem)] lg:text-[1.265rem] font-semibold leading-none shadow-sm transition-colors duration-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-200',
          className
        )}
        style={{
          cursor: (isTargetable || cell.targeting)
            ? `url(${import.meta.env.BASE_URL}${armedWeapon ? getWeaponCursorFile(armedWeapon, cellIndex) : 'crosshair-cursor.svg'}) ${armedWeapon ? getWeaponCursorHotspot(armedWeapon) : '12 12'}, crosshair`
            : 'default',
        }}
        aria-label={`${exposure === 'known' ? 'Known' : 'Unknown'} cell${label ? `, ${label}` : ''}`}
      >
        <div className="flex h-full items-center justify-center">{value}</div>
        {hasMineOverlay ? (
          <span className={`pointer-events-none absolute inset-0 flex items-center justify-center ${MINE_GLYPH_COLOR_CLASS}`} aria-hidden="true">
            {MINE_GLYPH}
          </span>
        ) : null}
        {cell.targeting && WeaponIcon ? (
          // Mobile has no hover cursor to preview the armed weapon with, so
          // while the player is pressing-and-holding the target cell, show
          // the weapon's own icon in place of the plain preview highlight -
          // the closest mobile equivalent of "you're about to drop this here".
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-slate-950">
            <WeaponIcon className="h-4 w-4" aria-hidden="true" />
          </span>
        ) : null}
        {isExploding ? (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="cell-explosion">
              <span className="cell-explosion-core" />
              <span className="cell-explosion-ring" />
              <span className="cell-explosion-sparks" />
            </span>
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <div
      className={cn(
        'relative aspect-square overflow-hidden rounded-[2px] border-[0.5px] text-center text-[clamp(0.75rem,3.3vw,1.04rem)] lg:text-[1.265rem] font-semibold leading-none shadow-sm transition-colors duration-300',
        className
      )}
      aria-label={`${exposure === 'known' ? 'Known' : 'Unknown'} cell${label ? `, ${label}` : ''}`}
    >
      <div className="flex h-full items-center justify-center">{value}</div>
      {hasMineOverlay ? (
        <span className={`pointer-events-none absolute inset-0 flex items-center justify-center ${MINE_GLYPH_COLOR_CLASS}`} aria-hidden="true">
          {MINE_GLYPH}
        </span>
      ) : null}
      {isExploding ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="cell-explosion">
            <span className="cell-explosion-core" />
            <span className="cell-explosion-ring" />
            <span className="cell-explosion-sparks" />
          </span>
        </span>
      ) : null}
    </div>
  );
}


function revealUntargetedShips(navy: GameState['player']): GameState['player'] {
  const nextCells = navy.cells.map((cell) => {
    if (cell.occupied && cell.effect === 'untargeted') {
      return {
        ...cell,
        exposure: 'revealed' as ExposureState,
      };
    }

    return cell;
  });

  return {
    ...navy,
    cells: nextCells,
    knownCount: nextCells.filter((cell) => cell.exposure === 'known' || cell.exposure === 'revealed').length,
  };
}

function revealRemainingShipsInWinningNavy(state: GameState, winner: Winner): GameState {
  if (winner === 'player') {
    return {
      ...state,
      player: revealUntargetedShips(state.player),
    };
  }

  return {
    ...state,
    enemy: revealUntargetedShips(state.enemy),
  };
}

export default Index;

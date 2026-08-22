import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useSeoMeta } from '@unhead/react';
import { Bomb, ChevronLeft, ChevronRight, CircleDot, Settings } from 'lucide-react';

import {
  areAllShipsSunk,
  AUDIO_FILES,
  createGameState,
  DEFAULT_SHIP_SET_OPTIONS,
  fireMoab,
  GAME_STATE_VERSION,
  getMoabTargetIndexes,
  getShips,
  GRID_SIZE,
  moveMine,
  resolveTargetingSequence,
  SPECIAL_WEAPON_QUOTA,
  selectAppTargetIndex,
  setCellState,
  setCellTargeting,
} from '@/lib/armada-game';
import type { AudioCue, AudioSequence, CellState, DifficultyLevel, ExposureState, GameState, NavySide, NavyState, ShipDefinition, ShipSetOptions, Winner } from '@/lib/armada-game';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type GameOverState = {
  isOpen: boolean;
  winner: Winner | null;
};

type WeaponType = 'moab' | 'mine';

const STORAGE_KEY = 'armada:game-state';
const navyViewOrder: NavySide[] = ['player', 'enemy'];
const DIFFICULTY_STORAGE_KEY = 'armada:difficulty';
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

function readStoredWeaponCount(storageKey: string, fallback: number): number {
  const storedCount = window.localStorage.getItem(storageKey);

  if (storedCount === null) {
    return fallback;
  }

  const parsedCount = Number(storedCount);
  return Number.isFinite(parsedCount) ? parsedCount : fallback;
}

const Index = () => {
  useSeoMeta({
    title: 'Armada',
    description: 'A mobile-first Armada board showing randomized navy setup for both fleets.',
  });

  const [gameState, setGameState] = useState<GameState | null>(null);
  const [activeView, setActiveView] = useState<NavySide>('player');
  const [gameOver, setGameOver] = useState<GameOverState>({ isOpen: false, winner: null });
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(() => {
    const storedDifficulty = window.localStorage.getItem(DIFFICULTY_STORAGE_KEY);
    return storedDifficulty === 'level2' ? 'level2' : 'level1';
  });
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
  const [moabCount, setMoabCount] = useState<number>(() => readStoredWeaponCount(MOAB_COUNT_STORAGE_KEY, MOAB_STARTING_COUNT));
  const [mineCount, setMineCount] = useState<number>(() => readStoredWeaponCount(MINE_COUNT_STORAGE_KEY, MINE_STARTING_COUNT));
  const appPreviewIndexRef = useRef<number | null>(null);
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
  });
  const [panelWidth, setPanelWidth] = useState(0);
  const swipeResizeObserverRef = useRef<ResizeObserver | null>(null);
  const isDesktopLayout = useMediaQuery(DESKTOP_LAYOUT_QUERY);
  const [armedWeapon, setArmedWeapon] = useState<WeaponType | null>(null);
  const [procuringWeapon, setProcuringWeapon] = useState<WeaponType | null>(null);

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
            return;
          }
        }

        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }

    const nextState = createGameState(shipSetOptions);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    setGameState(nextState);
    setActiveView(nextState.currentTurn === 'app' ? 'player' : 'enemy');
  }, [shipSetOptions]);

  const activeIndex = navyViewOrder.indexOf(activeView);
  const canGoLeft = activeIndex > 0;
  const canGoRight = activeIndex < navyViewOrder.length - 1;

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
    }, 380);
  };

  const handleNewGame = (nextOptions: ShipSetOptions = shipSetOptions) => {
      const nextState = createGameState(nextOptions);
      appPreviewIndexRef.current = null;
      userPreviewIndexRef.current = null;
      setExplosionCells({ player: [], enemy: [] });
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
      setGameState(nextState);

    setActiveView(nextState.currentTurn === 'app' ? 'player' : 'enemy');
    setGameOver({ isOpen: false, winner: null });
  };

  const handleDifficultyChange = (value: string) => {
    const nextDifficulty: DifficultyLevel = value === 'level2' ? 'level2' : 'level1';
    window.localStorage.setItem(DIFFICULTY_STORAGE_KEY, nextDifficulty);
    setDifficulty(nextDifficulty);
  };

  const handleSinglesToggle = (includeSingles: boolean) => {
    const nextOptions: ShipSetOptions = { includeSingles };
    window.localStorage.setItem(SHIP_SET_STORAGE_KEY, JSON.stringify(nextOptions));
    setShipSetOptions(nextOptions);
    handleNewGame(nextOptions);
  };

  const handleWeaponButtonClick = (weapon: WeaponType) => {
    if (!gameState || gameState.currentTurn !== 'player' || gameOver.isOpen) {
      return;
    }

    if (gameState.playerWeaponsUsed >= SPECIAL_WEAPON_QUOTA) {
      return;
    }

    // Only one mine may be active on the grid at a time.
    if (weapon === 'mine' && gameState.playerMineIndex !== null) {
      return;
    }

    const count = weapon === 'moab' ? moabCount : mineCount;

    if (count > 0) {
      setArmedWeapon((current) => (current === weapon ? null : weapon));
      return;
    }

    const storageKey = weapon === 'moab' ? MOAB_COUNT_STORAGE_KEY : MINE_COUNT_STORAGE_KEY;
    const refillCount = weapon === 'moab' ? MOAB_REFILL_COUNT : MINE_REFILL_COUNT;
    const setCount = weapon === 'moab' ? setMoabCount : setMineCount;

    setProcuringWeapon(weapon);

    window.setTimeout(() => {
      setProcuringWeapon(null);
      window.localStorage.setItem(storageKey, String(refillCount));
      setCount(refillCount);
      setArmedWeapon(weapon);
    }, 2000);
  };

  const concludeGame = (winner: Winner, state: GameState) => {
      appPreviewIndexRef.current = null;
      userPreviewIndexRef.current = null;
      setExplosionCells({ player: [], enemy: [] });

    const revealedState = revealRemainingShipsInWinningNavy(state, winner);

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(revealedState));
    setGameState(revealedState);

    window.setTimeout(() => {
      if (winner === 'player') {
        playAudioCue('wingame');
      }

      setGameOver({ isOpen: true, winner });
    }, 600);
  };

  const handleEnemyCellPressStart = (cellIndex: number) => {
    if (activeView !== 'enemy') {
      return;
    }

    flushSync(() => {
      setGameState((currentState) => {
        if (!currentState || currentState.currentTurn !== 'player' || gameOver.isOpen) {
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
    setGameState((state) => {
      if (!state || state.currentTurn !== 'player' || gameOver.isOpen) {
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

        if (mineIndex !== null) {
          const moveResult = moveMine(currentEnemy, mineIndex);
          currentEnemy = moveResult.navy;
          mineIndex = moveResult.mineIndex;

          if (moveResult.hit) {
            if (moveResult.ignited && moveResult.ignitedCellIndexes) {
              triggerCellExplosions('enemy', moveResult.ignitedCellIndexes);
            } else if (moveResult.hitIndex !== undefined) {
              triggerCellExplosions('enemy', [moveResult.hitIndex]);
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
          const { navy: updatedEnemy, audioSequence, ignited, ignitedCellIndexes } = fireMoab(currentEnemy, releaseIndex);

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
          setMoabCount((current) => {
            const nextCount = current - 1;
            window.localStorage.setItem(MOAB_COUNT_STORAGE_KEY, String(nextCount));
            return nextCount;
          });

          const nextState: GameState = {
            ...state,
            currentTurn: 'app',
            enemy: updatedEnemy,
            playerWeaponsUsed: state.playerWeaponsUsed + 1,
            playerMineIndex: mineIndex,
          };

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
          const enemyWithTargetedCell = setCellState(currentEnemy, releaseIndex, {
            effect: 'targeted',
            targeting: false,
          });
          const { navy: updatedEnemy, audioSequence, ignited, ignitedCellIndexes } = resolveTargetingSequence(enemyWithTargetedCell, [releaseIndex]);

          if (ignited && ignitedCellIndexes) {
            triggerCellExplosions('enemy', ignitedCellIndexes);
          } else if (targetCell.occupied) {
            triggerCellExplosions('enemy', [releaseIndex]);
          }

          playerShotExtendedDelayRef.current = mineCausedExtendedDelay || audioSequence.includes('sink') || Boolean(ignited);

          setArmedWeapon(null);
          setMineCount((current) => {
            const nextCount = current - 1;
            window.localStorage.setItem(MINE_COUNT_STORAGE_KEY, String(nextCount));
            return nextCount;
          });

          // A hit consumes the newly-placed mine immediately - nothing left
          // to activate. A miss plants it right here, stationary until the
          // player's next turn.
          const nextMineIndex = targetCell.occupied ? mineIndex : releaseIndex;

          const nextState: GameState = {
            ...state,
            currentTurn: 'app',
            enemy: updatedEnemy,
            playerWeaponsUsed: state.playerWeaponsUsed + 1,
            playerMineIndex: nextMineIndex,
          };

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

        const enemyWithTargetedCell = setCellState(currentEnemy, releaseIndex, {
          effect: 'targeted',
          targeting: false,
        });
        const { navy: updatedEnemy, audioSequence, ignited, ignitedCellIndexes } = resolveTargetingSequence(enemyWithTargetedCell, [releaseIndex]);

        if (ignited && ignitedCellIndexes) {
          triggerCellExplosions('enemy', ignitedCellIndexes);
        } else if (targetCell.occupied) {
          triggerCellExplosions('enemy', [releaseIndex]);
        }

        playerShotExtendedDelayRef.current = mineCausedExtendedDelay || audioSequence.includes('sink') || Boolean(ignited);

        if (updatedEnemy === currentEnemy && mineIndex === state.playerMineIndex) {
          return state;
        }

        const nextState: GameState = {
          ...state,
          currentTurn: 'app',
          enemy: updatedEnemy,
          playerMineIndex: mineIndex,
        };

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
    if (!gameState || gameOver.isOpen || gameState.currentTurn !== 'app') {
      appPreviewIndexRef.current = null;
      return;
    }

    const previewIndex = appPreviewIndexRef.current ?? selectAppTargetIndex(gameState.player, difficulty);

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

        const playerWithTargetedCell = setCellState(currentState.player, previewIndex, {
          effect: 'targeted',
          targeting: false,
        });
        const { navy: updatedPlayer, audioSequence, ignited, ignitedCellIndexes } = resolveTargetingSequence(playerWithTargetedCell, [previewIndex]);

        if (ignited && ignitedCellIndexes) {
          triggerCellExplosions('player', ignitedCellIndexes);
        } else if (currentState.player.cells[previewIndex]?.occupied) {
          triggerCellExplosions('player', [previewIndex]);
        }
        const nextState: GameState = {
          ...currentState,
          currentTurn: 'player',
          player: updatedPlayer,
        };

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
          }, (audioSequence.includes('sink') || ignited) ? 2000 : 1000);
        }

        return nextState;
      });
    }, 1450);

    return () => {
      window.clearTimeout(showPlayerDelay);
      window.clearTimeout(previewDelay);
      window.clearTimeout(executeTargetingDelay);
    };
  }, [difficulty, gameOver.isOpen, gameState, shipSetOptions]);

  // Safety net: an armed weapon only ever makes sense while it's the
  // player's move. If the turn moves on (or a new game starts) without it
  // being fired, drop the armed state instead of leaving it stuck armed.
  useEffect(() => {
    if (!gameState || gameState.currentTurn !== 'player' || gameOver.isOpen) {
      setArmedWeapon(null);
    }
  }, [gameState, gameOver.isOpen]);

  const renderNavyPanel = (
    side: NavySide,
    navy: NavyState,
    { showArrows, showSettings }: { showArrows: boolean; showSettings: boolean },
  ) => (
    <NavyPanel
      key={side}
      navy={navy}
      difficulty={difficulty}
      shipSetOptions={shipSetOptions}
      onDifficultyChange={handleDifficultyChange}
      onSinglesToggle={handleSinglesToggle}
      onNewGame={() => handleNewGame()}
      onGoLeft={showArrows && canGoLeft && side === activeView ? () => setActiveView('player') : undefined}
      onGoRight={showArrows && canGoRight && side === activeView ? () => setActiveView('enemy') : undefined}
      onTargetCell={side === 'enemy' ? (cellIndex) => handleTargetEnemyCell(cellIndex) : undefined}
      onCellPressStart={side === 'enemy' ? handleEnemyCellPressStart : undefined}
      onCellPressEnd={side === 'enemy' ? handleEnemyCellPressEnd : undefined}
      onCellPressCancel={side === 'enemy' ? handleEnemyCellPressCancel : undefined}
      isCellTargetable={side === 'enemy' ? (cell) => cell.effect === 'untargeted' && !cell.targeting : undefined}
      explodingCellIndexes={explosionCells[side]}
      showSettings={showSettings}
      reserveArrowSpace={showArrows}
      mineIndex={side === 'enemy' ? gameState?.playerMineIndex : undefined}
      armedWeapon={side === 'enemy' ? armedWeapon : undefined}
      weaponsBarSlot={renderWeaponsBarForSide(side)}
    />
  );

  const isPlayerTurnActive = Boolean(gameState) && gameState?.currentTurn === 'player' && !gameOver.isOpen;
  const playerWeaponsUsed = gameState?.playerWeaponsUsed ?? 0;
  const weaponQuotaReached = playerWeaponsUsed >= SPECIAL_WEAPON_QUOTA;
  const hasActiveMine = (gameState?.playerMineIndex ?? null) !== null;
  const moabButtonDisabled = !isPlayerTurnActive || weaponQuotaReached;
  const mineButtonDisabled = !isPlayerTurnActive || weaponQuotaReached || hasActiveMine;

  // Each grid gets the weapons bar relevant to looking at it: the enemy
  // grid is where you'd arm and fire, so it gets "My Weapons"; your own
  // grid is where the computer's shots land, so it gets "Enemy Weapons" to
  // watch its count/dots change if it ever fires one.
  const renderWeaponsBarForSide = (side: NavySide) => {
    if (side === 'player') {
      return (
        <WeaponsBar
          key="enemy-weapons"
          label="Enemy Weapons"
          moabCount={gameState?.appMoabCount ?? 0}
          weaponsUsed={gameState?.appWeaponsUsed ?? 0}
          isMoabArmed={false}
          moabButtonDisabled
          mineCount={gameState?.appMineCount ?? 0}
          isMineArmed={false}
          mineButtonDisabled
        />
      );
    }

    return (
      <WeaponsBar
        key="my-weapons"
        label="My Weapons"
        moabCount={moabCount}
        weaponsUsed={playerWeaponsUsed}
        isMoabArmed={armedWeapon === 'moab'}
        moabButtonDisabled={moabButtonDisabled}
        onMoabClick={() => handleWeaponButtonClick('moab')}
        mineCount={mineCount}
        isMineArmed={armedWeapon === 'mine'}
        mineButtonDisabled={mineButtonDisabled}
        onMineClick={() => handleWeaponButtonClick('mine')}
      />
    );
  };

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
                    className="flex w-[200%] transition-transform duration-1000 ease-out"
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

      <Dialog open={gameOver.isOpen} modal={false}>
        <DialogContent
          overlayClassName="pointer-events-none"
          className="top-[75%] max-w-sm translate-y-[-50%] rounded-2xl border-white/10 bg-slate-950 text-white sm:top-[75%]"
        >
          <DialogHeader>
            <DialogTitle>{gameOver.winner === 'player' ? 'Victory' : 'Defeat'}</DialogTitle>
            <DialogDescription className="text-slate-300">
              {gameOver.winner === 'player'
                ? 'Congratulations, you won! Click OK to play again.'
                : 'You lost! Click OK to play again.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" onClick={() => handleNewGame()} className="w-full sm:w-auto">
              OK
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
    </>
  );
};

type WeaponsBarProps = {
  label: string;
  moabCount: number;
  weaponsUsed: number;
  isMoabArmed: boolean;
  moabButtonDisabled: boolean;
  onMoabClick?: () => void;
  mineCount: number;
  isMineArmed: boolean;
  mineButtonDisabled: boolean;
  onMineClick?: () => void;
};

// 6 slots (3 across, 2 rows) reserved for weapon buttons; only MOAB and
// Mines exist so far, in the first two slots, with the rest left as empty
// spacers so the grid geometry is already right for whichever weapons come
// next.
const WEAPON_BUTTON_SLOT_COUNT = 6;

type WeaponButtonProps = {
  icon: ReactNode;
  label: string;
  count: number;
  isArmed: boolean;
  disabled: boolean;
  onClick?: () => void;
};

function WeaponButton({ icon, label, count, isArmed, disabled, onClick }: WeaponButtonProps) {
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={isArmed}
      className={cn(
        'h-auto w-full gap-1 rounded-full border px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-white',
        isArmed
          ? 'border-cyan-300 bg-cyan-400/20 text-cyan-100 shadow-[0_0_0_2px_rgba(103,232,249,0.4)] hover:bg-cyan-400/30'
          : 'border-white/10 bg-white/10 hover:bg-white/20',
      )}
    >
      {icon}
      {label}
      <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-slate-950/60 px-1 text-[9px] font-bold">
        {count}
      </span>
    </Button>
  );
}

function WeaponsBar({
  label,
  moabCount,
  weaponsUsed,
  isMoabArmed,
  moabButtonDisabled,
  onMoabClick,
  mineCount,
  isMineArmed,
  mineButtonDisabled,
  onMineClick,
}: WeaponsBarProps) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-md">
      <div className="relative flex min-h-8 items-center">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-100/70">
          {label}
        </div>

        <div
          className="ml-auto grid grid-cols-2 grid-rows-2 gap-1 rounded-lg border border-white/10 bg-white/5 p-1.5"
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

      <div className="grid grid-cols-3 grid-rows-2 gap-2">
        <WeaponButton
          icon={<Bomb className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          label="MOAB"
          count={moabCount}
          isArmed={isMoabArmed}
          disabled={moabButtonDisabled}
          onClick={onMoabClick}
        />
        <WeaponButton
          icon={<CircleDot className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          label="MINES"
          count={mineCount}
          isArmed={isMineArmed}
          disabled={mineButtonDisabled}
          onClick={onMineClick}
        />

        {Array.from({ length: WEAPON_BUTTON_SLOT_COUNT - 2 }, (_, index) => (
          <div key={index} aria-hidden="true" />
        ))}
      </div>
    </div>
  );
}

type NavyPanelProps = {
  navy: NavyState;
  difficulty: DifficultyLevel;
  shipSetOptions: ShipSetOptions;
  onDifficultyChange: (value: string) => void;
  onSinglesToggle: (includeSingles: boolean) => void;
  onNewGame: () => void;
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
  difficulty: DifficultyLevel;
  shipSetOptions: ShipSetOptions;
  onDifficultyChange: (value: string) => void;
  onSinglesToggle: (includeSingles: boolean) => void;
  onNewGame: () => void;
};

function SettingsMenu({ difficulty, shipSetOptions, onDifficultyChange, onSinglesToggle, onNewGame }: SettingsMenuProps) {
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
        <DropdownMenuLabel>Difficulty</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={difficulty} onValueChange={onDifficultyChange}>
          <DropdownMenuRadioItem value="level1">Level 1</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="level2">Level 2</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Ships</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onSinglesToggle(!shipSetOptions.includeSingles)}>
          <div className="flex w-full items-center justify-between gap-3">
            <span>Singles (E H L)</span>
            <span className="text-xs text-muted-foreground">{shipSetOptions.includeSingles ? 'On' : 'Off'}</span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onNewGame}>New Game</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NavyPanel({
  navy,
  difficulty,
  shipSetOptions,
  onDifficultyChange,
  onSinglesToggle,
  onNewGame,
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
  // roughly in half and the second half mirrored, so the legend reads as
  // an hourglass (two columns, tapering toward the middle) instead of one
  // tall column with several single-character rows at the bottom.
  const [leftColumnShips, rightColumnShips] = useMemo(() => {
    const sorted = [...availableShips].sort((a, b) => b.length - a.length || a.code.localeCompare(b.code));
    const splitIndex = Math.ceil(sorted.length / 2);
    return [sorted.slice(0, splitIndex), sorted.slice(splitIndex).reverse()];
  }, [availableShips]);

  return (
    <div className="flex h-full flex-col gap-1.5">
      <div className="relative flex min-h-8 items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100">
        {reserveArrowSpace ? (
          <div className="relative w-[60%] min-w-0">
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
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {navy.side === 'player' ? 'My Navy' : 'Enemy Navy'}
          </div>
        )}

        {showSettings ? (
          <div className="ml-auto">
            <SettingsMenu
              difficulty={difficulty}
              shipSetOptions={shipSetOptions}
              onDifficultyChange={onDifficultyChange}
              onSinglesToggle={onSinglesToggle}
              onNewGame={onNewGame}
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

      <div className="px-1">
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
          {Array.from({ length: Math.max(leftColumnShips.length, rightColumnShips.length) }, (_, rowIndex) => {
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
        </div>
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
                <span className="pointer-events-none absolute left-1/2 top-1/2 h-px w-[calc(100%+0.35rem)] -translate-x-1/2 -translate-y-1/2 bg-red-500" />
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

const WEAPON_CURSOR_FILES: Record<WeaponType, string> = {
  moab: 'moab-cursor.svg',
  mine: 'mine-cursor.svg',
};

const WEAPON_ICONS: Record<WeaponType, typeof Bomb> = {
  moab: Bomb,
  mine: CircleDot,
};

function GridCell({
  cell,
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
  const WeaponIcon = armedWeapon ? WEAPON_ICONS[armedWeapon] : null;

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
          'relative aspect-square overflow-hidden rounded-[2px] border-[0.5px] text-center text-[clamp(0.5rem,1.6vw,0.78rem)] font-semibold leading-none shadow-sm transition-colors duration-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-200',
          className
        )}
        style={{
          cursor: (isTargetable || cell.targeting)
            ? `url(${import.meta.env.BASE_URL}${armedWeapon ? WEAPON_CURSOR_FILES[armedWeapon] : 'crosshair-cursor.svg'}) 12 12, crosshair`
            : 'default',
        }}
        aria-label={`${exposure === 'known' ? 'Known' : 'Unknown'} cell${label ? `, ${label}` : ''}`}
      >
        <div className="flex h-full items-center justify-center text-white">{value}</div>
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
        'relative aspect-square overflow-hidden rounded-[2px] border-[0.5px] text-center text-[clamp(0.5rem,1.6vw,0.78rem)] font-semibold leading-none shadow-sm transition-colors duration-300',
        className
      )}
      aria-label={`${exposure === 'known' ? 'Known' : 'Unknown'} cell${label ? `, ${label}` : ''}`}
    >
      <div className="flex h-full items-center justify-center text-white">{value}</div>
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

function getCellPresentation(cell: CellState, hasMine: boolean): { className: string; value: string; label: string } {
  const base = computeBaseCellPresentation(cell);

  if (!hasMine) {
    return base;
  }

  // Debug aid for validating mine movement during this initial
  // implementation: mark the mine's current cell with an asterisk - alone
  // if the cell is still hidden (so it doesn't leak anything else about
  // the cell), appended to whatever would otherwise show if it's visible.
  const value = cell.exposure === 'unknown' ? '*' : `${base.value}*`;

  return { ...base, value, label: `${base.label}, mine present` };
}

function computeBaseCellPresentation(cell: CellState): { className: string; value: string; label: string } {
  // Oil hides a ship's identity only while the cell itself is still hidden
  // by fog of war. Once a cell is visible (the player's own navy, or a
  // future reveal effect on the enemy's), a ship under the oil should still
  // show its letter.
  const value = cell.oil && cell.effect === 'untargeted' && cell.exposure === 'unknown'
    ? ''
    : cell.occupied ? (cell.shipCode ?? '') : cell.effect === 'targeted' ? '–' : '';

  if (cell.targeting) {
    return {
      className: 'border-[#00FFFF] bg-[#00FFFF] text-slate-950',
      // Fog of war: don't leak the ship identifier while previewing a shot
      // on a cell that hasn't been revealed yet. Once exposure is 'known'
      // (the player's own navy, or a cell already hit), the identity isn't
      // a secret, so show it as normal.
      value: cell.exposure === 'unknown' ? '' : value,
      label: cell.occupied ? 'occupied and targeting' : 'empty and targeting',
    };
  }

  if (cell.shipCode === 'O' && cell.effect === 'sunk') {
    return {
      className: 'border-[#202020] bg-[#202020] text-white',
      value,
      label: 'oil tanker sunk',
    };
  }

  if (cell.occupied && cell.exposure === 'revealed') {
    return {
      className: 'border-[#00B200] bg-[#00B200] text-white',
      value,
      label: 'occupied and revealed',
    };
  }

  if (!cell.occupied && cell.effect === 'targeted') {
    // A splash into oil over an empty cell has nothing to burn off, so the
    // oil survives the shot and still reads as oil, just with the hyphen
    // for "targeted" layered on top of it.
    if (cell.oil) {
      return {
        className: 'border-[#404040] bg-[#404040] text-white',
        value,
        label: 'empty with oil, targeted',
      };
    }

    return {
      className: 'border-[#0000FF] bg-[#0000FF] text-white',
      value,
      label: 'empty and targeted',
    };
  }

  if (cell.effect === 'sunk') {
    return {
      className: 'border-[#0000B2] bg-[#0000B2] text-white',
      value,
      label: 'occupied and sunk',
    };
  }

  if (cell.effect === 'targeted') {
    return {
      className: 'border-[#FF0000] bg-[#FF0000] text-white',
      value,
      label: 'occupied and targeted',
    };
  }

  if (cell.oil) {
    return {
      className: 'border-[#404040] bg-[#404040] text-white',
      value,
      label: cell.occupied ? 'occupied with oil' : 'empty with oil',
    };
  }

  if (cell.exposure === 'unknown') {
    return {
      className: 'border-[#C0C0C0] bg-[#C0C0C0] text-white',
      value: '',
      label: cell.effect,
    };
  }

  return {
    className: 'border-[#0000FF] bg-[#0000FF] text-white',
    value,
    label: cell.occupied ? 'occupied and untargeted' : 'empty and untargeted',
  };
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

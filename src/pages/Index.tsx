import { useEffect, useMemo, useRef, useState } from 'react';
import { useSeoMeta } from '@unhead/react';
import { ChevronLeft, ChevronRight, Settings } from 'lucide-react';

import {
  areAllShipsSunk,
  AUDIO_FILES,
  createGameState,
  DEFAULT_SHIP_SET_OPTIONS,
  GAME_STATE_VERSION,
  getShips,
  GRID_SIZE,
  resolveTargetingSequence,
  selectAppTargetIndex,
  setCellState,
  setCellTargeting,
} from '@/lib/armada-game';
import type { AudioCue, AudioSequence, CellState, DifficultyLevel, GameState, NavySide, ShipSetOptions, Winner } from '@/lib/armada-game';
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

const STORAGE_KEY = 'armada:game-state';
const navyViewOrder: NavySide[] = ['player', 'enemy'];
const DIFFICULTY_STORAGE_KEY = 'armada:difficulty';
const SHIP_SET_STORAGE_KEY = 'armada:ship-set-options';

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
  const appPreviewIndexRef = useRef<number | null>(null);
  const userPreviewIndexRef = useRef<number | null>(null);
  const audioRef = useRef<Record<AudioCue, HTMLAudioElement[]>>({
    splash: [],
    sink: [],
    lifeboat: [],
    ensign: [],
    helicopter: [],
    explosion: [],
    wingame: [],
  });

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
    const pool = audioRef.current[cue];
    const reusableAudio = pool.find((item) => item.paused || item.ended);
    const audio = reusableAudio ?? new Audio(AUDIO_FILES[cue]);

    if (!reusableAudio) {
      audio.preload = 'auto';
      pool.push(audio);
    }

    audio.currentTime = 0;
    void audio.play().catch((error) => {
      console.warn(`Audio playback failed for ${cue}`, error);
    });
  };

  const playAudioSequence = (sequence: AudioSequence) => {
    sequence.forEach((cue) => {
      playAudioCue(cue);
    });
  };

  const handleNewGame = (nextOptions: ShipSetOptions = shipSetOptions) => {
    const nextState = createGameState(nextOptions);
    appPreviewIndexRef.current = null;
    userPreviewIndexRef.current = null;
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

  const concludeGame = (winner: Winner, state: GameState) => {
    appPreviewIndexRef.current = null;
    userPreviewIndexRef.current = null;
    const revealSide: NavySide = winner === 'player' ? 'player' : 'enemy';
    const revealedState = revealRemainingShipsInWinningNavy(state, winner);

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(revealedState));
    setGameState(revealedState);
    setActiveView(revealSide);

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

        const enemyWithTargetedCell = setCellState(state.enemy, releaseIndex, {
          effect: 'targeted',
          targeting: false,
        });
        const { navy: updatedEnemy, audioSequence } = resolveTargetingSequence(enemyWithTargetedCell, [releaseIndex]);

        if (updatedEnemy === state.enemy) {
          return state;
        }

        const nextState: GameState = {
          ...state,
          currentTurn: 'app',
          enemy: updatedEnemy,
        };

      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
      playAudioSequence(audioSequence);
 
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

    const showPlayerDelay = window.setTimeout(() => {
      setActiveView('player');
    }, 700);

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
        const { navy: updatedPlayer, audioSequence } = resolveTargetingSequence(playerWithTargetedCell, [previewIndex]);
        const nextState: GameState = {
          ...currentState,
          currentTurn: 'player',
          player: updatedPlayer,
        };

        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
        playAudioSequence(audioSequence);
 
        if (areAllShipsSunk(updatedPlayer, shipSetOptions)) {

          concludeGame('app', nextState);
        } else {
          window.setTimeout(() => {
            setActiveView('enemy');
          }, 1000);
        }

        return nextState;
      });
    }, 1400);

    return () => {
      window.clearTimeout(showPlayerDelay);
      window.clearTimeout(previewDelay);
      window.clearTimeout(executeTargetingDelay);
    };
  }, [difficulty, gameOver.isOpen, gameState, shipSetOptions]);

  return (
    <>
      <main className="min-h-screen overflow-hidden bg-slate-950 text-slate-50">
      <div className="relative isolate min-h-screen bg-[radial-gradient(circle_at_top,_rgba(125,211,252,0.18),_transparent_40%),linear-gradient(180deg,_#020617_0%,_#0f172a_45%,_#111827_100%)]">
        <div className="mx-auto flex min-h-screen w-full max-w-sm flex-col px-3 pb-3 pt-2 sm:px-4">
          {gameState && activeNavy ? (
            <section className="flex min-h-0 flex-1 flex-col gap-2">
              <div className="overflow-hidden rounded-[24px] border border-white/10 bg-white/5 shadow-[0_18px_60px_rgba(14,116,144,0.16)] backdrop-blur-md">
                <div
                  className="flex w-[200%] transition-transform duration-500 ease-out"
                  style={{ transform: `translateX(-${activeIndex * 50}%)` }}
                >
                  {navyViewOrder.map((side) => {
                    const navy = side === 'player' ? gameState.player : gameState.enemy;

                    return (
                      <div key={side} className="w-1/2 shrink-0 p-2.5">
                        <NavyPanel
                          navy={navy}
                          difficulty={difficulty}
                          shipSetOptions={shipSetOptions}
                          onDifficultyChange={handleDifficultyChange}
                          onSinglesToggle={handleSinglesToggle}
                          onNewGame={() => handleNewGame()}
                          onGoLeft={canGoLeft && side === activeView ? () => setActiveView('player') : undefined}
                          onGoRight={canGoRight && side === activeView ? () => setActiveView('enemy') : undefined}
                          onTargetCell={side === 'enemy' ? (cellIndex) => handleTargetEnemyCell(cellIndex) : undefined}
                          onCellPressStart={side === 'enemy' ? handleEnemyCellPressStart : undefined}
                          onCellPressEnd={side === 'enemy' ? handleEnemyCellPressEnd : undefined}
                          isCellTargetable={side === 'enemy' ? (cell) => cell.effect === 'untargeted' && !cell.targeting : undefined}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

            </section>
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

      <Dialog open={gameOver.isOpen}>
        <DialogContent className="top-[75%] max-w-sm translate-y-[-50%] rounded-2xl border-white/10 bg-slate-950 text-white sm:top-[75%]">
          <DialogHeader>
            <DialogTitle>{gameOver.winner === 'player' ? 'Victory' : 'Defeat'}</DialogTitle>
            <DialogDescription className="text-slate-300">
              {gameOver.winner === 'player'
                ? 'Congratulations, you won! Click OK to play again.'
                : 'You lost! Click OK to play again.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" onClick={handleNewGame} className="w-full sm:w-auto">
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

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
  isCellTargetable?: (cell: CellState) => boolean;
};

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
  isCellTargetable,
}: NavyPanelProps) {
  const availableShips = useMemo(() => getShips(shipSetOptions), [shipSetOptions]);

  const shipStatusByCode = useMemo(() => {
    return availableShips.reduce<Record<string, { targetedCount: number; isSunk: boolean }>>((accumulator, ship) => {
      const shipCells = navy.cells.filter((cell) => cell.shipCode === ship.code);
      const targetedCount = shipCells.filter((cell) => cell.effect === 'targeted').length;
      const isSunk = shipCells.length > 0 && shipCells.every((cell) => cell.effect === 'sunk');

      accumulator[ship.code] = { targetedCount, isSunk };
      return accumulator;
    }, {});
  }, [availableShips, navy.cells]);

  return (
    <div className="flex h-full flex-col gap-1.5">
      <div className="flex min-h-8 items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100">
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
            />
          ))}
        </div>
      </div>

      <div className="px-1">
        <div className="space-y-0.5">
          {availableShips.map((ship) => {
            const status = shipStatusByCode[ship.code] ?? { targetedCount: 0, isSunk: false };

            return (
              <Tooltip key={`${navy.side}-${ship.code}`}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="relative flex w-full items-center justify-center py-0.5 text-center transition hover:bg-cyan-300/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                    aria-label={ship.name}
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
            );
          })}
        </div>
      </div>
    </div>
  );
}

function GridCell({
  cell,
  isTargetable,
  onClick,
  onPressStart,
  onPressEnd,
}: {
  cell: CellState;
  isTargetable?: boolean;
  onClick?: () => void;
  onPressStart?: () => void;
  onPressEnd?: () => void;
}) {
  const exposure = cell.exposure;
  const { className, value, label } = getCellPresentation(cell);

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


    return (
      <button
        type="button"
        onMouseDown={handlePressStart}
        onMouseUp={handlePressEnd}
        onTouchStart={handlePressStart}
        onTouchEnd={handlePressEnd}
        onTouchCancel={handlePressEnd}
        onBlur={handlePressEnd}
        className={cn(
          'aspect-square rounded-[2px] border-[0.5px] text-center text-[clamp(0.5rem,1.6vw,0.78rem)] font-semibold leading-none shadow-sm transition-colors duration-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-200',
          (isTargetable || cell.targeting) ? 'cursor-[url(/crosshair-cursor.svg)_12_12,crosshair]' : 'cursor-default',
          className
        )}
        aria-label={`${exposure === 'known' ? 'Known' : 'Unknown'} cell${label ? `, ${label}` : ''}`}
      >
        <div className="flex h-full items-center justify-center text-white">{value}</div>
      </button>
    );
  }

  return (
    <div
      className={cn(
        'aspect-square rounded-[2px] border-[0.5px] text-center text-[clamp(0.5rem,1.6vw,0.78rem)] font-semibold leading-none shadow-sm transition-colors duration-300',
        className
      )}
      aria-label={`${exposure === 'known' ? 'Known' : 'Unknown'} cell${label ? `, ${label}` : ''}`}
    >
      <div className="flex h-full items-center justify-center text-white">{value}</div>
    </div>
  );
}

function getCellPresentation(cell: CellState): { className: string; value: string; label: string } {
  const value = cell.oil && cell.effect === 'untargeted'
    ? ''
    : cell.occupied ? (cell.shipCode ?? '') : cell.effect === 'targeted' ? '–' : '';

  if (cell.oil) {
    return {
      className: 'border-[#404040] bg-[#404040] text-white',
      value,
      label: cell.occupied ? 'occupied with oil' : 'empty with oil',
    };
  }

  if (cell.targeting) {
    return {
      className: 'border-[#00FFFF] bg-[#00FFFF] text-slate-950',
      value,
      label: cell.occupied ? 'occupied and targeting' : 'empty and targeting',
    };
  }

  if (cell.exposure === 'unknown') {
    return {
      className: 'border-[#C0C0C0] bg-[#C0C0C0] text-white',
      value: '',
      label: cell.effect,
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
    return {
      className: 'border-[#0000FF] bg-[#0000FF] text-white',
      value,
      label: 'empty and targeted',
    };
  }

  if (cell.shipCode === 'O' && (cell.effect === 'targeted' || cell.effect === 'sunk')) {
    return {
      className: cell.effect === 'sunk'
        ? 'border-[#202020] bg-[#202020] text-white'
        : 'border-[#404040] bg-[#404040] text-white',
      value,
      label: cell.effect === 'sunk' ? 'oil tanker sunk' : 'oil tanker targeted',
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

  return {
    className: 'border-[#0000FF] bg-[#0000FF] text-white',
    value,
    label: cell.occupied ? 'occupied and untargeted' : 'empty and untargeted',
  };
}

function targetCellInNavy(navy: NavyState, cellIndex: number): TargetingResult {
  const targetCell = navy.cells[cellIndex];

  if (!targetCell || (targetCell.effect !== 'targeted' && !targetCell.targeting)) {
    return { navy, audioSequence: ['splash'] };
  }

  const nextCells = navy.cells.map((cell, index) => {
    if (index !== cellIndex) {
      return cell;
    }

    return {
      ...cell,
      exposure: cell.exposure === 'unknown' ? 'known' : cell.exposure,
      effect: 'targeted' as EffectState,
      targeting: false,
    };
  });

  const targetedCell = nextCells[cellIndex];

  if (targetedCell.occupied && targetedCell.shipCode) {
    const shipIndexes = nextCells.reduce<number[]>((indexes, cell, index) => {
      if (cell.shipCode === targetedCell.shipCode) {
        indexes.push(index);
      }
      return indexes;
    }, []);

    const allShipCellsTargeted = shipIndexes.every((index) => nextCells[index].effect === 'targeted' || nextCells[index].effect === 'sunk');

    if (allShipCellsTargeted) {
      shipIndexes.forEach((index) => {
        nextCells[index] = {
          ...nextCells[index],
          effect: 'sunk',
          targeting: false,
          exposure: 'known',
        };
      });
    }
  }

  const resolvedNavy: NavyState = {
    ...navy,
    cells: nextCells,
    knownCount: nextCells.filter((cell) => cell.exposure === 'known' || cell.exposure === 'revealed').length,
  };

  return {
    navy: resolvedNavy,
    audioSequence: resolveAudioSequence(nextCells[cellIndex]),
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

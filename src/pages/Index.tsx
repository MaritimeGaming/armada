import { useEffect, useMemo, useState } from 'react';
import { useSeoMeta } from '@unhead/react';
import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

type Orientation = 'vertical-down' | 'horizontal-right' | 'diagonal-down' | 'diagonal-up';
type NavySide = 'player' | 'enemy';

type ShipDefinition = {
  code: string;
  name: string;
  length: number;
};

type Point = {
  x: number;
  y: number;
};

type PlacedShip = ShipDefinition & {
  orientation: Orientation;
  start: Point;
  cells: Point[];
};

type ExposureState = 'known' | 'unknown' | 'revealed';
type EffectState = 'untargeted' | 'targeted' | 'sunk' | 'oil';

type CellState = {
  exposure: ExposureState;
  occupied: boolean;
  effect: EffectState;
  shipCode?: string;
};

type NavyState = {
  side: NavySide;
  label: string;
  knownCount: number;
  ships: PlacedShip[];
  cells: CellState[];
};

type GameState = {
  version: number;
  player: NavyState;
  enemy: NavyState;
};

type AudioCue = 'splash' | 'sink' | 'ensign' | 'highscream' | 'lowscream' | 'explosion';
type AudioSequence = AudioCue[];
type DifficultyLevel = 'level1' | 'level2';

const GRID_SIZE = 10;
const STORAGE_KEY = 'armada:game-state';
const GAME_STATE_VERSION = 5;
const MAX_PLACEMENT_ATTEMPTS = 5000;

const SHIPS: ShipDefinition[] = [
  { code: 'A', name: 'Aircraft Carrier', length: 5 },
  { code: 'B', name: 'Battleship', length: 4 },
  { code: 'C', name: 'Cruiser', length: 3 },
  { code: 'D', name: 'Destroyer', length: 3 },
  { code: 'E', name: 'Ensign', length: 1 },
  { code: 'F', name: 'Frigate', length: 3 },
  { code: 'G', name: 'Garbage Scow', length: 2 },
  { code: 'H', name: 'Helicopter', length: 1 },
  { code: 'L', name: 'Lifeboat', length: 1 },
  { code: 'O', name: 'Oil Tanker', length: 3 },
  { code: 'S', name: 'Submarine', length: 2 },
];

const ORIENTATIONS: Orientation[] = [
  'vertical-down',
  'horizontal-right',
  'diagonal-down',
  'diagonal-up',
];

const navyViewOrder: NavySide[] = ['player', 'enemy'];

const AUDIO_FILES: Record<AudioCue, string> = {
  splash: '/audio/Splash.wav',
  sink: '/audio/Sink.wav',
  ensign: '/audio/Ensign.wav',
  highscream: '/audio/HighScream.wav',
  lowscream: '/audio/LowScream.wav',
  explosion: '/audio/Explosion.wav',
};

const DIFFICULTY_STORAGE_KEY = 'armada:difficulty';

const Index = () => {
  useSeoMeta({
    title: 'Armada',
    description: 'A mobile-first Armada board showing randomized navy setup for both fleets.',
  });

  const [gameState, setGameState] = useState<GameState | null>(null);
  const [activeView, setActiveView] = useState<NavySide>('player');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(() => {
    const storedDifficulty = window.localStorage.getItem(DIFFICULTY_STORAGE_KEY);
    return storedDifficulty === 'level2' ? 'level2' : 'level1';
  });
  const audioRef = useRef<Record<AudioCue, HTMLAudioElement | null>>({
    splash: null,
    sink: null,
    ensign: null,
    highscream: null,
    lowscream: null,
    explosion: null,
  });

  useEffect(() => {
    const storedState = window.localStorage.getItem(STORAGE_KEY);

    if (storedState) {
      try {
        const parsedState = JSON.parse(storedState) as Partial<GameState>;

        if (parsedState.version === GAME_STATE_VERSION) {
          setGameState(parsedState as GameState);
          return;
        }

        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }

    const nextState = createGameState();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    setGameState(nextState);
  }, []);

  const activeIndex = navyViewOrder.indexOf(activeView);
  const canGoLeft = activeIndex > 0;
  const canGoRight = activeIndex < navyViewOrder.length - 1;

  const activeNavy = useMemo(() => {
    if (!gameState) return null;
    return activeView === 'player' ? gameState.player : gameState.enemy;
  }, [activeView, gameState]);

  const playAudioCue = (cue: AudioCue) => {
    const existingAudio = audioRef.current[cue];
    const audio = existingAudio ?? new Audio(AUDIO_FILES[cue]);
    audioRef.current[cue] = audio;
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  };

  const playAudioSequence = (sequence: AudioSequence) => {
    sequence.forEach((cue) => {
      playAudioCue(cue);
    });
  };

  const handleNewGame = () => {
    const nextState = createGameState();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    setGameState(nextState);
    setActiveView('player');
  };

  const handleDifficultyChange = (value: string) => {
    const nextDifficulty: DifficultyLevel = value === 'level2' ? 'level2' : 'level1';
    window.localStorage.setItem(DIFFICULTY_STORAGE_KEY, nextDifficulty);
    setDifficulty(nextDifficulty);
  };

  const handleTargetEnemyCell = (cellIndex: number) => {
    setGameState((currentState) => {
      if (!currentState) return currentState;

      const { navy: updatedEnemy, audioSequence } = targetCellInNavy(currentState.enemy, cellIndex);

      if (updatedEnemy === currentState.enemy) {
        return currentState;
      }

      const nextState: GameState = {
        ...currentState,
        enemy: updatedEnemy,
      };

      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
      playAudioSequence(audioSequence);
      return nextState;
    });
  };

  return (
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
                          onDifficultyChange={handleDifficultyChange}
                          onNewGame={handleNewGame}
                          onGoLeft={canGoLeft && side === activeView ? () => setActiveView('player') : undefined}
                          onGoRight={canGoRight && side === activeView ? () => setActiveView('enemy') : undefined}
                          onTargetCell={side === 'enemy' ? (cellIndex) => handleTargetEnemyCell(cellIndex) : undefined}
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
  );
};

type NavyPanelProps = {
  navy: NavyState;
  difficulty: DifficultyLevel;
  onDifficultyChange: (value: string) => void;
  onNewGame: () => void;
  onGoLeft?: () => void;
  onGoRight?: () => void;
  onTargetCell?: (cellIndex: number) => void;
};

function NavyPanel({ navy, difficulty, onDifficultyChange, onNewGame, onGoLeft, onGoRight, onTargetCell }: NavyPanelProps) {
  const shipStatusByCode = useMemo(() => {
    return SHIPS.reduce<Record<string, { targetedCount: number; isSunk: boolean }>>((accumulator, ship) => {
      const shipCells = navy.cells.filter((cell) => cell.shipCode === ship.code);
      const targetedCount = shipCells.filter((cell) => cell.effect === 'targeted').length;
      const isSunk = shipCells.length > 0 && shipCells.every((cell) => cell.effect === 'sunk');

      accumulator[ship.code] = { targetedCount, isSunk };
      return accumulator;
    }, {});
  }, [navy.cells]);

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
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel>Difficulty</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={difficulty} onValueChange={onDifficultyChange}>
              <DropdownMenuRadioItem value="level1">Level 1</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="level2">Level 2</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
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
              onClick={onTargetCell ? () => onTargetCell(index) : undefined}
            />
          ))}
        </div>
      </div>

      <div className="px-1">
        <div className="space-y-0.5">
          {SHIPS.map((ship) => {
            const status = shipStatusByCode[ship.code] ?? { targetedCount: 0, isSunk: false };

            return (
              <Tooltip key={`${navy.side}-${ship.code}`}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="relative flex w-full items-center justify-center py-0.5 text-center transition hover:bg-cyan-300/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                    aria-label={ship.name}
                  >
                    {status.isSunk ? (
                      <span className="pointer-events-none absolute left-1/2 top-1/2 h-px w-[calc(100%-1.75rem)] -translate-x-1/2 -translate-y-1/2 bg-red-500" />
                    ) : null}

                    <span className="font-mono text-[12px] tracking-[0.34em]">
                      {Array.from({ length: ship.length }, (_, index) => (
                        <span
                          key={`${ship.code}-${index}`}
                          className={status.isSunk || index < status.targetedCount ? 'text-red-500' : 'text-cyan-100'}
                        >
                          {ship.code}
                          {index < ship.length - 1 ? ' ' : ''}
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

function GridCell({ cell, onClick }: { cell: CellState; onClick?: () => void }) {
  const exposure = cell.exposure;
  const { className, value, label } = getCellPresentation(cell);

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'aspect-square rounded-[2px] border-[0.5px] text-center text-[clamp(0.5rem,1.6vw,0.78rem)] font-semibold leading-none shadow-sm transition-colors duration-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-200',
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
  const value = cell.occupied ? (cell.shipCode ?? '') : cell.effect === 'targeted' ? '–' : '';

  if (cell.effect === 'oil') {
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
      className: 'border-[#404040] bg-[#404040] text-white',
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

function targetCellInNavy(navy: NavyState, cellIndex: number): { navy: NavyState; audioSequence: AudioSequence } {
  const targetCell = navy.cells[cellIndex];

  if (!targetCell || targetCell.effect === 'targeted' || targetCell.effect === 'sunk') {
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
          exposure: 'known',
        };
      });
    }
  }

  const resolvedNavy: NavyState = {
    ...navy,
    cells: nextCells,
    knownCount: nextCells.filter((cell) => cell.exposure === 'known').length,
  };

  return {
    navy: resolvedNavy,
    audioSequence: resolveAudioSequence(nextCells[cellIndex]),
  };
}

function resolveAudioSequence(cell: CellState): AudioSequence {
  if (!cell.occupied) {
    return ['splash'];
  }

  if (cell.effect === 'sunk') {
    return ['explosion', 'sink'];
  }

  if (cell.shipCode === 'E') {
    return ['ensign'];
  }

  if (cell.shipCode === 'L') {
    return ['highscream'];
  }

  if (cell.shipCode === 'H') {
    return ['lowscream'];
  }

  return ['explosion'];
}

function createGameState(): GameState {
  return {
    version: GAME_STATE_VERSION,
    player: createNavy('player', 'Your Navy', true),
    enemy: createNavy('enemy', 'Enemy Navy', false),
  };
}

function createNavy(side: NavySide, label: string, known: boolean): NavyState {
  const ships = placeShips();
  const shipMap = new Map<string, string>();

  ships.forEach((ship) => {
    ship.cells.forEach((cell) => {
      shipMap.set(pointKey(cell), ship.code);
    });
  });

  const cells: CellState[] = [];

  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const shipCode = shipMap.get(pointKey({ x, y }));
      cells.push({
        exposure: known ? 'known' : 'unknown',
        occupied: Boolean(shipCode),
        effect: 'untargeted',
        shipCode,
      });
    }
  }

  return {
    side,
    label,
    ships,
    cells,
    knownCount: known ? GRID_SIZE * GRID_SIZE : 0,
  };
}

function placeShips(): PlacedShip[] {
  const placedShips: PlacedShip[] = [];

  for (const ship of SHIPS) {
    let placed = false;

    for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt += 1) {
      const orientation = randomItem(ORIENTATIONS);
      const start = randomStart(ship.length, orientation);
      const cells = buildShipCells(start, ship.length, orientation);

      if (!isValidPlacement(cells, placedShips)) {
        continue;
      }

      placedShips.push({
        ...ship,
        orientation,
        start,
        cells,
      });
      placed = true;
      break;
    }

    if (!placed) {
      throw new Error(`Unable to place ship ${ship.name}.`);
    }
  }

  return placedShips;
}

function randomStart(length: number, orientation: Orientation): Point {
  const maxX = orientation === 'horizontal-right' || orientation === 'diagonal-down'
    ? GRID_SIZE - length
    : GRID_SIZE - 1;
  const minX = orientation === 'diagonal-up' ? length - 1 : 0;
  const maxY = orientation === 'vertical-down' || orientation === 'diagonal-down'
    ? GRID_SIZE - length
    : GRID_SIZE - 1;
  const minY = orientation === 'diagonal-up' ? length - 1 : 0;

  return {
    x: randomInt(minX, maxX),
    y: randomInt(minY, maxY),
  };
}

function buildShipCells(start: Point, length: number, orientation: Orientation): Point[] {
  return Array.from({ length }, (_, step) => {
    switch (orientation) {
      case 'vertical-down':
        return { x: start.x, y: start.y + step };
      case 'horizontal-right':
        return { x: start.x + step, y: start.y };
      case 'diagonal-down':
        return { x: start.x + step, y: start.y + step };
      case 'diagonal-up':
        return { x: start.x - step, y: start.y + step };
      default:
        return start;
    }
  });
}

function isValidPlacement(candidateCells: Point[], placedShips: PlacedShip[]): boolean {
  if (candidateCells.some((cell) => !isWithinBounds(cell))) {
    return false;
  }

  for (const ship of placedShips) {
    const occupied = new Set(ship.cells.map(pointKey));

    if (candidateCells.some((cell) => occupied.has(pointKey(cell)))) {
      return false;
    }

    if (segmentsIntersect(candidateCells[0], candidateCells[candidateCells.length - 1], ship.cells[0], ship.cells[ship.cells.length - 1])) {
      return false;
    }
  }

  return true;
}

function isWithinBounds(point: Point): boolean {
  return point.x >= 0 && point.x < GRID_SIZE && point.y >= 0 && point.y < GRID_SIZE;
}

function segmentsIntersect(aStart: Point, aEnd: Point, bStart: Point, bEnd: Point): boolean {
  const o1 = orientationValue(aStart, aEnd, bStart);
  const o2 = orientationValue(aStart, aEnd, bEnd);
  const o3 = orientationValue(bStart, bEnd, aStart);
  const o4 = orientationValue(bStart, bEnd, aEnd);

  if (o1 === 0 && onSegment(aStart, bStart, aEnd)) return true;
  if (o2 === 0 && onSegment(aStart, bEnd, aEnd)) return true;
  if (o3 === 0 && onSegment(bStart, aStart, bEnd)) return true;
  if (o4 === 0 && onSegment(bStart, aEnd, bEnd)) return true;

  return o1 !== o2 && o3 !== o4;
}

function orientationValue(a: Point, b: Point, c: Point): number {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);

  if (value === 0) {
    return 0;
  }

  return value > 0 ? 1 : 2;
}

function onSegment(a: Point, b: Point, c: Point): boolean {
  return (
    b.x <= Math.max(a.x, c.x) &&
    b.x >= Math.min(a.x, c.x) &&
    b.y <= Math.max(a.y, c.y) &&
    b.y >= Math.min(a.y, c.y)
  );
}

function randomItem<T>(items: T[]): T {
  return items[randomInt(0, items.length - 1)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

export default Index;

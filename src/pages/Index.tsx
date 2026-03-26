import { useEffect, useMemo, useState } from 'react';
import { useSeoMeta } from '@unhead/react';
import { ChevronLeft, ChevronRight, Waves } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

type CellState = {
  known: boolean;
  polluted: boolean;
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
  player: NavyState;
  enemy: NavyState;
};

const GRID_SIZE = 10;
const STORAGE_KEY = 'armada:game-state';
const MAX_PLACEMENT_ATTEMPTS = 5000;

const SHIPS: ShipDefinition[] = [
  { code: 'A', name: 'Aircraft Carrier', length: 5 },
  { code: 'B', name: 'Battleship', length: 4 },
  { code: 'C', name: 'Cruiser', length: 3 },
  { code: 'D', name: 'Destroyer', length: 3 },
  { code: 'F', name: 'Frigate', length: 3 },
  { code: 'O', name: 'Oil Tanker', length: 3 },
  { code: 'G', name: 'Garbage Scow', length: 2 },
  { code: 'S', name: 'Submarine', length: 2 },
  { code: 'E', name: 'Ensign', length: 1 },
  { code: 'H', name: 'Helicopter', length: 1 },
  { code: 'L', name: 'Lifeboat', length: 1 },
];

const ORIENTATIONS: Orientation[] = [
  'vertical-down',
  'horizontal-right',
  'diagonal-down',
  'diagonal-up',
];

const navyViewOrder: NavySide[] = ['player', 'enemy'];

const Index = () => {
  useSeoMeta({
    title: 'Armada',
    description: 'A mobile-first Armada board showing randomized navy setup for both fleets.',
  });

  const [gameState, setGameState] = useState<GameState | null>(null);
  const [activeView, setActiveView] = useState<NavySide>('player');

  useEffect(() => {
    const storedState = window.localStorage.getItem(STORAGE_KEY);

    if (storedState) {
      try {
        const parsedState = JSON.parse(storedState) as GameState;
        setGameState(parsedState);
        return;
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

  return (
    <main className="min-h-screen overflow-hidden bg-slate-950 text-slate-50">
      <div className="relative isolate min-h-screen bg-[radial-gradient(circle_at_top,_rgba(125,211,252,0.18),_transparent_40%),linear-gradient(180deg,_#020617_0%,_#0f172a_45%,_#111827_100%)]">
        <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-8 pt-6 sm:px-6">
          <header className="mb-6 space-y-4 rounded-[28px] border border-white/10 bg-white/5 p-5 shadow-2xl shadow-cyan-950/30 backdrop-blur-md">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="inline-flex items-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-cyan-200">
                  Fleet Deployment
                </div>
                <h1 className="text-4xl font-semibold tracking-tight text-white">Armada</h1>
                <p className="text-sm leading-6 text-slate-300">
                  Two navies. Randomized placement. Your fleet is fully visible while the opposing fleet stays hidden.
                </p>
              </div>
              <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-3 text-cyan-100 shadow-lg shadow-cyan-950/30">
                <Waves className="h-6 w-6" aria-hidden="true" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs text-slate-300">
              <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-3">
                <div className="font-medium text-white">Board</div>
                <div className="mt-1">10 × 10 cells per navy</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-3">
                <div className="font-medium text-white">Vision</div>
                <div className="mt-1">Player known, enemy unknown</div>
              </div>
            </div>
          </header>

          {gameState && activeNavy ? (
            <section className="space-y-4">
              <div className="overflow-hidden rounded-[32px] border border-white/10 bg-white/5 shadow-[0_24px_80px_rgba(14,116,144,0.18)] backdrop-blur-md">
                <div
                  className="flex w-[200%] transition-transform duration-500 ease-out"
                  style={{ transform: `translateX(-${activeIndex * 50}%)` }}
                >
                  {navyViewOrder.map((side) => {
                    const navy = side === 'player' ? gameState.player : gameState.enemy;

                    return (
                      <div key={side} className="w-1/2 shrink-0 p-4">
                        <NavyPanel
                          navy={navy}
                          onGoLeft={canGoLeft && side === activeView ? () => setActiveView('player') : undefined}
                          onGoRight={canGoRight && side === activeView ? () => setActiveView('enemy') : undefined}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              <footer className="px-2 text-center text-xs leading-5 text-slate-400">
                <a
                  href="https://shakespeare.diy"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-cyan-300 underline decoration-cyan-500/40 underline-offset-4 transition hover:text-cyan-200"
                >
                  Vibed with Shakespeare
                </a>
              </footer>
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
  onGoLeft?: () => void;
  onGoRight?: () => void;
};

function NavyPanel({ navy, onGoLeft, onGoRight }: NavyPanelProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 px-1 pt-1">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.28em] text-cyan-200/80">{navy.side === 'player' ? 'Left Grid' : 'Right Grid'}</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-white">{navy.label}</h2>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-900/40 px-3 py-2 text-right text-xs text-slate-300">
          <div>{navy.knownCount} known cells</div>
          <div>{GRID_SIZE * GRID_SIZE - navy.knownCount} unknown cells</div>
        </div>
      </div>

      <div className="rounded-[28px] border border-cyan-200/10 bg-slate-950/70 p-3 shadow-inner shadow-cyan-950/20">
        <div
          className="grid w-full gap-1"
          style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, minmax(0, 1fr))` }}
          aria-label={`${navy.label} grid`}
        >
          {navy.cells.map((cell, index) => (
            <GridCell key={`${navy.side}-${index}`} cell={cell} />
          ))}
        </div>
      </div>

      <div className="relative flex min-h-12 items-center px-1 text-xs uppercase tracking-[0.24em] text-slate-300">
        {onGoLeft ? (
          <>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={onGoLeft}
              className="absolute left-0 h-11 w-11 rounded-full border border-white/10 bg-white/10 text-white hover:bg-white/20"
              aria-label="Show my navy"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </Button>
            <span className="w-full text-center">Show My Navy</span>
          </>
        ) : null}
        {onGoRight ? (
          <>
            <span className="w-full text-center">Show Enemy Navy</span>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={onGoRight}
              className="absolute right-0 h-11 w-11 rounded-full border border-white/10 bg-white/10 text-white hover:bg-white/20"
              aria-label="Show enemy navy"
            >
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </Button>
          </>
        ) : null}
      </div>

      <div className="rounded-[28px] border border-white/10 bg-slate-900/50 p-4">
        <div className="mb-3 text-xs font-medium uppercase tracking-[0.28em] text-slate-400">Ships in navy</div>
        <div className="space-y-2">
          {SHIPS.map((ship) => (
            <Tooltip key={`${navy.side}-${ship.code}`}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-center rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3 text-center transition hover:border-cyan-300/30 hover:bg-cyan-300/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                  aria-label={ship.name}
                >
                  <span className="font-mono text-sm tracking-[0.42em] text-cyan-100">
                    {Array.from({ length: ship.length }, () => ship.code).join(' ')}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{ship.name}</p>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>
    </div>
  );
}

function GridCell({ cell }: { cell: CellState }) {
  const displayValue = cell.known && cell.shipCode ? cell.shipCode : '';

  return (
    <div
      className={cn(
        'aspect-square rounded-[4px] border text-center text-[clamp(0.55rem,2vw,0.85rem)] font-semibold leading-none shadow-sm transition-colors duration-300',
        cell.known
          ? 'border-cyan-100/20 bg-cyan-600 text-white shadow-cyan-950/20'
          : cell.polluted
            ? 'border-slate-700 bg-slate-800 text-white'
            : 'border-slate-300/40 bg-slate-200 text-white'
      )}
      aria-label={cell.known ? (cell.shipCode ? `Known cell with ship ${cell.shipCode}` : 'Known empty cell') : 'Unknown cell'}
    >
      <div className="flex h-full items-center justify-center text-white">{displayValue}</div>
    </div>
  );
}

function createGameState(): GameState {
  return {
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
        known,
        polluted: false,
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

export type Orientation = 'vertical-down' | 'horizontal-right' | 'diagonal-down' | 'diagonal-up';
export type NavySide = 'player' | 'enemy';

export type ShipDefinition = {
  code: string;
  name: string;
  length: number;
};

export type Point = {
  x: number;
  y: number;
};

export type PlacedShip = ShipDefinition & {
  orientation: Orientation;
  start: Point;
  cells: Point[];
};

export type ExposureState = 'known' | 'unknown' | 'revealed';
export type EffectState = 'untargeted' | 'targeted' | 'sunk';

export type CellState = {
  exposure: ExposureState;
  occupied: boolean;
  effect: EffectState;
  targeting: boolean;
  oil: boolean;
  shipCode?: string;
};

export type NavyState = {
  side: NavySide;
  label: string;
  knownCount: number;
  ships: PlacedShip[];
  cells: CellState[];
  /** True for exactly one turn cycle after the Oil Tanker sinks, before its wreck cells become oil. */
  oilPending: boolean;
};

export type TurnOwner = 'player' | 'app';
export type Winner = 'player' | 'app';
export type WeaponType = 'moab' | 'mine';

export type GameState = {
  version: number;
  currentTurn: TurnOwner;
  player: NavyState;
  enemy: NavyState;
  /** Special weapon shots fired this game, capped at SPECIAL_WEAPON_QUOTA regardless of standing inventory. Resets with a new game, unlike the inventory itself. */
  playerWeaponsUsed: number;
  /** The computer's own MOAB loadout for this game - unlike the player's, this isn't a standing inventory (the computer doesn't watch ads), just a fixed per-game starting count. */
  appMoabCount: number;
  /** Mirrors appMoabCount for the Mine. */
  appMineCount: number;
  /** Mirrors playerWeaponsUsed for the computer. */
  appWeaponsUsed: number;
  /** Index in enemy.cells currently holding the player's active mine, or null if none is placed. Only one mine may be active at a time. */
  playerMineIndex: number | null;
  /** Mirrors playerMineIndex for the computer's mine, in player.cells. */
  appMineIndex: number | null;
  /** MOAB is capped at one use per side per game, independent of standing inventory or the shared SPECIAL_WEAPON_QUOTA. Resets with a new game. */
  playerMoabUsedThisGame: boolean;
  /** Mirrors playerMoabUsedThisGame for the computer. */
  appMoabUsedThisGame: boolean;
};

export type AudioCue = 'splash' | 'sink' | 'lifeboat' | 'ensign' | 'helicopter' | 'explosion' | 'wingame';
export type AudioSequence = AudioCue[];
export type DifficultyLevel = 'level1' | 'level2';
export type ShipSetOptions = {
  includeSingles: boolean;
};

export type TargetingResult = {
  navy: NavyState;
  audioSequence: AudioSequence;
  ignited?: boolean;
  /** Every cell resolved this turn, populated only when ignited is true, so the UI can animate the whole chain-reaction at once. */
  ignitedCellIndexes?: number[];
  /** For a multi-cell weapon like the MOAB: exactly which cells it targeted this call, before any oil chain reaction, so the UI knows which ones to animate as hits. */
  targetedIndexes?: number[];
};

export const GRID_SIZE = 10;
export const GAME_STATE_VERSION = 14;
// Total special-weapon shots (any type, combined) allowed per side per game -
// independent of how large a standing inventory ad-refills have built up.
export const SPECIAL_WEAPON_QUOTA = 4;
export const APP_MOAB_STARTING_COUNT = 2;
export const APP_MINE_STARTING_COUNT = 2;
// Chance, per computer turn (once a target cell is chosen), that it fires a
// special weapon instead of a plain shot - checked only while it's still
// under its per-game quota and has at least one available weapon.
const APP_WEAPON_USE_CHANCE = 0.25;
const MAX_PLACEMENT_ATTEMPTS = 5000;
const OIL_IGNITION_ODDS = 12;

const BASE_SHIPS: ShipDefinition[] = [
  { code: 'A', name: 'Aircraft Carrier', length: 5 },
  { code: 'B', name: 'Battleship', length: 4 },
  { code: 'C', name: 'Cruiser', length: 3 },
  { code: 'D', name: 'Destroyer', length: 3 },
  { code: 'F', name: 'Frigate', length: 3 },
  { code: 'G', name: 'Garbage Scow', length: 2 },
  { code: 'O', name: 'Oil Tanker', length: 3 },
  { code: 'S', name: 'Submarine', length: 2 },
];

const SINGLE_SHIPS: ShipDefinition[] = [
  { code: 'E', name: 'Ensign', length: 1 },
  { code: 'H', name: 'Helicopter', length: 1 },
  { code: 'L', name: 'Lifeboat', length: 1 },
];

export const DEFAULT_SHIP_SET_OPTIONS: ShipSetOptions = {
  includeSingles: true,
};

export function getShips(options: ShipSetOptions = DEFAULT_SHIP_SET_OPTIONS): ShipDefinition[] {
  return options.includeSingles ? [...BASE_SHIPS, ...SINGLE_SHIPS] : BASE_SHIPS;
}

const ORIENTATIONS: Orientation[] = [
  'vertical-down',
  'horizontal-right',
  'diagonal-down',
  'diagonal-up',
];

export const AUDIO_FILES: Record<AudioCue, string> = {
  splash: `${import.meta.env.BASE_URL}audio/Splash.wav`,
  sink: `${import.meta.env.BASE_URL}audio/Sink.wav`,
  lifeboat: `${import.meta.env.BASE_URL}audio/LifeBoat.wav`,
  ensign: `${import.meta.env.BASE_URL}audio/Ensign.wav`,
  helicopter: `${import.meta.env.BASE_URL}audio/Helicopter.wav`,
  explosion: `${import.meta.env.BASE_URL}audio/Explosion.wav`,
  wingame: `${import.meta.env.BASE_URL}audio/WinGame.wav`,
};

export function resolveTargetingSequence(navy: NavyState, initialCellIndexes: number[]): TargetingResult {
  let currentNavy = activatePendingOilSlick(navy);
  const playedCues = new Set<AudioCue>();
  const pendingIndexes = [...initialCellIndexes];
  const visitedIndexes = new Set<number>();
  let ignited = false;

  while (pendingIndexes.length > 0) {
    const cellIndex = pendingIndexes.shift();

    if (cellIndex === undefined || visitedIndexes.has(cellIndex)) {
      continue;
    }

    visitedIndexes.add(cellIndex);

    const result = targetCellInNavy(currentNavy, cellIndex);
    currentNavy = result.navy;
    result.audioSequence.forEach((cue) => playedCues.add(cue));

    const targetedCell = currentNavy.cells[cellIndex];
    const cellHadOil = targetedCell?.oil ?? false;

    if (cellHadOil && targetedCell.effect === 'targeted' && randomInt(1, OIL_IGNITION_ODDS) === 1) {
      ignited = true;

      currentNavy.cells.forEach((cell, index) => {
        if (cell.oil && cell.effect === 'untargeted' && !visitedIndexes.has(index)) {
          const preparedNavy = setCellState(currentNavy, index, {
            effect: 'targeted',
            targeting: false,
          });
          currentNavy = preparedNavy;
          pendingIndexes.push(index);
        }
      });
    } else if (cellHadOil && targetedCell.occupied) {
      // An explosion on an oiled ship cell burns the oil off at that spot,
      // even when it doesn't ignite the whole slick. A shot that just
      // splashes into oil over an empty cell has nothing to ignite, so the
      // oil there is undisturbed and stays part of the slick.
      currentNavy = setCellState(currentNavy, cellIndex, { oil: false });
    }
  }

  currentNavy = ignited ? extinguishOilSlick(currentNavy) : spreadOilSlick(currentNavy);

  const audioSequence = ignited
    ? Array.from(playedCues).filter((cue) => cue !== 'explosion' && cue !== 'splash')
    : Array.from(playedCues);

  return {
    navy: currentNavy,
    audioSequence,
    ignited,
    ignitedCellIndexes: ignited ? Array.from(visitedIndexes) : undefined,
  };
}

/** The cell itself plus its up-to-8 neighbors, clipped at grid edges - so a
 * corner cell yields only 4 total, not 9. */
export function getMoabTargetIndexes(cellIndex: number): number[] {
  return [cellIndex, ...getAdjacentIndexes(cellIndex)];
}

export function fireMoab(navy: NavyState, cellIndex: number): TargetingResult {
  const targetIndexes = getMoabTargetIndexes(cellIndex).filter(
    (index) => navy.cells[index]?.effect === 'untargeted',
  );

  const preparedNavy = targetIndexes.reduce(
    (currentNavy, index) => setCellState(currentNavy, index, { effect: 'targeted', targeting: false }),
    navy,
  );

  const result = resolveTargetingSequence(preparedNavy, targetIndexes);

  return { ...result, targetedIndexes: targetIndexes };
}

export type MineMoveResult = {
  navy: NavyState;
  /** The mine's new position, or null if this move detonated it (hit a ship - a mine is consumed on its first hit, freeing the "one active mine" slot). */
  mineIndex: number | null;
  hit: boolean;
  hitIndex?: number;
  audioSequence: AudioSequence;
  ignited?: boolean;
  ignitedCellIndexes?: number[];
};

/**
 * A mine's automatic per-turn wander: moves to one random adjacent cell,
 * regardless of whether that cell has already been targeted or the mine has
 * already visited it. Only detonates (and is only ever processed through
 * the normal targeting/oil-ignition machinery) if the new cell is both
 * untargeted and occupied - an untargeted empty cell, or any already-
 * targeted cell, is a silent no-op move. This is why a mine's movement
 * can never ignite the oil slick by itself: an empty oil cell never gets
 * targeted by a move, only a hit does, and a hit always reflects a real
 * ship cell.
 */
export function moveMine(navy: NavyState, mineIndex: number): MineMoveResult {
  const newIndex = randomItem(getAdjacentIndexes(mineIndex));
  const candidateCell = navy.cells[newIndex];

  // A floating mine can't score a hit on the Helicopter by drifting under
  // it - it's airborne, not on the water. A mine deliberately dropped on
  // its cell still hits normally; this only guards the passive wander.
  if (candidateCell.effect === 'untargeted' && candidateCell.occupied && candidateCell.shipCode !== 'H') {
    const preparedNavy = setCellState(navy, newIndex, { effect: 'targeted', targeting: false });
    const result = resolveTargetingSequence(preparedNavy, [newIndex]);

    return {
      navy: result.navy,
      mineIndex: null,
      hit: true,
      hitIndex: newIndex,
      audioSequence: result.audioSequence,
      ignited: result.ignited,
      ignitedCellIndexes: result.ignitedCellIndexes,
    };
  }

  return {
    navy,
    mineIndex: newIndex,
    hit: false,
    audioSequence: [],
  };
}

export function setCellState(navy: NavyState, cellIndex: number, updates: Partial<CellState>): NavyState {
  const nextCells = navy.cells.map((cell, index) => {
    if (index !== cellIndex) {
      return cell;
    }

    return {
      ...cell,
      ...updates,
    };
  });

  return {
    ...navy,
    cells: nextCells,
    knownCount: nextCells.filter((cell) => cell.exposure === 'known' || cell.exposure === 'revealed').length,
  };
}

export function setCellTargeting(navy: NavyState, cellIndex: number, targeting: boolean): NavyState {
  return setCellState(navy, cellIndex, { targeting });
}

export function selectAppTargetIndex(navy: NavyState, difficulty: DifficultyLevel): number | null {
  const untargetedIndexes = navy.cells.reduce<number[]>((indexes, cell, index) => {
    if (cell.effect === 'untargeted') {
      indexes.push(index);
    }
    return indexes;
  }, []);

  if (untargetedIndexes.length === 0) {
    return null;
  }

  if (difficulty === 'level2') {
    const candidateIndexes = new Set<number>();

    navy.cells.forEach((cell, index) => {
      if (cell.effect !== 'targeted' || !cell.occupied) {
        return;
      }

      const isPartOfSunkShip = cell.shipCode
        ? navy.cells
            .filter((candidateCell) => candidateCell.shipCode === cell.shipCode)
            .every((candidateCell) => candidateCell.effect === 'sunk')
        : false;

      if (isPartOfSunkShip) {
        return;
      }

      getAdjacentIndexes(index).forEach((adjacentIndex) => {
        if (navy.cells[adjacentIndex]?.effect === 'untargeted') {
          candidateIndexes.add(adjacentIndex);
        }
      });
    });

    if (candidateIndexes.size > 0) {
      return randomItem(Array.from(candidateIndexes));
    }
  }

  return randomItem(untargetedIndexes);
}

export function selectAppWeaponChoice(options: {
  appWeaponsUsed: number;
  appMoabCount: number;
  appMoabUsedThisGame: boolean;
  appMineCount: number;
  appMineIndex: number | null;
}): WeaponType | null {
  if (options.appWeaponsUsed >= SPECIAL_WEAPON_QUOTA) {
    return null;
  }

  if (Math.random() >= APP_WEAPON_USE_CHANCE) {
    return null;
  }

  const availableWeapons: WeaponType[] = [];
  if (options.appMoabCount > 0 && !options.appMoabUsedThisGame) {
    availableWeapons.push('moab');
  }
  if (options.appMineCount > 0 && options.appMineIndex === null) {
    availableWeapons.push('mine');
  }

  if (availableWeapons.length === 0) {
    return null;
  }

  return randomItem(availableWeapons);
}

export function areAllShipsSunk(navy: NavyState, options: ShipSetOptions = DEFAULT_SHIP_SET_OPTIONS): boolean {
  return getShips(options).every((ship) => navy.cells.filter((cell) => cell.shipCode === ship.code).every((cell) => cell.effect === 'sunk'));
}

export function createGameState(options: ShipSetOptions = DEFAULT_SHIP_SET_OPTIONS): GameState {
  const currentTurn: TurnOwner = Math.random() < 0.5 ? 'player' : 'app';

  return {
    version: GAME_STATE_VERSION,
    currentTurn,
    player: createNavy('player', 'Your Navy', true, options),
    enemy: createNavy('enemy', 'Enemy Navy', false, options),
    playerWeaponsUsed: 0,
    appMoabCount: APP_MOAB_STARTING_COUNT,
    appMineCount: APP_MINE_STARTING_COUNT,
    appWeaponsUsed: 0,
    playerMineIndex: null,
    appMineIndex: null,
    playerMoabUsedThisGame: false,
    appMoabUsedThisGame: false,
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
  let oilTankerJustSunk = false;

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

      oilTankerJustSunk = targetedCell.shipCode === 'O';
    }
  }

  const resolvedNavy: NavyState = {
    ...navy,
    cells: nextCells,
    knownCount: nextCells.filter((cell) => cell.exposure === 'known' || cell.exposure === 'revealed').length,
    oilPending: navy.oilPending || oilTankerJustSunk,
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

  const sequence: AudioSequence = ['explosion'];

  if (cell.effect === 'sunk') {
    sequence.push('sink');

    if (cell.shipCode === 'E') {
      sequence.push('ensign');
    }

    if (cell.shipCode === 'L') {
      sequence.push('lifeboat');
    }

    if (cell.shipCode === 'H') {
      sequence.push('helicopter');
    }
  }

  return sequence;
}

export function getAdjacentIndexes(cellIndex: number): number[] {
  const x = cellIndex % GRID_SIZE;
  const y = Math.floor(cellIndex / GRID_SIZE);
  const adjacentIndexes: number[] = [];

  for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
    for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
      if (deltaX === 0 && deltaY === 0) {
        continue;
      }

      const nextX = x + deltaX;
      const nextY = y + deltaY;

      if (nextX >= 0 && nextX < GRID_SIZE && nextY >= 0 && nextY < GRID_SIZE) {
        adjacentIndexes.push(nextY * GRID_SIZE + nextX);
      }
    }
  }

  return adjacentIndexes;
}

function activatePendingOilSlick(navy: NavyState): NavyState {
  if (!navy.oilPending) {
    return navy;
  }

  const nextCells = navy.cells.map((cell) => (
    cell.shipCode === 'O' ? { ...cell, oil: true } : cell
  ));

  return {
    ...navy,
    cells: nextCells,
    oilPending: false,
  };
}

function extinguishOilSlick(navy: NavyState): NavyState {
  const nextCells = navy.cells.map((cell) => (
    cell.oil ? { ...cell, oil: false } : cell
  ));

  return {
    ...navy,
    cells: nextCells,
  };
}

function spreadOilSlick(navy: NavyState): NavyState {
  const candidateIndexes = navy.cells.reduce<number[]>((indexes, cell, index) => {
    if (cell.oil || cell.effect !== 'untargeted') {
      return indexes;
    }

    const isAdjacentToOil = getAdjacentIndexes(index).some((adjacentIndex) => navy.cells[adjacentIndex]?.oil);

    if (isAdjacentToOil) {
      indexes.push(index);
    }

    return indexes;
  }, []);

  if (candidateIndexes.length === 0) {
    return navy;
  }

  const spreadIndex = randomItem(candidateIndexes);
  return setCellState(navy, spreadIndex, { oil: true });
}

function createNavy(side: NavySide, label: string, known: boolean, options: ShipSetOptions): NavyState {
  const ships = placeShips(options);
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
        targeting: false,
        oil: false,
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
    oilPending: false,
  };
}

function placeShips(options: ShipSetOptions): PlacedShip[] {
  const placedShips: PlacedShip[] = [];

  for (const ship of getShips(options)) {
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

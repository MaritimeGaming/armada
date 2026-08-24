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
  /**
   * True once a Drone shot has found this specific cell. Deliberately
   * separate from exposure: a navy created with known=true (a side's own
   * fleet, see createNavy) starts every cell at exposure 'known' regardless
   * of any Drone activity, since there's no fog of war over your own
   * ships - so exposure alone can't tell "genuinely Drone-found" apart
   * from "just always visible to its owner." This field can only ever be
   * set by fireDrone(), so it's unambiguous either way.
   */
  droneRevealed?: boolean;
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
export type WeaponType = 'moab' | 'mine' | 'torpedo' | 'rocket' | 'harpoon' | 'drone';

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
  /** Mirrors appMoabCount for the Torpedo. */
  appTorpedoCount: number;
  /** Mirrors appMoabCount for the Rocket. */
  appRocketCount: number;
  /** Mirrors appMoabCount for the Harpoon. */
  appHarpoonCount: number;
  /** Mirrors appMoabCount for the Drone. */
  appDroneCount: number;
  /** Mirrors playerWeaponsUsed for the computer. */
  appWeaponsUsed: number;
  /** Index in enemy.cells currently holding the player's active mine, or null if none is placed. Only one mine may be active at a time. */
  playerMineIndex: number | null;
  /** Mirrors playerMineIndex for the computer's mine, in player.cells. */
  appMineIndex: number | null;
  /** The 3 of 6 weapon types in play this game - the same set for both sides. Picked once by pickActiveWeaponTypes() in createGameState(), resets with a new game. */
  activeWeaponTypes: WeaponType[];
  /**
   * The player's own uses-this-game count per weapon type, checked against
   * WEAPON_TYPE_USE_CAP. Resets with a new game, unlike the player's
   * standing inventory (which lives outside GameState entirely, in
   * Index.tsx, and isn't reset by a new game). The computer needs no
   * equivalent field: its own per-type standing counts (appMoabCount etc.)
   * already start at exactly WEAPON_TYPE_USE_CAP each game and never reset
   * mid-game, so their own exhaustion already enforces the same cap.
   */
  playerWeaponUseCounts: Record<WeaponType, number>;
};

export type AudioCue = 'splash' | 'sink' | 'lifeboat' | 'ensign' | 'helicopter' | 'explosion' | 'wingame';
export type AudioSequence = AudioCue[];
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
export const GAME_STATE_VERSION = 19;
// Total special-weapon shots (any type, combined) allowed per side per game -
// independent of how large a standing inventory ad-refills have built up.
export const SPECIAL_WEAPON_QUOTA = 5;
// Max uses of any single weapon type per side per game, independent of the
// shared SPECIAL_WEAPON_QUOTA above and of standing inventory - applies
// uniformly to all six types now, MOAB included (MOAB previously had its
// own stricter one-per-game rule, loosened here since Torpedo/Rocket/
// Harpoon's ~5-6 cell footprints have closed most of the gap with MOAB's
// 9-cell blast). With only ACTIVE_WEAPON_TYPE_COUNT (3) weapon types live
// in a given game, this cap has a deliberate side effect: spending all
// SPECIAL_WEAPON_QUOTA (5) shots is only possible as 2+2+1, which forces
// at least one shot into every active type rather than letting a player
// dump all 5 into a single favorite.
export const WEAPON_TYPE_USE_CAP = 2;
// How many of the 6 weapon types are randomly drawn into play each game -
// the same ACTIVE_WEAPON_TYPE_COUNT types for both sides (see
// pickActiveWeaponTypes()), not independently randomized per side.
const ACTIVE_WEAPON_TYPE_COUNT = 3;
// Chance, once the computer has already rolled to fire some weapon this
// turn (APP_WEAPON_USE_CHANCE below) and MOAB is one of the eligible
// choices, that MOAB is picked outright instead of joining the uniform
// random pool with whatever else is available - noticeably more MOAB use
// than chance alone, but never guaranteed.
const APP_MOAB_PRIORITY_CHANCE = 0.5;
// Canonical display order for the weapons bar - also what
// pickActiveWeaponTypes() sorts a game's 3 chosen types back into, so
// whichever 3 are active this game still appear in this relative order.
export const ALL_WEAPON_TYPES: WeaponType[] = ['moab', 'mine', 'drone', 'torpedo', 'harpoon', 'rocket'];
export const APP_MOAB_STARTING_COUNT = 2;
export const APP_MINE_STARTING_COUNT = 2;
export const APP_TORPEDO_STARTING_COUNT = 2;
export const APP_ROCKET_STARTING_COUNT = 2;
export const APP_HARPOON_STARTING_COUNT = 2;
export const APP_DRONE_STARTING_COUNT = 2;
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

/**
 * The nearest other untargeted cell belonging to the same ship as
 * cellIndex, measured by position along the ship's own cell list (not raw
 * grid distance, though for a straight-line ship they agree) - ties broken
 * randomly. Returns null if cellIndex isn't occupied, or there's no other
 * untargeted cell left on that ship (a single-cell ship, or one already
 * fully spent elsewhere).
 */
function findNearestUntargetedShipCell(navy: NavyState, cellIndex: number): number | null {
  const shipCode = navy.cells[cellIndex]?.shipCode;

  if (!shipCode) {
    return null;
  }

  const ship = navy.ships.find((candidateShip) => candidateShip.code === shipCode);

  if (!ship) {
    return null;
  }

  const impactPosition = ship.cells.findIndex((point) => point.y * GRID_SIZE + point.x === cellIndex);

  if (impactPosition === -1) {
    return null;
  }

  let nearestIndexes: number[] = [];
  let nearestDistance = Infinity;

  ship.cells.forEach((point, position) => {
    if (position === impactPosition) {
      return;
    }

    const candidateIndex = point.y * GRID_SIZE + point.x;

    if (navy.cells[candidateIndex]?.effect !== 'untargeted') {
      return;
    }

    const distance = Math.abs(position - impactPosition);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndexes = [candidateIndex];
    } else if (distance === nearestDistance) {
      nearestIndexes.push(candidateIndex);
    }
  });

  if (nearestIndexes.length === 0) {
    return null;
  }

  return randomItem(nearestIndexes);
}

/**
 * Resolves a Mine detonation at cellIndex: the impact cell itself, plus -
 * if it's occupied and belongs to a multi-cell ship - the nearest other
 * untargeted cell of that same ship (see findNearestUntargetedShipCell),
 * so a Mine always takes out two cells of whatever ship it finds rather
 * than one. A single-cell ship gets no bonus (there's no other cell to
 * reach), and a ship with two or fewer untargeted cells left is sunk
 * outright. Each detonated cell gets its own independent oil-ignition
 * roll, same as any other hit. A miss (cellIndex unoccupied) resolves
 * exactly like a normal single-cell shot.
 */
export function resolveMineHit(navy: NavyState, cellIndex: number): TargetingResult {
  const extraIndex = findNearestUntargetedShipCell(navy, cellIndex);
  const targetIndexes = extraIndex === null ? [cellIndex] : [cellIndex, extraIndex];

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
  /** The impact cell plus its extra same-ship detonation, if any (see resolveMineHit). */
  hitIndexes?: number[];
  audioSequence: AudioSequence;
  ignited?: boolean;
  ignitedCellIndexes?: number[];
};

// Chance, per mine wander step, that it moves toward an untargeted
// neighbor rather than a uniformly random one (when at least one
// untargeted neighbor exists). Weighted rather than absolute so the mine
// can still occasionally cut across already-targeted territory - an
// absolute "always chase the nearest untargeted cell" rule would trap it
// hugging whatever small local pocket it's already next to, never willing
// to cross explored ground to reach a completely different, richer
// unexplored region elsewhere on the board.
const MINE_WANDER_UNTARGETED_BIAS = 0.75;

function selectMineWanderIndex(navy: NavyState, mineIndex: number): number {
  const adjacentIndexes = getAdjacentIndexes(mineIndex);
  const untargetedAdjacentIndexes = adjacentIndexes.filter((index) => navy.cells[index]?.effect === 'untargeted');

  if (untargetedAdjacentIndexes.length > 0 && Math.random() < MINE_WANDER_UNTARGETED_BIAS) {
    return randomItem(untargetedAdjacentIndexes);
  }

  return randomItem(adjacentIndexes);
}

/**
 * A mine's automatic per-turn wander: moves to one adjacent cell, weighted
 * toward still-untargeted ones (see MINE_WANDER_UNTARGETED_BIAS) so it
 * tends to push into unexplored territory rather than retread cells it or
 * a regular shot has already settled. Detonates (see resolveMineHit) if
 * the new cell is both untargeted and occupied. Otherwise - an untargeted
 * empty cell, or any already-targeted cell - it's not a hit, but if the
 * cell was still untargeted, it's silently marked targeted anyway (no
 * sound, no ignition risk): the mine quietly confirms there's nothing
 * there, so the player doesn't have to spend a shot finding that out
 * themselves. The one cell a mine can never resolve this way is the
 * Helicopter's - it's airborne, so the mine drifts past without ever
 * detecting it, hit or reveal.
 *
 * This silent reveal deliberately bypasses the normal oil-ignition check
 * (a raw cell update, not resolveTargetingSequence): a mine's movement
 * still can never ignite the oil slick by itself, matching the same
 * principle as before - only an actual hit (always a real ship cell) ever
 * risks ignition.
 */
export function moveMine(navy: NavyState, mineIndex: number): MineMoveResult {
  const newIndex = selectMineWanderIndex(navy, mineIndex);
  const candidateCell = navy.cells[newIndex];

  // A floating mine can't score a hit on the Helicopter by drifting under
  // it - it's airborne, not on the water. A mine deliberately dropped on
  // its cell still hits normally; this only guards the passive wander.
  const isDetectable = !(candidateCell.occupied && candidateCell.shipCode === 'H');

  if (candidateCell.effect === 'untargeted' && candidateCell.occupied && isDetectable) {
    const result = resolveMineHit(navy, newIndex);

    return {
      navy: result.navy,
      mineIndex: null,
      hit: true,
      hitIndexes: result.targetedIndexes,
      audioSequence: result.audioSequence,
      ignited: result.ignited,
      ignitedCellIndexes: result.ignitedCellIndexes,
    };
  }

  const nextNavy = candidateCell.effect === 'untargeted' && isDetectable
    ? setCellState(navy, newIndex, {
        effect: 'targeted',
        targeting: false,
        exposure: candidateCell.exposure === 'unknown' ? 'known' : candidateCell.exposure,
      })
    : navy;

  return {
    navy: nextNavy,
    mineIndex: newIndex,
    hit: false,
    audioSequence: [],
  };
}

export type WeaponTravelStep = {
  cellIndex: number;
  /** Navy state after this step resolves. */
  navy: NavyState;
  isHit: boolean;
  /** Empty when this step is a silent pass-through or a silent miss during travel. */
  audioSequence: AudioSequence;
  ignited?: boolean;
  ignitedCellIndexes?: number[];
};

export type WeaponTravelResult = {
  /** Every step the weapon took, launch cell first, in order. */
  steps: WeaponTravelStep[];
};

// How many cells beyond the launch cell a Torpedo or Rocket always
// travels, hit or miss - fixed rather than "until the first hit," so it
// reliably shows its travel animation instead of frequently resolving on
// the very first or second cell. Shared by both weapons since they're
// direct counterparts, differing only in orientation.
export const WEAPON_TRAVEL_DISTANCE = 5;

export type WeaponTravelAxis = 'horizontal' | 'vertical' | 'diagonal';

/**
 * The cells a Torpedo (horizontal), Rocket (vertical), or Harpoon
 * (diagonal) would cross from cellIndex, in travel order, clipped at the
 * board edge. Each axis that applies moves toward the far edge from
 * whichever half of that axis cellIndex falls in - increasing from the
 * first half (row/column 0-4), decreasing from the second half (5-9) -
 * and diagonal moves both axes at once, so a single fixed "always
 * down-right" rule would leave two of the board's four quadrants with no
 * full-length run in either diagonal direction (e.g. the top-right corner
 * has no room to go down-right, and no room to go up-left either). Moving
 * both axes independently instead means every cell's quadrant gets its
 * own diagonal - top-left always down-right, bottom-right always up-left,
 * top-right always down-left, bottom-left always up-right - so every
 * cell, on every axis this function supports, always has a full
 * WEAPON_TRAVEL_DISTANCE cells of room (never clipped in practice on a
 * 10-wide/tall board, since every split falls exactly at 4/5). Doesn't
 * consider what's actually in those cells - just the geometry of the run.
 */
export function getWeaponTravelIndexes(cellIndex: number, axis: WeaponTravelAxis): number[] {
  const column = cellIndex % GRID_SIZE;
  const row = Math.floor(cellIndex / GRID_SIZE);
  const columnStep = axis === 'vertical' ? 0 : column <= 4 ? 1 : -1;
  const rowStep = axis === 'horizontal' ? 0 : row <= 4 ? 1 : -1;

  const indexes: number[] = [];

  for (let distance = 1; distance <= WEAPON_TRAVEL_DISTANCE; distance += 1) {
    const nextColumn = column + columnStep * distance;
    const nextRow = row + rowStep * distance;

    if (nextColumn < 0 || nextColumn >= GRID_SIZE || nextRow < 0 || nextRow >= GRID_SIZE) {
      break;
    }

    indexes.push(nextRow * GRID_SIZE + nextColumn);
  }

  return indexes;
}

/**
 * Shared engine for the Torpedo (horizontal), Rocket (vertical), and
 * Harpoon (diagonal): launches at cellIndex, then always travels exactly
 * WEAPON_TRAVEL_DISTANCE further cells along axis (see
 * getWeaponTravelIndexes), regardless of whether the launch cell (or any
 * cell along the way) was a hit. Cells that are already targeted (miss,
 * hit, or sunk) are passed over untouched, an untargeted empty cell is
 * silently marked targeted (no sound), and every untargeted occupied cell
 * in the run detonates (standard hit, including oil-ignition odds) - so a
 * single shot can hit more than one ship. Running off the edge of the
 * board just ends the run early.
 */
function fireTravelingWeapon(navy: NavyState, cellIndex: number, axis: WeaponTravelAxis): WeaponTravelResult {
  const launchWithTargetedCell = setCellState(navy, cellIndex, { effect: 'targeted', targeting: false });
  const launchResult = resolveTargetingSequence(launchWithTargetedCell, [cellIndex]);

  const steps: WeaponTravelStep[] = [
    {
      cellIndex,
      navy: launchResult.navy,
      isHit: navy.cells[cellIndex].occupied,
      audioSequence: launchResult.audioSequence,
      ignited: launchResult.ignited,
      ignitedCellIndexes: launchResult.ignitedCellIndexes,
    },
  ];

  let currentNavy = launchResult.navy;

  for (const nextIndex of getWeaponTravelIndexes(cellIndex, axis)) {
    const candidateCell = currentNavy.cells[nextIndex];

    if (candidateCell.effect === 'untargeted' && candidateCell.occupied) {
      const preparedNavy = setCellState(currentNavy, nextIndex, { effect: 'targeted', targeting: false });
      const hitResult = resolveTargetingSequence(preparedNavy, [nextIndex]);
      currentNavy = hitResult.navy;

      steps.push({
        cellIndex: nextIndex,
        navy: currentNavy,
        isHit: true,
        audioSequence: hitResult.audioSequence,
        ignited: hitResult.ignited,
        ignitedCellIndexes: hitResult.ignitedCellIndexes,
      });

      continue;
    }

    if (candidateCell.effect === 'untargeted') {
      currentNavy = setCellState(currentNavy, nextIndex, { effect: 'targeted', targeting: false });
    }

    steps.push({
      cellIndex: nextIndex,
      navy: currentNavy,
      isHit: false,
      audioSequence: [],
    });
  }

  return { steps };
}

/** Travels horizontally: rightward from columns 0-4, leftward from columns 5-9. */
export function fireTorpedo(navy: NavyState, cellIndex: number): WeaponTravelResult {
  return fireTravelingWeapon(navy, cellIndex, 'horizontal');
}

/** Travels vertically: downward from rows 0-4, upward from rows 5-9. */
export function fireRocket(navy: NavyState, cellIndex: number): WeaponTravelResult {
  return fireTravelingWeapon(navy, cellIndex, 'vertical');
}

/**
 * Travels diagonally: which of the four diagonal directions depends on
 * the launch cell's quadrant (see getWeaponTravelIndexes) - down-right
 * from the top-left quadrant, up-left from the bottom-right, down-left
 * from the top-right, up-right from the bottom-left.
 */
export function fireHarpoon(navy: NavyState, cellIndex: number): WeaponTravelResult {
  return fireTravelingWeapon(navy, cellIndex, 'diagonal');
}

/**
 * The cell itself plus every cell within Manhattan distance 2 of it (a
 * 13-cell diamond at most), clipped at grid edges - one ring larger in
 * every direction than the 5-cell orthogonal-only diamond (distance <= 1)
 * would give.
 */
export function getDroneRevealIndexes(cellIndex: number): number[] {
  const x = cellIndex % GRID_SIZE;
  const y = Math.floor(cellIndex / GRID_SIZE);
  const indexes: number[] = [];

  for (let deltaY = -2; deltaY <= 2; deltaY += 1) {
    for (let deltaX = -2; deltaX <= 2; deltaX += 1) {
      if (Math.abs(deltaX) + Math.abs(deltaY) > 2) {
        continue;
      }

      const nextX = x + deltaX;
      const nextY = y + deltaY;

      if (nextX >= 0 && nextX < GRID_SIZE && nextY >= 0 && nextY < GRID_SIZE) {
        indexes.push(nextY * GRID_SIZE + nextX);
      }
    }
  }

  return indexes;
}

export type DroneResult = {
  navy: NavyState;
  /** Cells actually newly revealed by this shot - a subset of getDroneRevealIndexes(cellIndex), excluding anything already targeted or previously revealed. */
  revealedIndexes: number[];
};

/**
 * Reveals the fog of war on cellIndex's diamond footprint (see
 * getDroneRevealIndexes) without targeting any of it - an untargeted
 * cell's true content (ship or empty water) becomes visible, but stays
 * fully untargeted, unlike every other weapon. No hit, no miss, no sound,
 * no ignition risk - nothing is actually being fired at, just looked at.
 * Cells already targeted, or already Drone-revealed, are left untouched.
 * Still costs one charge and one quota dot up front regardless of how many
 * (if any) of the footprint's cells were newly revealed, same as every
 * other weapon.
 *
 * Marks every newly-revealed cell's own droneRevealed flag (see CellState)
 * - this is the field getRevealedTargetIndexes() checks, not exposure.
 * Exposure is still bumped from 'unknown' to 'known' where it actually was
 * 'unknown' (this is what visually lifts the fog for whoever's looking at
 * this navy, e.g. the player firing a Drone at the enemy), but that step
 * is a no-op on a side's own fleet, whose exposure is already 'known'
 * everywhere from creation - droneRevealed is what still correctly records
 * the reveal in that case. Never touches 'revealed', which is reserved for
 * revealUntargetedShips()'s distinct end-of-game green (see
 * getCellPresentation() in Index.tsx).
 */
export function fireDrone(navy: NavyState, cellIndex: number): DroneResult {
  const revealedIndexes = getDroneRevealIndexes(cellIndex).filter(
    (index) => navy.cells[index]?.effect === 'untargeted' && !navy.cells[index]?.droneRevealed,
  );

  const revealedNavy = revealedIndexes.reduce((currentNavy, index) => {
    const cell = currentNavy.cells[index];
    return setCellState(currentNavy, index, {
      droneRevealed: true,
      exposure: cell.exposure === 'unknown' ? 'known' : cell.exposure,
    });
  }, navy);

  // The press-and-hold preview highlight set on the launch cell (see
  // handleEnemyCellPressStart) needs clearing here regardless of whether
  // that cell ended up in revealedIndexes above - every other weapon
  // clears this as part of marking its target cell(s) 'targeted', but the
  // Drone never targets anything, so nothing else would ever clear it
  // (and the launch cell may already have been droneRevealed by an
  // earlier, overlapping Drone shot, which would exclude it above).
  const nextNavy = setCellState(revealedNavy, cellIndex, { targeting: false });

  return { navy: nextNavy, revealedIndexes };
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

/**
 * Cells this side's own Drone has revealed as occupied but not yet
 * targeted - a confirmed ship location, no guessing required. Checked via
 * the cell's own droneRevealed flag, never exposure: exposure is already
 * 'known' everywhere on a side's own fleet regardless of any Drone use
 * (see CellState's droneRevealed doc comment), so it can't distinguish
 * "found by a Drone" from "was always visible to its owner" - droneRevealed
 * can.
 */
export function getRevealedTargetIndexes(navy: NavyState): number[] {
  return navy.cells.reduce<number[]>((indexes, cell, index) => {
    if (cell.effect === 'untargeted' && cell.occupied && cell.droneRevealed) {
      indexes.push(index);
    }
    return indexes;
  }, []);
}

export function selectAppTargetIndex(navy: NavyState): number | null {
  const untargetedIndexes = navy.cells.reduce<number[]>((indexes, cell, index) => {
    if (cell.effect === 'untargeted') {
      indexes.push(index);
    }
    return indexes;
  }, []);

  if (untargetedIndexes.length === 0) {
    return null;
  }

  // A Drone reveal means a ship's location is already known outright, no
  // deduction needed - this outranks the hunt logic below.
  const revealedIndexes = getRevealedTargetIndexes(navy);
  if (revealedIndexes.length > 0) {
    return randomItem(revealedIndexes);
  }

  const candidateIndexes = new Set<number>();
  const hitIndexesByShipCode = new Map<string, number[]>();

  navy.cells.forEach((cell, index) => {
    if (cell.effect !== 'targeted' || !cell.occupied || !cell.shipCode) {
      return;
    }

    const isPartOfSunkShip = navy.cells
      .filter((candidateCell) => candidateCell.shipCode === cell.shipCode)
      .every((candidateCell) => candidateCell.effect === 'sunk');

    if (isPartOfSunkShip) {
      return;
    }

    const hitIndexes = hitIndexesByShipCode.get(cell.shipCode) ?? [];
    hitIndexes.push(index);
    hitIndexesByShipCode.set(cell.shipCode, hitIndexes);
  });

  hitIndexesByShipCode.forEach((hitIndexes, shipCode) => {
    // Two or more confirmed hits on the same ship mean the whole ship's
    // position is known - it's a straight line, so target its own
    // remaining cells directly instead of guessing via 8-neighbor
    // adjacency, which would waste shots perpendicular to the ship's
    // actual line. A single hit isn't enough to know the line yet, so
    // that case still falls through to plain adjacency below.
    if (hitIndexes.length >= 2) {
      const ship = navy.ships.find((candidateShip) => candidateShip.code === shipCode);

      ship?.cells.forEach((point) => {
        const cellIndex = point.y * GRID_SIZE + point.x;
        if (navy.cells[cellIndex]?.effect === 'untargeted') {
          candidateIndexes.add(cellIndex);
        }
      });

      return;
    }

    hitIndexes.forEach((index) => {
      getAdjacentIndexes(index).forEach((adjacentIndex) => {
        if (navy.cells[adjacentIndex]?.effect === 'untargeted') {
          candidateIndexes.add(adjacentIndex);
        }
      });
    });
  });

  if (candidateIndexes.size > 0) {
    return randomItem(Array.from(candidateIndexes));
  }

  return randomItem(untargetedIndexes);
}

/**
 * The cells a weapon would affect if fired at cellIndex, for the purpose of
 * picking the most efficient target - not the same thing as what actually
 * gets processed when it's fired. MOAB and Mine share the same 8-adjacent-
 * cells footprint (a Mine isn't an instant blast, but placing it where more
 * neighbors are still untargeted maximizes its odds of a wander-hit later).
 * Torpedo, Rocket, and Harpoon use the cells they'd travel through. Drone
 * uses its own smaller diamond reveal footprint (see getDroneRevealIndexes).
 */
export function getWeaponBlastZoneIndexes(cellIndex: number, weapon: WeaponType): number[] {
  if (weapon === 'moab' || weapon === 'mine') {
    return getAdjacentIndexes(cellIndex);
  }

  if (weapon === 'drone') {
    return getDroneRevealIndexes(cellIndex);
  }

  const axis: WeaponTravelAxis = weapon === 'torpedo' ? 'horizontal' : weapon === 'rocket' ? 'vertical' : 'diagonal';
  return getWeaponTravelIndexes(cellIndex, axis);
}

/**
 * Picks the most efficient cell to fire weapon at: whichever untargeted
 * cell(s) have the most still-untargeted cells in their blast zone (see
 * getWeaponBlastZoneIndexes), breaking ties randomly. Called whenever the
 * computer has chosen to fire a weapon, in place of selectAppTargetIndex.
 */
export function selectAppWeaponTargetIndex(navy: NavyState, weapon: WeaponType): number | null {
  const untargetedIndexes = navy.cells.reduce<number[]>((indexes, cell, index) => {
    if (cell.effect === 'untargeted') {
      indexes.push(index);
    }
    return indexes;
  }, []);

  if (untargetedIndexes.length === 0) {
    return null;
  }

  let bestIndexes: number[] = [];
  let bestBlastZoneSize = -1;

  untargetedIndexes.forEach((index) => {
    const blastZoneSize = getWeaponBlastZoneIndexes(index, weapon).filter(
      (candidateIndex) => navy.cells[candidateIndex]?.effect === 'untargeted',
    ).length;

    if (blastZoneSize > bestBlastZoneSize) {
      bestBlastZoneSize = blastZoneSize;
      bestIndexes = [index];
    } else if (blastZoneSize === bestBlastZoneSize) {
      bestIndexes.push(index);
    }
  });

  return randomItem(bestIndexes);
}

export function selectAppWeaponChoice(options: {
  appWeaponsUsed: number;
  activeWeaponTypes: WeaponType[];
  appMoabCount: number;
  appMineCount: number;
  appMineIndex: number | null;
  appTorpedoCount: number;
  appRocketCount: number;
  appHarpoonCount: number;
  appDroneCount: number;
}): WeaponType | null {
  if (options.appWeaponsUsed >= SPECIAL_WEAPON_QUOTA) {
    return null;
  }

  if (Math.random() >= APP_WEAPON_USE_CHANCE) {
    return null;
  }

  const countsByType: Record<WeaponType, number> = {
    moab: options.appMoabCount,
    mine: options.appMineCount,
    torpedo: options.appTorpedoCount,
    rocket: options.appRocketCount,
    harpoon: options.appHarpoonCount,
    drone: options.appDroneCount,
  };

  const availableWeapons = options.activeWeaponTypes.filter((weapon) => {
    if (countsByType[weapon] <= 0) {
      return false;
    }

    return weapon !== 'mine' || options.appMineIndex === null;
  });

  if (availableWeapons.length === 0) {
    return null;
  }

  // MOAB gets a soft priority over the uniform pool below, rather than
  // being guaranteed - strong enough that both MOAB charges reliably get
  // used somewhere in the game, without making the computer's first two
  // shots predictably MOAB every time.
  if (availableWeapons.includes('moab') && Math.random() < APP_MOAB_PRIORITY_CHANCE) {
    return 'moab';
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
    appTorpedoCount: APP_TORPEDO_STARTING_COUNT,
    appRocketCount: APP_ROCKET_STARTING_COUNT,
    appHarpoonCount: APP_HARPOON_STARTING_COUNT,
    appDroneCount: APP_DRONE_STARTING_COUNT,
    appWeaponsUsed: 0,
    playerMineIndex: null,
    appMineIndex: null,
    activeWeaponTypes: pickActiveWeaponTypes(),
    playerWeaponUseCounts: Object.fromEntries(ALL_WEAPON_TYPES.map((type) => [type, 0])) as Record<WeaponType, number>,
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

/**
 * Picks ACTIVE_WEAPON_TYPE_COUNT distinct weapon types at random out of
 * ALL_WEAPON_TYPES, then re-sorts them back into ALL_WEAPON_TYPES's own
 * canonical order - so which 3 types show up is random, but their
 * left-to-right order in the weapons bar stays stable and predictable
 * game to game, rather than visually shuffling around.
 */
function pickActiveWeaponTypes(): WeaponType[] {
  const remaining = [...ALL_WEAPON_TYPES];
  const picked: WeaponType[] = [];

  while (picked.length < ACTIVE_WEAPON_TYPE_COUNT && remaining.length > 0) {
    const [chosen] = remaining.splice(randomInt(0, remaining.length - 1), 1);
    picked.push(chosen);
  }

  return ALL_WEAPON_TYPES.filter((type) => picked.includes(type));
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

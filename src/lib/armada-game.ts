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
   * True once this specific cell has been revealed without being damaged -
   * either a Drone shot found it (fireDrone), or a weapon that can't harm
   * this ship found it anyway (exposeCellWithoutDamage - see
   * isShipImmuneToWeapon). Deliberately separate from exposure: a navy
   * created with known=true (a side's own fleet, see createNavy) starts
   * every cell at exposure 'known' regardless of any of the above, since
   * there's no fog of war over your own ships - so exposure alone can't
   * tell "genuinely revealed by one of these" apart from "just always
   * visible to its owner." This field is only ever set by those two paths,
   * so it's unambiguous either way, regardless of which one set it.
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
  /** Total turns the player has taken this game (every weapon type, Drone included, plus a plain shot - see applyShotOutcome). Feeds the Quickest Win record. */
  playerTurnsTaken: number;
  /** Mirrors playerTurnsTaken for the computer. Feeds the Quickest Loss record. */
  appTurnsTaken: number;
  /** The player's current run of consecutive damage-dealing turns - see ShotOutcome/applyShotOutcome for exactly what counts. Resets to 0 on a miss; untouched by a turn that doesn't count toward the streak at all (a Drone, or a Mine dropped on empty water). */
  playerCurrentHitStreak: number;
  /** The highest playerCurrentHitStreak has reached at any point this game - not necessarily where it stands now, since it can fall back after a later miss. Feeds the Longest Hit Streak (You) record. */
  playerHitStreakPeak: number;
  /** Mirrors playerCurrentHitStreak for the computer. */
  appCurrentHitStreak: number;
  /** Mirrors playerHitStreakPeak for the computer. Feeds the Longest Hit Streak (Computer) record. */
  appHitStreakPeak: number;
  /** The largest single oil-slick chain reaction (see resolveTargetingSequence's own ignited/ignitedCellIndexes) triggered by the player this game, whether from a direct shot/weapon or their own mine's passive wander. Feeds the Biggest Oil Detonation (You) record. */
  playerOilDetonationPeak: number;
  /** Mirrors playerOilDetonationPeak for the computer. Feeds the Biggest Oil Detonation (Computer) record. */
  appOilDetonationPeak: number;
};

export type AudioCue = 'splash' | 'sink' | 'lifeboat' | 'ensign' | 'helicopter' | 'explosion' | 'wingame' | 'deflect';
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

/**
 * What one turn's chosen action actually accomplished, for the Hit Streak
 * and Oil Detonation statistics (see GAME_DESIGN.md's Statistics section) -
 * derived after the fact from a TargetingResult/WeaponTravelResult, not
 * threaded through the targeting engine itself.
 */
export type ShotOutcome = {
  /** Real damage dealt to at least one occupied, non-immune cell this turn - an exposure without damage (see exposeCellWithoutDamage) never counts on its own. */
  dealtDamage: boolean;
  /**
   * False for a Drone (never deals damage - see isShipImmuneToWeapon's own
   * doc comment) and for a Mine dropped on empty water (still armed and
   * pending until its passive wander eventually connects or not - see
   * moveMine): these are excluded from the hit-streak sequence entirely
   * rather than counted as a miss, so neither ever costs a streak in
   * progress. Every other weapon, and a Mine that lands on any occupied
   * cell (hit or immune), fully resolves this turn and always counts.
   */
  countsTowardHitStreak: boolean;
  /** Size of the oil-slick chain reaction this action triggered, 0 if none. */
  oilDetonationSize: number;
};

/** A Drone can never deal damage or ignite anything, and is excluded from the hit streak entirely - see ShotOutcome. */
export const DRONE_SHOT_OUTCOME: ShotOutcome = { dealtDamage: false, countsTowardHitStreak: false, oilDetonationSize: 0 };

/** Derives a ShotOutcome from a fireMoab/resolveMineHit/plain-shot result - anything built on a single TargetingResult plus the cell(s) it actually tried to target (as opposed to merely exposed - see targetIndexes on each of those). */
export function shotOutcomeFromTargetingResult(
  result: TargetingResult,
  targetIndexes: number[],
  countsTowardHitStreak: boolean,
): ShotOutcome {
  return {
    dealtDamage: targetIndexes.some((index) => result.navy.cells[index]?.occupied),
    countsTowardHitStreak,
    oilDetonationSize: result.ignited && result.ignitedCellIndexes ? result.ignitedCellIndexes.length : 0,
  };
}

/** Derives a ShotOutcome from a fireTorpedo/fireRocket/fireHarpoon result - a hit anywhere along the run counts as a hit for the whole turn, and the biggest single ignition among its steps (never their sum) is what could set an Oil Detonation record. */
export function shotOutcomeFromTravelSteps(steps: WeaponTravelStep[]): ShotOutcome {
  return {
    dealtDamage: steps.some((step) => step.isHit),
    countsTowardHitStreak: true,
    oilDetonationSize: steps.reduce(
      (peak, step) => Math.max(peak, step.ignited && step.ignitedCellIndexes ? step.ignitedCellIndexes.length : 0),
      0,
    ),
  };
}

/**
 * Folds one turn's ShotOutcome into its side's running stats: increments
 * turns taken (every turn, regardless of countsTowardHitStreak - a Drone
 * turn still counts as a turn for Quickest Win/Loss purposes, just not for
 * the hit streak), advances or resets the hit streak, and raises either
 * peak if this turn set a new in-game high. A turn excluded from the hit
 * streak (countsTowardHitStreak: false) leaves the current streak
 * untouched rather than resetting it.
 */
export function applyShotOutcome(state: GameState, side: TurnOwner, outcome: ShotOutcome): GameState {
  const isPlayer = side === 'player';
  const currentStreak = isPlayer ? state.playerCurrentHitStreak : state.appCurrentHitStreak;
  const nextStreak = !outcome.countsTowardHitStreak
    ? currentStreak
    : outcome.dealtDamage
      ? currentStreak + 1
      : 0;
  const streakPeak = isPlayer ? state.playerHitStreakPeak : state.appHitStreakPeak;
  const oilPeak = isPlayer ? state.playerOilDetonationPeak : state.appOilDetonationPeak;
  const nextOilPeak = Math.max(oilPeak, outcome.oilDetonationSize);

  return {
    ...state,
    ...(isPlayer
      ? {
          playerTurnsTaken: state.playerTurnsTaken + 1,
          playerCurrentHitStreak: nextStreak,
          playerHitStreakPeak: Math.max(streakPeak, nextStreak),
          playerOilDetonationPeak: nextOilPeak,
        }
      : {
          appTurnsTaken: state.appTurnsTaken + 1,
          appCurrentHitStreak: nextStreak,
          appHitStreakPeak: Math.max(streakPeak, nextStreak),
          appOilDetonationPeak: nextOilPeak,
        }),
  };
}

/** A mine's own passive wander (see moveMine) never counts toward the hit streak, but a chain reaction it triggers can still set an Oil Detonation record - this folds just that in, leaving turnsTaken/hit-streak fields untouched since the wander isn't itself a turn. */
export function applyMineWanderOilDetonation(state: GameState, side: TurnOwner, oilDetonationSize: number): GameState {
  if (oilDetonationSize <= 0) {
    return state;
  }

  return side === 'player'
    ? { ...state, playerOilDetonationPeak: Math.max(state.playerOilDetonationPeak, oilDetonationSize) }
    : { ...state, appOilDetonationPeak: Math.max(state.appOilDetonationPeak, oilDetonationSize) };
}

/**
 * Where a freshly-dropped Mine ends up the instant it's placed: consumed
 * (reverting to whatever the pre-existing active mine's own index already
 * was, often null) if this drop actually detonated, or planted live right
 * at the drop cell otherwise - whether because the cell was empty water, or
 * because it hit a ship the Mine is immune to (exposed, not destroyed - see
 * isShipImmuneToWeapon). The distinction has to be ShotOutcome.dealtDamage,
 * not raw cell occupancy: a ship that survives the drop leaves the mine
 * live and visible on its cell, not gone, even though the cell itself is
 * occupied.
 */
export function resolveMineIndexAfterDrop(shotOutcome: ShotOutcome, previousMineIndex: number | null, dropIndex: number): number | null {
  return shotOutcome.dealtDamage ? previousMineIndex : dropIndex;
}

export const GRID_SIZE = 10;
export const GAME_STATE_VERSION = 20;
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
  // Reuses Splash.wav under its own cue name rather than a new asset - see
  // the "deflect" cue's own doc comment on AudioCue-adjacent call sites
  // (isShipImmuneToWeapon) for why this needs to be a distinct cue rather
  // than just reusing 'splash' itself: 'splash' is deliberately dropped from
  // a MOAB's own sequence (see playMoabSequence in Index.tsx) so the per-cell
  // miss sound doesn't compete with the MOAB's own double-boom, and that
  // same suppression would silently swallow a MOAB's immune-ship exposure
  // too if it used the same cue name.
  deflect: `${import.meta.env.BASE_URL}audio/Splash.wav`,
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

// Some ships can't be damaged by certain weapon types - a small
// (Ensign/Lifeboat-scale), airborne (Helicopter), or submerged (Submarine)
// target that a given weapon's mechanic just can't harm. A weapon that
// finds one of these anyway still exposes it (see exposeCellWithoutDamage)
// rather than passing over it as if nothing were there - the ship becomes
// visible and fair game for a plain shot or a non-immune weapon, it just
// isn't the thing that gets to sink it. Keyed by weapon since that's how
// every call site already knows which check to make; MOAB, Mine, and the
// travelling weapons (Torpedo/Rocket/Harpoon) are the only ones capable of
// damaging a cell in the first place, so Drone has no entry here (it never
// damages anything, immune ship or not).
const WEAPON_IMMUNE_SHIP_CODES: Partial<Record<WeaponType, string[]>> = {
  moab: ['S'],
  mine: ['E', 'H'],
  torpedo: ['E', 'H'],
  rocket: ['E', 'S'],
  harpoon: ['E', 'H'],
};

function isShipImmuneToWeapon(shipCode: string | undefined, weapon: WeaponType): boolean {
  return Boolean(shipCode) && (WEAPON_IMMUNE_SHIP_CODES[weapon]?.includes(shipCode as string) ?? false);
}

/**
 * Marks cellIndex visible without marking it targeted - used when a weapon
 * finds a ship it's immune to (see isShipImmuneToWeapon): the cell becomes
 * visible, but effect stays 'untargeted' so it's still fully vulnerable to
 * a plain shot or a weapon type that isn't immune to it. Mirrors fireDrone's
 * own per-cell reveal exactly - bumps exposure from 'unknown' to 'known'
 * where it actually was 'unknown', and sets droneRevealed so the same
 * AI-priority targeting (getRevealedTargetIndexes) and green UI tint a
 * Drone reveal gets also applies here; both mean the same thing to the rest
 * of the game, "a confirmed, cost-free future target," regardless of which
 * of the two actually found it. A raw cell update, not routed through
 * resolveTargetingSequence - like a Drone reveal, it can never itself tick
 * the oil slick or risk ignition. Callers that need the turn's own oil-tick
 * still get it by calling resolveTargetingSequence with this cell excluded
 * from its target list, rather than skipping that call outright.
 *
 * Deliberately silent itself - callers decide whether the moment needs a
 * sound. A Drone reveal (fireDrone) and a Mine's own passive wander
 * (moveMine) stay fully silent, since both are cost-free background events,
 * not something the player actively fired this turn. But when the player
 * (or the computer) actually fires a real weapon - MOAB, a direct Mine
 * drop, or a Torpedo/Rocket/Harpoon launch or mid-flight pass - straight at
 * an immune ship, total silence reads as "nothing happened, is this
 * broken?" rather than "the game blocked this on purpose." Those call
 * sites add the 'deflect' cue themselves alongside this call, giving that
 * moment its own distinct, audible "that didn't work" beat without
 * touching the immunity rule itself.
 */
function exposeCellWithoutDamage(navy: NavyState, cellIndex: number): NavyState {
  const cell = navy.cells[cellIndex];
  return setCellState(navy, cellIndex, {
    droneRevealed: true,
    exposure: cell.exposure === 'unknown' ? 'known' : cell.exposure,
    // Clears the press-and-hold preview highlight when this is the cell the
    // player actually pressed (MOAB/Mine fired directly at an immune ship,
    // or a travelling weapon's launch cell) - every other targeting path
    // already clears this as part of marking its cell 'targeted', but this
    // path never sets 'targeted' at all, so nothing else would. A no-op
    // for any other exposed cell, which was never true to begin with.
    targeting: false,
  });
}

/**
 * Appends the 'deflect' cue (see exposeCellWithoutDamage's own doc comment)
 * to an already-resolved audioSequence, if this shot's targeting actually
 * exposed an immune ship rather than damaging it - a no-op otherwise.
 * Shared by every call site that fires a real weapon (as opposed to a
 * Drone reveal or a Mine's passive wander, which stay silent).
 */
function withDeflectCue(audioSequence: AudioSequence, exposedImmuneShip: boolean): AudioSequence {
  return exposedImmuneShip ? [...audioSequence, 'deflect'] : audioSequence;
}

/** The cell itself plus its up-to-8 neighbors, clipped at grid edges - so a
 * corner cell yields only 4 total, not 9. */
export function getMoabTargetIndexes(cellIndex: number): number[] {
  return [cellIndex, ...getAdjacentIndexes(cellIndex)];
}

export function fireMoab(navy: NavyState, cellIndex: number): TargetingResult {
  const untargetedFootprint = getMoabTargetIndexes(cellIndex).filter(
    (index) => navy.cells[index]?.effect === 'untargeted',
  );
  const targetIndexes = untargetedFootprint.filter(
    (index) => !isShipImmuneToWeapon(navy.cells[index]?.shipCode, 'moab'),
  );
  const exposedIndexes = untargetedFootprint.filter(
    (index) => isShipImmuneToWeapon(navy.cells[index]?.shipCode, 'moab'),
  );

  const targetedNavy = targetIndexes.reduce(
    (currentNavy, index) => setCellState(currentNavy, index, { effect: 'targeted', targeting: false }),
    navy,
  );
  const preparedNavy = exposedIndexes.reduce(
    (currentNavy, index) => exposeCellWithoutDamage(currentNavy, index),
    targetedNavy,
  );

  const result = resolveTargetingSequence(preparedNavy, targetIndexes);

  return {
    ...result,
    audioSequence: withDeflectCue(result.audioSequence, exposedIndexes.length > 0),
    targetedIndexes: targetIndexes,
  };
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
 *
 * If the impact cell belongs to a ship immune to the Mine (see
 * isShipImmuneToWeapon - currently the Ensign and Helicopter), it's
 * exposed instead of detonated: since both are single-cell ships there's
 * never a same-ship bonus cell to worry about here, so this short-circuits
 * before even calling findNearestUntargetedShipCell.
 */
export function resolveMineHit(navy: NavyState, cellIndex: number): TargetingResult {
  const impactCell = navy.cells[cellIndex];

  if (impactCell?.occupied && isShipImmuneToWeapon(impactCell.shipCode, 'mine')) {
    const exposedNavy = exposeCellWithoutDamage(navy, cellIndex);
    const result = resolveTargetingSequence(exposedNavy, []);

    return { ...result, audioSequence: withDeflectCue(result.audioSequence, true), targetedIndexes: [] };
  }

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
 * the new cell is both untargeted, occupied, and not a ship the Mine is
 * immune to (see isShipImmuneToWeapon - the Ensign and Helicopter): drifting
 * onto one of those instead exposes it, same as resolveMineHit's own
 * immune branch, except this stays a raw cell update rather than routing
 * through resolveTargetingSequence - like the silent empty-water reveal
 * below, a passive wander step never ticks the oil slick itself, since
 * whatever action the player actually took this turn already got its own
 * tick. Otherwise - an untargeted empty cell, or any already-targeted cell -
 * it's not a hit, but if the cell was still untargeted, it's silently
 * marked targeted anyway (no sound, no ignition risk): the mine quietly
 * confirms there's nothing there, so the player doesn't have to spend a
 * shot finding that out themselves.
 */
export function moveMine(navy: NavyState, mineIndex: number): MineMoveResult {
  const newIndex = selectMineWanderIndex(navy, mineIndex);
  const candidateCell = navy.cells[newIndex];

  if (candidateCell.effect === 'untargeted' && candidateCell.occupied && isShipImmuneToWeapon(candidateCell.shipCode, 'mine')) {
    return {
      navy: exposeCellWithoutDamage(navy, newIndex),
      mineIndex: newIndex,
      hit: false,
      audioSequence: [],
    };
  }

  if (candidateCell.effect === 'untargeted' && candidateCell.occupied) {
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

  const nextNavy = candidateCell.effect === 'untargeted'
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
 * single shot can hit more than one ship. An untargeted occupied cell whose
 * ship is immune to weapon (see isShipImmuneToWeapon) is exposed instead of
 * detonated - visible afterward, but left untargeted and passed over the
 * same as an empty cell, rather than ending the run or counting as a hit -
 * except that step's audioSequence still gets the 'deflect' cue (see
 * exposeCellWithoutDamage), whether it's the launch cell itself or one the
 * weapon merely crosses in flight, so a real weapon shrugged off by an
 * immune ship never resolves in total silence. Running off the edge of the
 * board just ends the run early.
 */
function fireTravelingWeapon(navy: NavyState, cellIndex: number, axis: WeaponTravelAxis, weapon: WeaponType): WeaponTravelResult {
  const launchCell = navy.cells[cellIndex];
  const launchIsImmune = launchCell.occupied && isShipImmuneToWeapon(launchCell.shipCode, weapon);

  const launchNavy = launchIsImmune
    ? exposeCellWithoutDamage(navy, cellIndex)
    : setCellState(navy, cellIndex, { effect: 'targeted', targeting: false });
  const launchResult = resolveTargetingSequence(launchNavy, launchIsImmune ? [] : [cellIndex]);

  const steps: WeaponTravelStep[] = [
    {
      cellIndex,
      navy: launchResult.navy,
      isHit: !launchIsImmune && launchCell.occupied,
      audioSequence: withDeflectCue(launchResult.audioSequence, launchIsImmune),
      ignited: launchResult.ignited,
      ignitedCellIndexes: launchResult.ignitedCellIndexes,
    },
  ];

  let currentNavy = launchResult.navy;

  for (const nextIndex of getWeaponTravelIndexes(cellIndex, axis)) {
    const candidateCell = currentNavy.cells[nextIndex];

    if (candidateCell.effect === 'untargeted' && candidateCell.occupied && isShipImmuneToWeapon(candidateCell.shipCode, weapon)) {
      currentNavy = exposeCellWithoutDamage(currentNavy, nextIndex);

      steps.push({
        cellIndex: nextIndex,
        navy: currentNavy,
        isHit: false,
        audioSequence: withDeflectCue([], true),
      });

      continue;
    }

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
  return fireTravelingWeapon(navy, cellIndex, 'horizontal', 'torpedo');
}

/** Travels vertically: downward from rows 0-4, upward from rows 5-9. */
export function fireRocket(navy: NavyState, cellIndex: number): WeaponTravelResult {
  return fireTravelingWeapon(navy, cellIndex, 'vertical', 'rocket');
}

/**
 * Travels diagonally: which of the four diagonal directions depends on
 * the launch cell's quadrant (see getWeaponTravelIndexes) - down-right
 * from the top-left quadrant, up-left from the bottom-right, down-left
 * from the top-right, up-right from the bottom-left.
 */
export function fireHarpoon(navy: NavyState, cellIndex: number): WeaponTravelResult {
  return fireTravelingWeapon(navy, cellIndex, 'diagonal', 'harpoon');
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

  const revealedNavy = revealedIndexes.reduce(
    (currentNavy, index) => exposeCellWithoutDamage(currentNavy, index),
    navy,
  );

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
 * Cells this side has revealed without damaging - occupied but not yet
 * targeted, whether a Drone found them or a weapon immune to that ship
 * found them anyway (see CellState's droneRevealed doc comment) - a
 * confirmed ship location, no guessing required. Checked via the cell's
 * own droneRevealed flag, never exposure: exposure is already 'known'
 * everywhere on a side's own fleet regardless of any of that, so it can't
 * distinguish "found this way" from "was always visible to its owner" -
 * droneRevealed can.
 */
export function getRevealedTargetIndexes(navy: NavyState): number[] {
  return navy.cells.reduce<number[]>((indexes, cell, index) => {
    if (cell.effect === 'untargeted' && cell.occupied && cell.droneRevealed) {
      indexes.push(index);
    }
    return indexes;
  }, []);
}

/**
 * True once every still-unsunk ship has taken at least one hit - i.e.
 * nothing left on the board is still sitting completely undiscovered.
 * Used to decide whether a known hunt target may override oil-slick
 * avoidance (see selectAppTargetIndex): while some ship remains entirely
 * unfound, it could still be hiding in the very "outside" territory the
 * slick-avoidance logic is trying to explore, so a different, already-
 * wounded ship's oil-covered remaining cell isn't worth abandoning that
 * search for. Only once nothing is left to discover does chasing a known
 * lead - oil or not - stop trading away any exploration value.
 */
function haveFoundAllRemainingShips(navy: NavyState): boolean {
  const cellsByShipCode = new Map<string, CellState[]>();

  navy.cells.forEach((cell) => {
    if (!cell.occupied || !cell.shipCode) {
      return;
    }

    const cells = cellsByShipCode.get(cell.shipCode) ?? [];
    cells.push(cell);
    cellsByShipCode.set(cell.shipCode, cells);
  });

  for (const cells of cellsByShipCode.values()) {
    const isSunk = cells.every((cell) => cell.effect === 'sunk');
    const hasAnyHit = cells.some((cell) => cell.effect !== 'untargeted');

    if (!isSunk && !hasAnyHit) {
      return false;
    }
  }

  return true;
}

/**
 * Cells worth targeting next because they're adjacent to (or, with 2+ hits,
 * in the same straight line as) an existing hit on a ship that isn't fully
 * sunk yet. shipCode narrows this to one specific ship (used for the Oil
 * Tanker priority below); omitted, it considers every wounded ship at
 * once (the general hunt, used once the Oil Tanker itself is sunk).
 */
function getHuntCandidateIndexes(navy: NavyState, shipCode?: string): number[] {
  const candidateIndexes = new Set<number>();
  const hitIndexesByShipCode = new Map<string, number[]>();

  navy.cells.forEach((cell, index) => {
    if (cell.effect !== 'targeted' || !cell.occupied || !cell.shipCode) {
      return;
    }

    if (shipCode && cell.shipCode !== shipCode) {
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

  hitIndexesByShipCode.forEach((hitIndexes, hitShipCode) => {
    // Two or more confirmed hits on the same ship mean the whole ship's
    // position is known - it's a straight line, so target its own
    // remaining cells directly instead of guessing via 8-neighbor
    // adjacency, which would waste shots perpendicular to the ship's
    // actual line. A single hit isn't enough to know the line yet, so
    // that case still falls through to plain adjacency below.
    if (hitIndexes.length >= 2) {
      const ship = navy.ships.find((candidateShip) => candidateShip.code === hitShipCode);

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

  return Array.from(candidateIndexes);
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

  // Finding (and then sinking) the Oil Tanker is the single top priority
  // for as long as it's still alive - see the "Oil Tanker targeting
  // priority" writeup in GAME_DESIGN.md. A revealed Oil Tanker cell is
  // itself the best possible way to find it, so that always wins
  // immediately, before anything else below.
  const revealedIndexes = getRevealedTargetIndexes(navy);
  const revealedOilTankerIndexes = revealedIndexes.filter((index) => navy.cells[index]?.shipCode === 'O');
  if (revealedOilTankerIndexes.length > 0) {
    return randomItem(revealedOilTankerIndexes);
  }

  const oilTankerCells = navy.cells.filter((cell) => cell.shipCode === 'O');
  const oilTankerFound = oilTankerCells.some((cell) => cell.effect !== 'untargeted');
  const oilTankerSunk = oilTankerCells.length > 0 && oilTankerCells.every((cell) => cell.effect === 'sunk');

  // Until at least one of its cells has been hit, the computer doesn't
  // hunt at all (plain random selection, same as it would if no ship
  // anywhere had ever been hit) - it's not trying to protect some other
  // partial hit, it's just not looking for the tanker specifically yet, so
  // nothing here should nudge it toward one. This deliberately ignores a
  // revealed cell on any *other* ship too: chasing a different ship's free
  // kill would spend a turn not spent looking for the tanker, and that
  // other ship isn't going anywhere - it'll get picked up once the tanker
  // is sunk and the slick-management phase below runs its own revealed-cell
  // check.
  if (!oilTankerFound) {
    return randomItem(untargetedIndexes);
  }

  // Found but not yet sunk: every further shot goes at the tanker
  // specifically (via the general hunt logic, restricted to just its own
  // ship code) until it's sunk, before any other wounded ship - revealed
  // or merely hit - gets a look in.
  if (!oilTankerSunk) {
    const tankerCandidateIndexes = getHuntCandidateIndexes(navy, 'O');
    return randomItem(tankerCandidateIndexes.length > 0 ? tankerCandidateIndexes : untargetedIndexes);
  }

  // The Oil Tanker is sunk - this is the "pick it up eventually" moment:
  // any other ship's revealed cell (deferred by both branches above) is
  // now fair game, and gets the same unconditional top priority a
  // revealed cell always used to have, before the slick-management logic
  // below even runs.
  if (revealedIndexes.length > 0) {
    return randomItem(revealedIndexes);
  }

  // The slick is spreading - let it grow to
  // roughly the size of everything else still unexplored before the
  // computer starts risking shots inside it (a 1-in-12 ignition chance per
  // shot - see OIL_IGNITION_ODDS). "Room to expand" is checked first so a
  // slick that's already boxed in (nowhere left to spread) never gets
  // artificially avoided forever - once it truly can't grow any bigger,
  // there's nothing left to wait for.
  const untargetedOutsideSlick = untargetedIndexes.filter((index) => !navy.cells[index]?.oil);
  const untargetedInsideSlickCount = untargetedIndexes.length - untargetedOutsideSlick.length;
  const shouldAvoidSlick = untargetedInsideSlickCount < untargetedOutsideSlick.length
    && getOilSlickSpreadCandidateIndexes(navy).length > 0;
  const eligibleIndexes = shouldAvoidSlick ? untargetedOutsideSlick : untargetedIndexes;

  const allCandidateIndexes = getHuntCandidateIndexes(navy);

  // Once nothing on the board is still completely undiscovered, a known
  // hunt target always outranks slick preservation, oil-covered or not -
  // exploring "outside" only has value while some ship might still be
  // hiding there, and with every remaining ship already found, that's no
  // longer true. Until that point, a known lead still has to compete with
  // the slick like anything else: a different, already-found ship could
  // still be waiting somewhere outside it.
  if (haveFoundAllRemainingShips(navy) && allCandidateIndexes.length > 0) {
    return randomItem(allCandidateIndexes);
  }

  const eligibleIndexSet = new Set(eligibleIndexes);
  const candidateIndexes = allCandidateIndexes.filter((index) => eligibleIndexSet.has(index));

  if (candidateIndexes.length > 0) {
    return randomItem(candidateIndexes);
  }

  return randomItem(eligibleIndexes.length > 0 ? eligibleIndexes : untargetedIndexes);
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
    playerTurnsTaken: 0,
    appTurnsTaken: 0,
    playerCurrentHitStreak: 0,
    playerHitStreakPeak: 0,
    appCurrentHitStreak: 0,
    appHitStreakPeak: 0,
    playerOilDetonationPeak: 0,
    appOilDetonationPeak: 0,
  };
}

/**
 * Lifetime records, not part of GameState - survive New Game and browser
 * restarts, same as the existing games-played/games-won counts these
 * absorb (see Index.tsx's SESSION_STATS_STORAGE_KEY). null means "not yet
 * achieved" for the four record fields that only make sense once at least
 * one win or loss has happened - 0 would be a real, meaningful value for
 * any of them (a flawless win with 0 shots is impossible, but a margin of
 * 0 - won without a single untouched cell to spare - is a real result), so
 * it can't double as the "never happened" sentinel the way it can for the
 * streak/hit-streak/oil fields below.
 */
export type SessionStats = {
  gamesPlayed: number;
  gamesWon: number;
  /** Fewest shots (turns) the player has ever taken to win a game. */
  quickestWin: number | null;
  /** Fewest shots the computer has ever taken to beat the player. */
  quickestLoss: number | null;
  /** Most of the player's own occupied cells ever left untargeted at the end of a game the player won. */
  marginOfVictory: number | null;
  /** Most of the computer's own occupied cells ever left untargeted at the end of a game the player lost. */
  marginOfDefeat: number | null;
  /** Consecutive wins right up to the most recently completed game - 0 the moment a loss happens. */
  currentWinStreak: number;
  /** The highest currentWinStreak has ever reached. */
  bestWinStreak: number;
  /**
   * Consecutive calendar days (local device time) with at least one win -
   * unlike currentWinStreak, a loss never touches this on its own; only a
   * win can change it, either extending it (won yesterday and today),
   * resetting it to 1 (the last win was 2+ days ago, or this is the first
   * win ever), or leaving it alone (already won today). See
   * computeSessionStatsUpdate for why this has to be decided lazily, at
   * the next win, rather than "expiring" the moment a day is missed.
   */
  currentDailyWinStreak: number;
  /** The highest currentDailyWinStreak has ever reached. */
  bestDailyWinStreak: number;
  /** The local calendar date (see getLocalDateString) of the most recent win, or null before any win - what currentDailyWinStreak is computed against. */
  lastWinDate: string | null;
  /** The player's own longest Hit Streak (see ShotOutcome) ever reached in a single game. */
  longestHitStreakPlayer: number;
  /** Mirrors longestHitStreakPlayer for the computer. */
  longestHitStreakApp: number;
  /** The player's own biggest single oil-slick chain reaction ever triggered in a single game. */
  biggestOilDetonationPlayer: number;
  /** Mirrors biggestOilDetonationPlayer for the computer. */
  biggestOilDetonationApp: number;
};

export const DEFAULT_SESSION_STATS: SessionStats = {
  gamesPlayed: 0,
  gamesWon: 0,
  quickestWin: null,
  quickestLoss: null,
  marginOfVictory: null,
  marginOfDefeat: null,
  currentWinStreak: 0,
  bestWinStreak: 0,
  currentDailyWinStreak: 0,
  bestDailyWinStreak: 0,
  lastWinDate: null,
  longestHitStreakPlayer: 0,
  longestHitStreakApp: 0,
  biggestOilDetonationPlayer: 0,
  biggestOilDetonationApp: 0,
};

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function countUntargetedOccupiedCells(navy: NavyState): number {
  return navy.cells.filter((cell) => cell.occupied && cell.effect === 'untargeted').length;
}

/**
 * The local (device-clock) calendar date, as 'YYYY-MM-DD' - what
 * SessionStats.lastWinDate is stored as, and what a caller passes as
 * computeSessionStatsUpdate's own "today" so the function itself stays
 * pure and testable rather than reading the clock internally. Deliberately
 * local, not UTC: "did I already win today" should match the day the
 * player's own device says it is, not some other timezone.
 */
export function getLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Both sides of this are 'YYYY-MM-DD' calendar dates (see
// getLocalDateString), which Date.parse reads as UTC midnight regardless of
// the runtime's own timezone - exactly what's needed here, since the two
// strings already encode the calendar days being compared and this only
// ever needs the whole-day difference between them, not a timezone-aware
// instant.
function daysBetweenLocalDates(from: string, to: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(to) - Date.parse(from)) / msPerDay);
}

/**
 * Folds one just-concluded game's final GameState into the running
 * SessionStats, returning both the updated stats (for the caller to
 * persist) and a plain-English list of whatever records or streaks
 * actually changed this game - exactly what the Victory/Defeat dialog
 * shows off (see GAME_DESIGN.md's Statistics section: "Wins plus any new
 * records set by this finished game, or any streak that was extended or
 * broken"). Pure and storage-agnostic - Index.tsx owns reading/writing
 * localStorage around this call.
 */
export function computeSessionStatsUpdate(
  previous: SessionStats,
  state: GameState,
  winner: Winner,
  todayLocalDate: string,
): { next: SessionStats; updates: string[] } {
  const updates: string[] = [];
  const next: SessionStats = { ...previous, gamesPlayed: previous.gamesPlayed + 1 };

  if (winner === 'player') {
    next.gamesWon = previous.gamesWon + 1;
    next.currentWinStreak = previous.currentWinStreak + 1;

    if (next.currentWinStreak > previous.bestWinStreak) {
      next.bestWinStreak = next.currentWinStreak;
      updates.push(`New record! Best Win Streak: ${next.bestWinStreak}`);
    } else {
      updates.push(`Win Streak: ${next.currentWinStreak}`);
    }

    // A loss never touches the daily streak (see SessionStats.
    // currentDailyWinStreak's own doc comment) - this whole block only
    // ever runs on a win, and only does anything at all the first time
    // that happens on a given calendar day.
    if (previous.lastWinDate !== todayLocalDate) {
      const wonYesterday = previous.lastWinDate !== null && daysBetweenLocalDates(previous.lastWinDate, todayLocalDate) === 1;
      next.currentDailyWinStreak = wonYesterday ? previous.currentDailyWinStreak + 1 : 1;
      next.lastWinDate = todayLocalDate;

      if (next.currentDailyWinStreak > previous.bestDailyWinStreak) {
        next.bestDailyWinStreak = next.currentDailyWinStreak;
        updates.push(`New record! Best Daily Win Streak: ${next.bestDailyWinStreak}`);
      } else {
        updates.push(`Daily Win Streak: ${next.currentDailyWinStreak}`);
      }
    }

    if (previous.quickestWin === null || state.playerTurnsTaken < previous.quickestWin) {
      next.quickestWin = state.playerTurnsTaken;
      updates.push(`New record! Quickest Win: ${pluralize(state.playerTurnsTaken, 'shot')}`);
    }

    const marginOfVictory = countUntargetedOccupiedCells(state.player);
    if (previous.marginOfVictory === null || marginOfVictory > previous.marginOfVictory) {
      next.marginOfVictory = marginOfVictory;
      updates.push(`New record! Margin of Victory: ${marginOfVictory}`);
    }
  } else {
    if (previous.currentWinStreak > 0) {
      updates.push(`Win Streak broken (was ${previous.currentWinStreak})`);
    }
    next.currentWinStreak = 0;

    if (previous.quickestLoss === null || state.appTurnsTaken < previous.quickestLoss) {
      next.quickestLoss = state.appTurnsTaken;
      updates.push(`New record! Quickest Loss: ${pluralize(state.appTurnsTaken, 'shot')}`);
    }

    const marginOfDefeat = countUntargetedOccupiedCells(state.enemy);
    if (previous.marginOfDefeat === null || marginOfDefeat > previous.marginOfDefeat) {
      next.marginOfDefeat = marginOfDefeat;
      updates.push(`New record! Margin of Defeat: ${marginOfDefeat}`);
    }
  }

  // Hit Streak and Oil Detonation are tracked for both sides every game,
  // regardless of who won - even in a loss, the computer setting its own
  // personal best is worth knowing about.
  if (state.playerHitStreakPeak > previous.longestHitStreakPlayer) {
    next.longestHitStreakPlayer = state.playerHitStreakPeak;
    updates.push(`New record! Your Longest Hit Streak: ${state.playerHitStreakPeak}`);
  }

  if (state.appHitStreakPeak > previous.longestHitStreakApp) {
    next.longestHitStreakApp = state.appHitStreakPeak;
    updates.push(`New record! Computer's Longest Hit Streak: ${state.appHitStreakPeak}`);
  }

  if (state.playerOilDetonationPeak > previous.biggestOilDetonationPlayer) {
    next.biggestOilDetonationPlayer = state.playerOilDetonationPeak;
    updates.push(`New record! Your Biggest Oil Detonation: ${pluralize(state.playerOilDetonationPeak, 'cell')}`);
  }

  if (state.appOilDetonationPeak > previous.biggestOilDetonationApp) {
    next.biggestOilDetonationApp = state.appOilDetonationPeak;
    updates.push(`New record! Computer's Biggest Oil Detonation: ${pluralize(state.appOilDetonationPeak, 'cell')}`);
  }

  return { next, updates };
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

/** Untargeted, not-yet-oiled cells adjacent to the slick - what spreadOilSlick() picks its next cell from. Also doubles as the "can the slick still grow?" check for selectAppTargetIndex()'s slick-management logic - non-empty means yes. */
function getOilSlickSpreadCandidateIndexes(navy: NavyState): number[] {
  return navy.cells.reduce<number[]>((indexes, cell, index) => {
    if (cell.oil || cell.effect !== 'untargeted') {
      return indexes;
    }

    const isAdjacentToOil = getAdjacentIndexes(index).some((adjacentIndex) => navy.cells[adjacentIndex]?.oil);

    if (isAdjacentToOil) {
      indexes.push(index);
    }

    return indexes;
  }, []);
}

function spreadOilSlick(navy: NavyState): NavyState {
  const candidateIndexes = getOilSlickSpreadCandidateIndexes(navy);

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

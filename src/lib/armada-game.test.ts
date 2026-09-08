import { describe, expect, it } from 'vitest';
import {
  applyMineWanderOilDetonation,
  applyShotOutcome,
  computeSessionStatsUpdate,
  createGameState,
  DEFAULT_SESSION_STATS,
  DRONE_SHOT_OUTCOME,
  fireMoab,
  fireTorpedo,
  moveMine,
  resolveMineHit,
  resolveMineIndexAfterDrop,
  selectAppTargetIndex,
  shotOutcomeFromTargetingResult,
  shotOutcomeFromTravelSteps,
  type CellState,
  type GameState,
  type NavyState,
  type PlacedShip,
  type SessionStats,
  type ShotOutcome,
  type TargetingResult,
  type WeaponTravelStep,
} from './armada-game';

function makeCell(overrides: Partial<CellState> = {}): CellState {
  return {
    exposure: 'known',
    occupied: false,
    effect: 'untargeted',
    targeting: false,
    oil: false,
    ...overrides,
  };
}

// A 100-cell navy with a straight-line Oil Tanker at row 5 (indexes 50-52)
// and a straight-line Battleship at row 8 (indexes 80-83), plus whatever
// extra per-test occupied/oil/effect cells the caller layers on. Good
// enough for selectAppTargetIndex - it only reads navy.cells and navy.ships.
function makeNavy(cellOverrides: Record<number, Partial<CellState>> = {}): NavyState {
  const cells = Array.from({ length: 100 }, () => makeCell());
  [50, 51, 52].forEach((i) => { cells[i] = makeCell({ occupied: true, shipCode: 'O' }); });
  [80, 81, 82, 83].forEach((i) => { cells[i] = makeCell({ occupied: true, shipCode: 'B' }); });

  Object.entries(cellOverrides).forEach(([indexStr, overrides]) => {
    const index = Number(indexStr);
    cells[index] = { ...cells[index], ...overrides };
  });

  const ships: PlacedShip[] = [
    { code: 'O', name: 'Oil Tanker', length: 3, orientation: 'horizontal-right', start: { x: 0, y: 5 }, cells: [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }] },
    { code: 'B', name: 'Battleship', length: 4, orientation: 'horizontal-right', start: { x: 0, y: 8 }, cells: [{ x: 0, y: 8 }, { x: 1, y: 8 }, { x: 2, y: 8 }, { x: 3, y: 8 }] },
  ];

  return { side: 'player', label: 'Test Navy', knownCount: 100, ships, cells, oilPending: false };
}

describe('Oil Tanker targeting priority', () => {
  it('picks randomly, not adjacency-biased, while the Oil Tanker has not been found', () => {
    const navy = makeNavy({ 80: { occupied: true, shipCode: 'B', effect: 'targeted' } });
    const results = Array.from({ length: 200 }, () => selectAppTargetIndex(navy));
    // With no Oil-Tanker-found bias, plain random selection over ~93
    // untargeted cells should still explore far from the one Battleship
    // hit at least once.
    expect(results.some((index) => index !== null && index < 40)).toBe(true);
  });

  it('targets a known Oil Tanker cell once one has been hit, ahead of a wounded Battleship', () => {
    const navy = makeNavy({
      50: { occupied: true, shipCode: 'O', effect: 'targeted' },
      80: { occupied: true, shipCode: 'B', effect: 'targeted' },
    });

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const index = selectAppTargetIndex(navy);
      expect([40, 41, 51, 60, 61]).toContain(index); // adjacent to cell 50 (col0,row5), edge-clipped
    }
  });

  it("targets the Oil Tanker's own remaining cell via the straight-line upgrade once it has 2+ hits", () => {
    const navy = makeNavy({
      50: { occupied: true, shipCode: 'O', effect: 'targeted' },
      51: { occupied: true, shipCode: 'O', effect: 'targeted' },
    });

    expect(selectAppTargetIndex(navy)).toBe(52);
  });

  it('prioritizes a revealed Oil Tanker cell over a different ship\'s own revealed cell', () => {
    const navy = makeNavy({
      50: { occupied: true, shipCode: 'O', droneRevealed: true },
      80: { occupied: true, shipCode: 'B', droneRevealed: true },
    });

    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(selectAppTargetIndex(navy)).toBe(50);
    }
  });

  it('ignores a different ship\'s revealed cell entirely while the Oil Tanker has not been found', () => {
    const navy = makeNavy({
      80: { occupied: true, shipCode: 'B', droneRevealed: true },
    });

    // Finding the tanker is the top priority - a free kill on some other
    // ship isn't worth a turn not spent looking for it, so this should
    // read as plain random selection, not always landing on 80.
    const results = Array.from({ length: 200 }, () => selectAppTargetIndex(navy));
    expect(results.some((index) => index !== 80)).toBe(true);
  });

  it('still ignores a different ship\'s revealed cell while hunting a found-but-not-yet-sunk Oil Tanker', () => {
    const navy = makeNavy({
      50: { occupied: true, shipCode: 'O', effect: 'targeted' },
      80: { occupied: true, shipCode: 'B', droneRevealed: true },
    });

    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect([40, 41, 51, 60, 61]).toContain(selectAppTargetIndex(navy)); // adjacent to the tanker hit at 50
    }
  });

  it('picks up a different ship\'s revealed cell once the Oil Tanker is sunk', () => {
    const navy = makeNavy({
      50: { occupied: true, shipCode: 'O', effect: 'sunk' },
      51: { occupied: true, shipCode: 'O', effect: 'sunk' },
      52: { occupied: true, shipCode: 'O', effect: 'sunk' },
      80: { occupied: true, shipCode: 'B', droneRevealed: true },
    });

    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(selectAppTargetIndex(navy)).toBe(80);
    }
  });
});

describe('Oil slick management', () => {
  it('avoids untargeted oil cells while the slick is small relative to the rest of the board', () => {
    const navy = makeNavy({
      50: { occupied: true, shipCode: 'O', effect: 'sunk' },
      51: { occupied: true, shipCode: 'O', effect: 'sunk' },
      52: { occupied: true, shipCode: 'O', effect: 'sunk' },
      60: { oil: true },
      61: { oil: true },
      62: { oil: true },
    });

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const index = selectAppTargetIndex(navy);
      expect(index).not.toBeNull();
      expect(navy.cells[index as number].oil).toBe(false);
    }
  });

  it('allows firing inside the slick once it is no longer smaller than the rest of the board', () => {
    const cells: Record<number, Partial<CellState>> = {
      50: { occupied: true, shipCode: 'O', effect: 'sunk' },
      51: { occupied: true, shipCode: 'O', effect: 'sunk' },
      52: { occupied: true, shipCode: 'O', effect: 'sunk' },
    };
    // Target every cell except a handful outside the slick and a matching
    // handful of oiled cells, so untargeted-outside (3) < untargeted-inside (10).
    for (let i = 0; i < 100; i += 1) {
      if (i === 50 || i === 51 || i === 52) continue;
      if (i >= 60 && i < 70) {
        cells[i] = { ...cells[i], oil: true }; // 10 untargeted oiled cells
      } else if (i === 90 || i === 91 || i === 92) {
        // leave these 3 as plain untargeted, non-oil - the only "outside" cells
      } else {
        cells[i] = { ...cells[i], effect: 'targeted' };
      }
    }
    const navy = makeNavy(cells);

    const results = Array.from({ length: 100 }, () => selectAppTargetIndex(navy));
    expect(results.some((index) => index !== null && navy.cells[index].oil)).toBe(true);
  });

  it('fires inside the slick once it has no room left to expand, even if still smaller than outside', () => {
    const cells: Record<number, Partial<CellState>> = {
      50: { occupied: true, shipCode: 'O', effect: 'sunk' },
      51: { occupied: true, shipCode: 'O', effect: 'sunk' },
      52: { occupied: true, shipCode: 'O', effect: 'sunk' },
      // A single untargeted oil cell, boxed in by already-targeted
      // neighbors on every side, so it has no room left to expand.
      61: { oil: true },
      60: { effect: 'targeted' },
      62: { effect: 'targeted' },
      70: { effect: 'targeted' },
      71: { effect: 'targeted' },
      72: { effect: 'targeted' },
    };
    const navy = makeNavy(cells);
    // Plenty of untargeted-outside cells remain (~91), so this is a weak
    // per-trial signal (~1/92) - run enough trials that a false negative
    // is astronomically unlikely.
    const results = Array.from({ length: 3000 }, () => selectAppTargetIndex(navy));
    expect(results.some((index) => index === 61)).toBe(true);
  });

  // Regression coverage for the bug where a wounded ship's own known
  // remaining cell could get skipped indefinitely just because it happened
  // to be oil-covered - see GAME_DESIGN.md's "Oil Tanker targeting
  // priority" writeup.
  it('targets a wounded ship\'s own oil-covered remaining cell once every remaining ship has been found', () => {
    const navy = makeNavy({
      // Oil Tanker sunk - the only other ship is the Battleship.
      50: { occupied: true, shipCode: 'O', effect: 'sunk' },
      51: { occupied: true, shipCode: 'O', effect: 'sunk' },
      52: { occupied: true, shipCode: 'O', effect: 'sunk' },
      // Battleship: 3 of 4 cells already hit, the last one is oil-covered -
      // exactly the reported scenario (last cell of a Battleship, under oil).
      80: { occupied: true, shipCode: 'B', effect: 'targeted' },
      81: { occupied: true, shipCode: 'B', effect: 'targeted' },
      82: { occupied: true, shipCode: 'B', effect: 'targeted' },
      83: { occupied: true, shipCode: 'B', effect: 'untargeted', oil: true },
    });

    // Every remaining ship (just the Battleship) has been found, so the
    // known kill should always win, regardless of the many oil-free cells
    // elsewhere on the board that slick-avoidance would otherwise prefer.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(selectAppTargetIndex(navy)).toBe(83);
    }
  });

  it('does not abandon slick avoidance for a wounded ship\'s oil-covered cell while another ship remains entirely unfound', () => {
    const navy = makeNavy({
      50: { occupied: true, shipCode: 'O', effect: 'sunk' },
      51: { occupied: true, shipCode: 'O', effect: 'sunk' },
      52: { occupied: true, shipCode: 'O', effect: 'sunk' },
      // Battleship hit 3 of 4 times; its last cell is under oil.
      80: { occupied: true, shipCode: 'B', effect: 'targeted' },
      81: { occupied: true, shipCode: 'B', effect: 'targeted' },
      82: { occupied: true, shipCode: 'B', effect: 'targeted' },
      83: { occupied: true, shipCode: 'B', effect: 'untargeted', oil: true },
      // A second, completely untouched ship still sits somewhere else on
      // the board - nothing about it has been hit yet.
      20: { occupied: true, shipCode: 'C' },
      21: { occupied: true, shipCode: 'C' },
    });

    // The Cruiser is still entirely unfound, so the Battleship's own
    // oil-covered cell should not be chased yet - the computer should keep
    // exploring untargeted, non-oil cells instead (which is exactly what's
    // available: everything on the board apart from 83 is either sunk,
    // already hit, or plain untargeted water).
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const index = selectAppTargetIndex(navy);
      expect(index).not.toBe(83);
    }
  });
});

// A 100-cell navy with no ships placed except whatever single-cell ships a
// test layers on via `ships`. Good enough for the weapon-immunity tests
// below - none of fireMoab/resolveMineHit/fireTravelingWeapon/moveMine
// touch navy.ships on the immune-ship branch they're exercising here.
function makeEmptyNavy(shipCells: Record<number, string>): NavyState {
  const cells = Array.from({ length: 100 }, () => makeCell());

  Object.entries(shipCells).forEach(([indexStr, shipCode]) => {
    cells[Number(indexStr)] = makeCell({ occupied: true, shipCode });
  });

  return { side: 'player', label: 'Test Navy', knownCount: 100, ships: [], cells, oilPending: false };
}

// Regression coverage for the "every MOAB drop on a Submarine feels like a
// bug" problem: a weapon that's actually fired and finds a ship it's
// immune to now gets an audible 'deflect' cue instead of resolving in
// total silence, while a cost-free background reveal (a Drone find, or a
// Mine's own passive wander) stays silent - see exposeCellWithoutDamage's
// doc comment in armada-game.ts.
describe("Weapon immunity: the 'deflect' audio cue", () => {
  it('plays deflect (not just splash/explosion) when a MOAB finds an immune Submarine', () => {
    // Submarine (S) is immune to the MOAB; centering the blast on it means
    // every other footprint cell is plain empty water.
    const navy = makeEmptyNavy({ 55: 'S' });

    const result = fireMoab(navy, 55);

    expect(result.audioSequence).toContain('deflect');
    expect(result.navy.cells[55].effect).toBe('untargeted');
    expect(result.navy.cells[55].droneRevealed).toBe(true);
  });

  it('plays only deflect when a Mine is dropped directly on an immune Ensign', () => {
    // Ensign (E) is immune to the Mine, and single-cell, so there's no
    // same-ship bonus cell to worry about - the whole result is just this
    // one exposure.
    const navy = makeEmptyNavy({ 42: 'E' });

    const result = resolveMineHit(navy, 42);

    expect(result.audioSequence).toEqual(['deflect']);
    expect(result.navy.cells[42].effect).toBe('untargeted');
  });

  it('plays deflect on the launch cell when a Torpedo is fired straight at an immune Helicopter', () => {
    // Helicopter (H) is immune to the Torpedo.
    const navy = makeEmptyNavy({ 40: 'H' });

    const result = fireTorpedo(navy, 40);

    expect(result.steps[0].audioSequence).toEqual(['deflect']);
    expect(result.steps[0].isHit).toBe(false);
  });

  it('plays deflect on a mid-flight cell an in-flight Torpedo merely crosses over an immune Ensign', () => {
    // Launch cell 30 is empty water; the Torpedo travels rightward
    // (column 0 <= 4) through 31, 32, 33... - Ensign (E) placed at 32 is
    // passed over, not detonated, but still isn't silent about it.
    const navy = makeEmptyNavy({ 32: 'E' });

    const result = fireTorpedo(navy, 30);
    const crossedStep = result.steps.find((step) => step.cellIndex === 32);

    expect(crossedStep?.audioSequence).toEqual(['deflect']);
    expect(crossedStep?.isHit).toBe(false);
  });

  it('stays silent when a Mine\'s own passive wander drifts onto an immune ship', () => {
    // The Mine sits at corner cell 0, whose only two neighbors (1 and 10)
    // are both immune ships - so wherever selectMineWanderIndex's own
    // randomness sends it, the result is a silent exposure either way,
    // matching its sibling "quietly confirms nothing there" wander branch
    // rather than the audible 'deflect' a player-fired weapon gets.
    const navy = makeEmptyNavy({ 1: 'E', 10: 'H' });

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const result = moveMine(navy, 0);
      expect(result.audioSequence).toEqual([]);
    }
  });
});

function makeTargetingResult(overrides: Partial<TargetingResult> = {}): TargetingResult {
  return { navy: makeNavy(), audioSequence: [], ...overrides };
}

function makeTravelStep(overrides: Partial<WeaponTravelStep> = {}): WeaponTravelStep {
  return { cellIndex: 0, navy: makeNavy(), isHit: false, audioSequence: [], ...overrides };
}

describe('shotOutcomeFromTargetingResult', () => {
  it('reports dealtDamage when a target index ended up occupied', () => {
    const navy = makeNavy({ 5: { occupied: true, shipCode: 'X', effect: 'targeted' } });
    const outcome = shotOutcomeFromTargetingResult(makeTargetingResult({ navy }), [5], true);
    expect(outcome.dealtDamage).toBe(true);
  });

  it('reports no damage when every target index is empty water', () => {
    const navy = makeNavy({ 5: { occupied: false, effect: 'targeted' } });
    const outcome = shotOutcomeFromTargetingResult(makeTargetingResult({ navy }), [5], true);
    expect(outcome.dealtDamage).toBe(false);
  });

  it('carries the ignited chain size through as oilDetonationSize', () => {
    const outcome = shotOutcomeFromTargetingResult(
      makeTargetingResult({ ignited: true, ignitedCellIndexes: [1, 2, 3] }),
      [1],
      true,
    );
    expect(outcome.oilDetonationSize).toBe(3);
  });

  it('is 0 when nothing ignited', () => {
    expect(shotOutcomeFromTargetingResult(makeTargetingResult(), [1], true).oilDetonationSize).toBe(0);
  });

  it('passes countsTowardHitStreak straight through - false models a Mine drop on empty water', () => {
    const navy = makeNavy({ 5: { occupied: false, effect: 'targeted' } });
    const outcome = shotOutcomeFromTargetingResult(makeTargetingResult({ navy }), [5], false);
    expect(outcome.countsTowardHitStreak).toBe(false);
  });
});

describe('shotOutcomeFromTravelSteps', () => {
  it('counts as a hit if any step along the run connected', () => {
    const outcome = shotOutcomeFromTravelSteps([
      makeTravelStep({ isHit: false }),
      makeTravelStep({ isHit: true }),
      makeTravelStep({ isHit: false }),
    ]);
    expect(outcome.dealtDamage).toBe(true);
  });

  it('is a miss when every step whiffed', () => {
    const outcome = shotOutcomeFromTravelSteps([makeTravelStep(), makeTravelStep(), makeTravelStep()]);
    expect(outcome.dealtDamage).toBe(false);
  });

  it('always counts toward the hit streak - a travelling weapon never has a pending outcome', () => {
    expect(shotOutcomeFromTravelSteps([makeTravelStep()]).countsTowardHitStreak).toBe(true);
  });

  it('takes the single biggest ignition among its steps, not their sum', () => {
    const outcome = shotOutcomeFromTravelSteps([
      makeTravelStep({ ignited: true, ignitedCellIndexes: [1, 2] }),
      makeTravelStep({ ignited: true, ignitedCellIndexes: [3, 4, 5, 6] }),
    ]);
    expect(outcome.oilDetonationSize).toBe(4);
  });
});

function makeShotOutcome(overrides: Partial<ShotOutcome> = {}): ShotOutcome {
  return { dealtDamage: false, countsTowardHitStreak: true, oilDetonationSize: 0, ...overrides };
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return { ...createGameState(), ...overrides };
}

describe('applyShotOutcome', () => {
  it('increments turnsTaken for the firing side regardless of outcome', () => {
    const state = makeGameState({ playerTurnsTaken: 3, appTurnsTaken: 7 });
    expect(applyShotOutcome(state, 'player', makeShotOutcome()).playerTurnsTaken).toBe(4);
    expect(applyShotOutcome(state, 'app', makeShotOutcome()).appTurnsTaken).toBe(8);
  });

  it('increments turnsTaken even for a turn excluded from the hit streak (a Drone)', () => {
    const state = makeGameState({ playerTurnsTaken: 0 });
    expect(applyShotOutcome(state, 'player', DRONE_SHOT_OUTCOME).playerTurnsTaken).toBe(1);
  });

  it('extends the current hit streak, and its peak, on a hit', () => {
    const state = makeGameState({ playerCurrentHitStreak: 2, playerHitStreakPeak: 2 });
    const next = applyShotOutcome(state, 'player', makeShotOutcome({ dealtDamage: true }));
    expect(next.playerCurrentHitStreak).toBe(3);
    expect(next.playerHitStreakPeak).toBe(3);
  });

  it('resets the current hit streak to 0 on a miss that counts, without erasing this game\'s peak', () => {
    const state = makeGameState({ playerCurrentHitStreak: 5, playerHitStreakPeak: 5 });
    const next = applyShotOutcome(state, 'player', makeShotOutcome({ dealtDamage: false }));
    expect(next.playerCurrentHitStreak).toBe(0);
    expect(next.playerHitStreakPeak).toBe(5);
  });

  it('leaves the current streak untouched for a turn excluded entirely (Drone)', () => {
    const state = makeGameState({ playerCurrentHitStreak: 4, playerHitStreakPeak: 4 });
    const next = applyShotOutcome(state, 'player', DRONE_SHOT_OUTCOME);
    expect(next.playerCurrentHitStreak).toBe(4);
    expect(next.playerHitStreakPeak).toBe(4);
  });

  it('raises the oil detonation peak, never lowers it', () => {
    const state = makeGameState({ playerOilDetonationPeak: 6 });
    expect(applyShotOutcome(state, 'player', makeShotOutcome({ oilDetonationSize: 10 })).playerOilDetonationPeak).toBe(10);
    expect(applyShotOutcome(state, 'player', makeShotOutcome({ oilDetonationSize: 2 })).playerOilDetonationPeak).toBe(6);
  });

  it('tracks the player and the computer independently', () => {
    const state = makeGameState({ playerCurrentHitStreak: 1, appCurrentHitStreak: 1 });
    const next = applyShotOutcome(state, 'app', makeShotOutcome({ dealtDamage: true }));
    expect(next.appCurrentHitStreak).toBe(2);
    expect(next.playerCurrentHitStreak).toBe(1);
  });
});

describe('applyMineWanderOilDetonation', () => {
  it('is a no-op when nothing ignited', () => {
    const state = makeGameState({ playerOilDetonationPeak: 3 });
    expect(applyMineWanderOilDetonation(state, 'player', 0)).toBe(state);
  });

  it("raises the firing side's oil detonation peak", () => {
    const state = makeGameState({ appOilDetonationPeak: 2 });
    expect(applyMineWanderOilDetonation(state, 'app', 9).appOilDetonationPeak).toBe(9);
  });

  it('never lowers an existing peak', () => {
    const state = makeGameState({ playerOilDetonationPeak: 12 });
    expect(applyMineWanderOilDetonation(state, 'player', 4).playerOilDetonationPeak).toBe(12);
  });
});

function makeSessionStats(overrides: Partial<SessionStats> = {}): SessionStats {
  return { ...DEFAULT_SESSION_STATS, ...overrides };
}

describe('computeSessionStatsUpdate', () => {
  it('increments gamesPlayed and gamesWon, and extends the win streak, on a win', () => {
    const state = makeGameState({ playerTurnsTaken: 20, player: makeNavy() });
    const { next } = computeSessionStatsUpdate(makeSessionStats({ gamesPlayed: 4, gamesWon: 2, currentWinStreak: 1 }), state, 'player');
    expect(next.gamesPlayed).toBe(5);
    expect(next.gamesWon).toBe(3);
    expect(next.currentWinStreak).toBe(2);
  });

  it('resets the win streak to 0 on a loss, and reports it as broken', () => {
    const state = makeGameState({ appTurnsTaken: 15, enemy: makeNavy() });
    const { next, updates } = computeSessionStatsUpdate(makeSessionStats({ currentWinStreak: 3 }), state, 'app');
    expect(next.currentWinStreak).toBe(0);
    expect(updates.some((update) => update.includes('broken') && update.includes('3'))).toBe(true);
  });

  it('does not report a broken streak when there was no streak to break', () => {
    const state = makeGameState({ appTurnsTaken: 15, enemy: makeNavy() });
    const { updates } = computeSessionStatsUpdate(makeSessionStats({ currentWinStreak: 0 }), state, 'app');
    expect(updates.some((update) => update.includes('broken'))).toBe(false);
  });

  it('sets a new Best Win Streak record only once the current streak actually exceeds it', () => {
    const state = makeGameState({ playerTurnsTaken: 20, player: makeNavy() });

    const tying = computeSessionStatsUpdate(makeSessionStats({ currentWinStreak: 2, bestWinStreak: 3 }), state, 'player');
    expect(tying.next.currentWinStreak).toBe(3);
    expect(tying.next.bestWinStreak).toBe(3);
    expect(tying.updates.some((update) => update.includes('New record') && update.includes('Best Win Streak'))).toBe(false);

    const beating = computeSessionStatsUpdate(makeSessionStats({ currentWinStreak: 3, bestWinStreak: 3 }), state, 'player');
    expect(beating.next.bestWinStreak).toBe(4);
    expect(beating.updates.some((update) => update.includes('New record! Best Win Streak: 4'))).toBe(true);
  });

  it('sets a new Quickest Win record only when this game took fewer turns', () => {
    const faster = makeGameState({ playerTurnsTaken: 10, player: makeNavy() });
    const fasterResult = computeSessionStatsUpdate(makeSessionStats({ quickestWin: 15 }), faster, 'player');
    expect(fasterResult.next.quickestWin).toBe(10);
    expect(fasterResult.updates.some((update) => update.includes('Quickest Win: 10 shots'))).toBe(true);

    const slower = makeGameState({ playerTurnsTaken: 20, player: makeNavy() });
    const slowerResult = computeSessionStatsUpdate(makeSessionStats({ quickestWin: 15 }), slower, 'player');
    expect(slowerResult.next.quickestWin).toBe(15);
    expect(slowerResult.updates.some((update) => update.includes('Quickest Win'))).toBe(false);
  });

  it("sets Margin of Victory to the winner's own untouched cell count", () => {
    // Battleship (80-83) takes one hit, Oil Tanker (50-52) stays untouched -
    // 6 of the navy's 7 occupied cells are left untargeted.
    const navy = makeNavy({ 80: { occupied: true, shipCode: 'B', effect: 'targeted' } });
    const state = makeGameState({ playerTurnsTaken: 20, player: navy });
    const { next, updates } = computeSessionStatsUpdate(makeSessionStats(), state, 'player');
    expect(next.marginOfVictory).toBe(6);
    expect(updates.some((update) => update.includes('Margin of Victory: 6'))).toBe(true);
  });

  it("sets Margin of Defeat to the computer's own untouched cell count on a loss", () => {
    const navy = makeNavy({ 50: { occupied: true, shipCode: 'O', effect: 'targeted' } });
    const state = makeGameState({ appTurnsTaken: 20, enemy: navy });
    const { next, updates } = computeSessionStatsUpdate(makeSessionStats(), state, 'app');
    expect(next.marginOfDefeat).toBe(6);
    expect(updates.some((update) => update.includes('Margin of Defeat: 6'))).toBe(true);
  });

  it('tracks Hit Streak and Oil Detonation records for both sides regardless of who won', () => {
    // The player LOSES this game, but the computer sets two personal bests
    // along the way - both should still be reported (see GAME_DESIGN.md:
    // "even in defeat, the computer setting its own personal best is worth
    // knowing about").
    const state = makeGameState({
      appTurnsTaken: 20,
      enemy: makeNavy(),
      playerHitStreakPeak: 6,
      appHitStreakPeak: 9,
      playerOilDetonationPeak: 4,
      appOilDetonationPeak: 11,
    });
    const { next, updates } = computeSessionStatsUpdate(
      makeSessionStats({ longestHitStreakPlayer: 3, longestHitStreakApp: 3, biggestOilDetonationPlayer: 1, biggestOilDetonationApp: 1 }),
      state,
      'app',
    );

    expect(next.longestHitStreakPlayer).toBe(6);
    expect(next.longestHitStreakApp).toBe(9);
    expect(next.biggestOilDetonationPlayer).toBe(4);
    expect(next.biggestOilDetonationApp).toBe(11);
    expect(updates.some((update) => update.includes("Computer's Longest Hit Streak: 9"))).toBe(true);
    expect(updates.some((update) => update.includes('Your Longest Hit Streak: 6'))).toBe(true);
  });

  it('does not regress a Hit Streak record this game fell short of', () => {
    const state = makeGameState({ playerTurnsTaken: 20, player: makeNavy(), playerHitStreakPeak: 2, appHitStreakPeak: 1 });
    const { next, updates } = computeSessionStatsUpdate(
      makeSessionStats({ longestHitStreakPlayer: 8, longestHitStreakApp: 5 }),
      state,
      'player',
    );
    expect(next.longestHitStreakPlayer).toBe(8);
    expect(next.longestHitStreakApp).toBe(5);
    expect(updates.some((update) => update.includes('Longest Hit Streak'))).toBe(false);
  });
});

// Regression coverage for a reported bug: dropping a Mine directly on an
// Ensign (immune to the Mine - see WEAPON_IMMUNE_SHIP_CODES) exposed the
// cell as expected, but the Mine itself then vanished instead of staying
// planted and visible on that same cell. The old logic decided this purely
// from the drop cell's raw occupancy, which is wrong: an immune ship
// survives the drop, so the Mine should stay live there exactly as if it
// had landed on empty water - only a real detonation should consume it.
describe('resolveMineIndexAfterDrop', () => {
  it('stays planted at the drop cell when the drop dealt no damage (empty water, or an immune ship exposed)', () => {
    const missOutcome = makeShotOutcome({ dealtDamage: false });
    expect(resolveMineIndexAfterDrop(missOutcome, null, 42)).toBe(42);
    // Also true when some other mine was already active elsewhere - the
    // new drop still plants its own mine right where it landed.
    expect(resolveMineIndexAfterDrop(missOutcome, 7, 42)).toBe(42);
  });

  it('is consumed (reverting to whatever mine index already existed) once the drop actually detonates', () => {
    const hitOutcome = makeShotOutcome({ dealtDamage: true });
    expect(resolveMineIndexAfterDrop(hitOutcome, null, 42)).toBeNull();
    expect(resolveMineIndexAfterDrop(hitOutcome, 7, 42)).toBe(7);
  });
});

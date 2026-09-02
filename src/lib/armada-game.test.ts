import { describe, expect, it } from 'vitest';
import { selectAppTargetIndex, type CellState, type NavyState, type PlacedShip } from './armada-game';

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

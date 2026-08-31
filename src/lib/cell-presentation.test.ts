import { describe, expect, it } from 'vitest';
import { getCellPresentation, MINE_GLYPH, MINE_GLYPH_COLOR_CLASS } from './cell-presentation';
import type { CellState } from './armada-game';

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

describe('getCellPresentation - mine display', () => {
  it('leaves the value untouched when there is no mine', () => {
    const cell = makeCell({ occupied: true, shipCode: 'S', effect: 'sunk' });
    expect(getCellPresentation(cell, false).value).toBe('S');
  });

  it('shows only the mine glyph, in red, for a mine on an untargeted, unoccupied cell', () => {
    const cell = makeCell();
    const presentation = getCellPresentation(cell, true);
    expect(presentation.value).toBe(MINE_GLYPH);
    expect(presentation.className).toContain(MINE_GLYPH_COLOR_CLASS);
    expect(presentation.label).toContain('mine present');
  });

  it('shows only the mine glyph for a mine on a previously-missed (targeted, unoccupied) cell - no dash', () => {
    const cell = makeCell({ effect: 'targeted' });
    const presentation = getCellPresentation(cell, true);
    expect(presentation.value).toBe(MINE_GLYPH);
  });

  it('leaves an occupied cell\'s own value untouched when a mine is present, for GridCell to overlay separately', () => {
    const sunkShip = makeCell({ occupied: true, shipCode: 'F', effect: 'sunk' });
    const presentation = getCellPresentation(sunkShip, true);
    expect(presentation.value).toBe('F');
    expect(presentation.label).toContain('mine present');
  });

  it('leaves an occupied, untargeted (droneRevealed) cell\'s own value untouched when a mine is present', () => {
    const revealedShip = makeCell({ occupied: true, shipCode: 'E', droneRevealed: true });
    const presentation = getCellPresentation(revealedShip, true);
    expect(presentation.value).toBe('E');
  });

  it('leaves className untouched for an occupied cell - the mine glyph is colored via GridCell\'s own overlay instead', () => {
    const cell = makeCell({ occupied: true, shipCode: 'F', effect: 'sunk' });
    const without = getCellPresentation(cell, false);
    const withMine = getCellPresentation(cell, true);
    expect(withMine.className).toBe(without.className);
  });
});

describe('getCellPresentation - exposed (droneRevealed) ship styling', () => {
  it('colors a live, droneRevealed, untargeted ship cell bright yellow and bold', () => {
    const cell = makeCell({ occupied: true, shipCode: 'S', droneRevealed: true });
    const presentation = getCellPresentation(cell, false);
    expect(presentation.className).toContain('text-yellow-300');
    expect(presentation.className).toContain('font-bold');
  });

  it('does not color an ordinary (not droneRevealed) untargeted ship cell yellow', () => {
    const cell = makeCell({ occupied: true, shipCode: 'S' });
    const presentation = getCellPresentation(cell, false);
    expect(presentation.className).not.toContain('text-yellow-300');
    expect(presentation.className).toContain('text-white');
  });

  it('stops coloring a droneRevealed cell yellow once it has actually been hit', () => {
    const cell = makeCell({ occupied: true, shipCode: 'S', droneRevealed: true, effect: 'targeted' });
    const presentation = getCellPresentation(cell, false);
    expect(presentation.className).not.toContain('text-yellow-300');
  });
});

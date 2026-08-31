import { describe, expect, it } from 'vitest';
import { getCellPresentation } from './cell-presentation';
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

  it('shows only an asterisk for a mine on an untargeted, unoccupied cell', () => {
    const cell = makeCell();
    const presentation = getCellPresentation(cell, true);
    expect(presentation.value).toBe('*');
    expect(presentation.label).toContain('mine present');
  });

  it('shows only an asterisk for a mine on a previously-missed (targeted, unoccupied) cell - no dash', () => {
    const cell = makeCell({ effect: 'targeted' });
    const presentation = getCellPresentation(cell, true);
    expect(presentation.value).toBe('*');
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

  it('does not change className based on hasMine - only value/label', () => {
    const cell = makeCell({ occupied: true, shipCode: 'F', effect: 'sunk' });
    const without = getCellPresentation(cell, false);
    const withMine = getCellPresentation(cell, true);
    expect(withMine.className).toBe(without.className);
  });
});

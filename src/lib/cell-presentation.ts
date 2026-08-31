import type { CellState } from './armada-game';

export type CellPresentation = { className: string; value: string; label: string };

// A filled circle rather than an asterisk: an asterisk's glyph sits high in
// its own em-box in most fonts (it was designed as a footnote-reference
// mark, not a centered symbol), so it never actually lines up with the
// vertically-centered ship letters around it. A circle centers the same
// way a letter does, and it matches the Mine weapon's own CircleDot icon
// used everywhere else in the UI (weapon button, weapon bar) rather than
// introducing an unrelated shape just for this one indicator.
export const MINE_GLYPH = '●';
// Applied regardless of whether the cell is occupied, so the mine glyph
// always reads as its own distinct red marker rather than blending into
// whatever white/green ship-letter color the cell would otherwise use.
export const MINE_GLYPH_COLOR_CLASS = 'text-red-500';

export function getCellPresentation(cell: CellState, hasMine: boolean): CellPresentation {
  const base = computeBaseCellPresentation(cell);

  if (!hasMine) {
    return base;
  }

  // An unoccupied cell holding a mine shows only the glyph - there's
  // nothing else to combine it with, and this also means a mine sitting on
  // a previous miss hides that miss's dash while it's there. An occupied
  // cell leaves its own value untouched here; GridCell (Index.tsx) overlays
  // a second, independently-centered glyph on top of it instead of folding
  // the two into one text value, so both stay fully legible at once - e.g.
  // a mine visibly drifting across an already-sunk ship's own letter (see
  // hasMineOverlay).
  if (!cell.occupied) {
    return {
      ...base,
      value: MINE_GLYPH,
      className: `${base.className} ${MINE_GLYPH_COLOR_CLASS}`,
      label: `${base.label}, mine present`,
    };
  }

  return { ...base, label: `${base.label}, mine present` };
}

function computeBaseCellPresentation(cell: CellState): CellPresentation {
  // Oil hides a ship's identity only while the cell itself is still hidden
  // by fog of war. Once a cell is visible (the player's own navy, or a
  // future reveal effect on the enemy's), a ship under the oil should still
  // show its letter.
  const value = cell.oil && cell.effect === 'untargeted' && cell.exposure === 'unknown'
    ? ''
    : cell.occupied ? (cell.shipCode ?? '') : cell.effect === 'targeted' ? '–' : '';

  // Signals "this ship is known but hasn't been damaged" - a Drone find, or
  // a weapon that discovered a ship it's immune to (see
  // isShipImmuneToWeapon in armada-game.ts). A live (not yet targeted)
  // occupied cell in this state shows its letter in a bright, bold green
  // instead of the plain white/semibold every other visible ship cell
  // uses, on either grid, so the reveal stays visible after the fact even
  // though nothing about the cell's background changes. green-300 (rather
  // than the darker green-600-ish #00B200 the end-of-game reveal uses, or
  // the dimmer green-400 this used before) so it actually pops against the
  // blue "untargeted" background; bold adds a second, non-color signal for
  // the same state, since color alone was judged not visible enough.
  const isExposedUntargeted = cell.occupied && cell.droneRevealed && cell.effect === 'untargeted';
  const shipTextColorClass = isExposedUntargeted ? 'text-green-300' : 'text-white';
  const shipFontWeightClass = isExposedUntargeted ? 'font-bold' : '';

  if (cell.targeting) {
    return {
      className: 'border-[#00FFFF] bg-[#00FFFF] text-slate-950',
      // Fog of war: don't leak the ship identifier while previewing a shot
      // on a cell that hasn't been revealed yet. Once exposure is 'known'
      // (the player's own navy, or a cell already hit), the identity isn't
      // a secret, so show it as normal.
      value: cell.exposure === 'unknown' ? '' : value,
      label: cell.occupied ? 'occupied and targeting' : 'empty and targeting',
    };
  }

  if (cell.shipCode === 'O' && cell.effect === 'sunk') {
    return {
      className: 'border-[#202020] bg-[#202020] text-white',
      value,
      label: 'oil tanker sunk',
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
    // A splash into oil over an empty cell has nothing to burn off, so the
    // oil survives the shot and still reads as oil, just with the hyphen
    // for "targeted" layered on top of it.
    if (cell.oil) {
      return {
        className: 'border-[#404040] bg-[#404040] text-white',
        value,
        label: 'empty with oil, targeted',
      };
    }

    return {
      className: 'border-[#0000FF] bg-[#0000FF] text-white',
      value,
      label: 'empty and targeted',
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

  if (cell.oil) {
    return {
      className: `border-[#404040] bg-[#404040] ${shipTextColorClass} ${shipFontWeightClass}`,
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

  return {
    className: `border-[#0000FF] bg-[#0000FF] ${shipTextColorClass} ${shipFontWeightClass}`,
    value,
    label: cell.occupied ? 'occupied and untargeted' : 'empty and untargeted',
  };
}

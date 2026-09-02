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
  // occupied cell in this state needs to read as visibly different from an
  // ordinary visible ship cell, on either grid, so the reveal stays
  // noticeable after the fact. This went through several attempts at
  // recoloring just the letter first (green-400, then green-300, then
  // yellow-300) - all judged too subtle, because a color change on a
  // single small glyph just doesn't carry much visual weight next to a
  // whole cell's worth of background. Shifting the cell's own background
  // instead (see exposedBackgroundClassName below) is the same trick oil
  // already uses (`#404040` instead of blue) to make a state change
  // unmissable - it colors the whole cell, not a few pixels of glyph. The
  // letter itself goes back to plain white to match every ordinary ship
  // cell, since the background now carries the signal; bold stays on as a
  // second, non-color signal (useful for colorblind players, since the
  // background shift below is a hue change).
  const isExposedUntargeted = cell.occupied && cell.droneRevealed && cell.effect === 'untargeted';
  const shipFontWeightClass = isExposedUntargeted ? 'font-bold' : '';
  // Two muted shades, neither the vivid `#00B200` revealUntargetedShips()
  // uses for its own end-of-game reveal (see below) - that green is a
  // deliberate "shoot here" signal for a different moment (ships that
  // survived to the end of the game), and reusing it here would carry the
  // same urgency for what's meant to be a much quieter "there's a live
  // ship under this, FYI" cue. `#0B5D73` (a muted teal) is used when the
  // cell is also oil-covered - a real step away from pure `#0000FF` blue
  // without leaving the blue family, subtle enough to sit on top of oil's
  // own gray without the two competing. `#0B7A5C` - the same idea, pushed
  // noticeably greener - is used everywhere else, since without oil
  // competing for attention a stronger shift reads better.
  const exposedOilBackgroundClassName = 'border-[#0B5D73] bg-[#0B5D73] text-white';
  const exposedBackgroundClassName = 'border-[#0B7A5C] bg-[#0B7A5C] text-white';

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
    if (isExposedUntargeted) {
      return {
        className: `${exposedOilBackgroundClassName} ${shipFontWeightClass}`,
        value,
        label: 'occupied with oil',
      };
    }

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

  if (isExposedUntargeted) {
    return {
      className: `${exposedBackgroundClassName} ${shipFontWeightClass}`,
      value,
      label: 'occupied and untargeted',
    };
  }

  return {
    className: 'border-[#0000FF] bg-[#0000FF] text-white',
    value,
    label: cell.occupied ? 'occupied and untargeted' : 'empty and untargeted',
  };
}

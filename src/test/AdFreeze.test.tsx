import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../App';
import { createGameState } from '@/lib/armada-game';

// Stands in for a native build (areAdsAvailable() true) with a real ad
// that's still loading: showRewardedAd stays pending until the test
// settles it by hand, the way a real prepare/show round-trip does for a
// second or so on a device before the ad's own full-screen activity
// appears.
let settleAd: ((earnedReward: boolean) => void) | null = null;

vi.mock('@/lib/ads', () => ({
  areAdsAvailable: () => true,
  preloadRewardedAd: () => {},
  showRewardedAd: () =>
    new Promise<boolean>((resolve) => {
      settleAd = resolve;
    }),
}));

const WEAPON_COUNT_KEYS = ['moab', 'mine', 'torpedo', 'rocket', 'harpoon', 'drone'].map((weapon) => `armada:${weapon}-count`);
const WEAPON_LABELS = ['MOAB', 'MINE', 'TORPEDO', 'ROCKET', 'HARPOON', 'DRONE'];

const readGameState = () => JSON.parse(window.localStorage.getItem('armada:game-state') ?? 'null');
const countShotEnemyCells = () =>
  readGameState().enemy.cells.filter((cell: { effect: string }) => cell.effect !== 'untargeted').length;

describe('rewarded ad in progress', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // Every weapon empty, so whichever three get drawn into this game,
    // tapping one opens the weapon-refill ad prompt.
    for (const key of WEAPON_COUNT_KEYS) {
      window.localStorage.setItem(key, '0');
    }
    // A saved game that's the player's move - who goes first in a fresh
    // game is random.
    window.localStorage.setItem('armada:game-state', JSON.stringify({ ...createGameState(), currentTurn: 'player' }));
    settleAd = null;
    // jsdom has no media playback; a shot's sound cues just need a
    // promise-returning play() to not throw.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  });

  it('freezes the game from the moment "Watch Ad" is tapped until the ad resolves', async () => {
    render(<App />);

    const playButton = screen.queryByRole('button', { name: 'Play' });
    if (playButton) {
      fireEvent.click(playButton);
    }

    expect(readGameState().currentTurn).toBe('player');

    const weaponButton = screen
      .getAllByRole('button')
      .find((button) => WEAPON_LABELS.some((label) => button.textContent?.includes(label)) && !button.hasAttribute('disabled'));
    expect(weaponButton).toBeDefined();
    fireEvent.click(weaponButton!);

    fireEvent.click(await screen.findByRole('button', { name: 'Watch Ad' }));

    // A tap shield covers the screen while the real ad loads...
    expect(screen.getByTestId('ad-tap-shield')).toBeInTheDocument();

    // ...and even a press that reaches an enemy cell directly is ignored.
    const enemyGrid = screen.getByLabelText(/enemy.*grid/i);
    const enemyCell = within(enemyGrid).getAllByRole('button', { hidden: true })[0];
    fireEvent.mouseDown(enemyCell);
    fireEvent.mouseUp(enemyCell);

    expect(countShotEnemyCells()).toBe(0);
    expect(readGameState().currentTurn).toBe('player');

    // Once the ad closes (here: dismissed without a reward), the game
    // unfreezes and the same press is accepted.
    await act(async () => {
      settleAd?.(false);
    });
    expect(screen.queryByTestId('ad-tap-shield')).not.toBeInTheDocument();

    fireEvent.mouseDown(enemyCell);
    fireEvent.mouseUp(enemyCell);
    expect(countShotEnemyCells()).toBeGreaterThan(0);
  });
});

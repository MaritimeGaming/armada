import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { showRewardedAd } from './ads';

const isNativePlatform = vi.fn();
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform() },
}));

type Listener = (...args: unknown[]) => void;

const initialize = vi.fn();
const prepareRewardVideoAd = vi.fn();
const showRewardVideoAd = vi.fn();
const addListener = vi.fn();
let listeners: Record<string, Listener[]>;

vi.mock('@capacitor-community/admob', () => ({
  AdMob: {
    initialize: (...args: unknown[]) => initialize(...args),
    prepareRewardVideoAd: (...args: unknown[]) => prepareRewardVideoAd(...args),
    showRewardVideoAd: (...args: unknown[]) => showRewardVideoAd(...args),
    addListener: (...args: unknown[]) => addListener(...args),
  },
  RewardAdPluginEvents: {
    Rewarded: 'onRewardedVideoAdReward',
    Dismissed: 'onRewardedVideoAdDismissed',
    FailedToShow: 'onRewardedVideoAdFailedToShow',
  },
}));

// Simulates the native SDK invoking one of the listeners registered via
// AdMob.addListener - mirrors how the real plugin dispatches these events.
function fireEvent(event: string, ...args: unknown[]) {
  (listeners[event] ?? []).forEach((listener) => listener(...args));
}

// Lets the ensureInitialized() -> addListener() microtask chain inside
// showRewardedAd run before a test fires a simulated SDK event or asserts
// on the mocks - a real setTimeout(0) macrotask is guaranteed to run after
// any already-queued microtasks.
async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('showRewardedAd', () => {
  beforeEach(() => {
    listeners = {};
    isNativePlatform.mockReset();
    initialize.mockReset().mockResolvedValue(undefined);
    prepareRewardVideoAd.mockReset().mockResolvedValue({ adUnitId: 'test' });
    showRewardVideoAd.mockReset().mockResolvedValue({ type: 'coins', amount: 1 });
    addListener.mockReset().mockImplementation((event: string, listener: Listener) => {
      (listeners[event] ??= []).push(listener);
      return Promise.resolve({ remove: vi.fn() });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves true after a short delay on a non-native platform', async () => {
    isNativePlatform.mockReturnValue(false);
    vi.useFakeTimers();

    const promise = showRewardedAd();
    await vi.advanceTimersByTimeAsync(2000);

    await expect(promise).resolves.toBe(true);
    expect(initialize).not.toHaveBeenCalled();
  });

  it('initializes the SDK, requests the test ad unit, and resolves true on a genuine reward', async () => {
    isNativePlatform.mockReturnValue(true);

    const promise = showRewardedAd();
    await flushMicrotasks();

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledWith({ initializeForTesting: true });
    expect(prepareRewardVideoAd).toHaveBeenCalledWith({
      adId: 'ca-app-pub-3940256099942544/5224354917',
      isTesting: true,
    });

    fireEvent('onRewardedVideoAdReward', { type: 'coins', amount: 1 });
    await expect(promise).resolves.toBe(true);

    // A second call reuses the already-initialized SDK rather than
    // re-initializing it.
    fireEvent('onRewardedVideoAdReward', { type: 'coins', amount: 1 });
    const second = showRewardedAd();
    await flushMicrotasks();
    fireEvent('onRewardedVideoAdReward', { type: 'coins', amount: 1 });
    await expect(second).resolves.toBe(true);
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it('resolves false when the user dismisses the ad without earning the reward', async () => {
    isNativePlatform.mockReturnValue(true);

    const promise = showRewardedAd();
    await flushMicrotasks();
    fireEvent('onRewardedVideoAdDismissed');

    await expect(promise).resolves.toBe(false);

    // A stray reward event arriving after dismissal (shouldn't happen, but
    // must not flip an already-settled outcome) is ignored.
    fireEvent('onRewardedVideoAdReward', { type: 'coins', amount: 1 });
    await expect(promise).resolves.toBe(false);
  });

  it('resolves false when a loaded ad fails to show', async () => {
    isNativePlatform.mockReturnValue(true);

    const promise = showRewardedAd();
    await flushMicrotasks();
    fireEvent('onRewardedVideoAdFailedToShow', { code: 0, message: 'boom' });

    await expect(promise).resolves.toBe(false);
  });

  it('resolves false when the ad fails to load in the first place', async () => {
    isNativePlatform.mockReturnValue(true);
    prepareRewardVideoAd.mockRejectedValue(new Error('no fill'));

    await expect(showRewardedAd()).resolves.toBe(false);
  });
});

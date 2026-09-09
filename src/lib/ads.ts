import { Capacitor } from '@capacitor/core';
import { AdMob, RewardAdPluginEvents } from '@capacitor-community/admob';

// The app's real rewarded ad unit IDs, registered under its real AdMob App
// ID (see AndroidManifest.xml's com.google.android.gms.ads.APPLICATION_ID
// meta-data) - one per placement, so each shows up as its own line in the
// AdMob console's reporting (impressions, fill rate, eCPM) instead of
// being blended into one. See the "Ad integration" sections of
// GAME_DESIGN.md for what each placement is.
const REWARDED_AD_UNIT_IDS = {
  gameTokens: 'ca-app-pub-1765694427918098/5770042821',
  weaponRefill: 'ca-app-pub-1765694427918098/9897472590',
} as const;

export type RewardedAdPlacement = keyof typeof REWARDED_AD_UNIT_IDS;

// TODO(publish): flip this to false for the actual Play Store release
// build. Until then, every request against the real ad unit IDs above is
// forced to serve a harmless test ad instead of a real one - the
// supported way to exercise real ad units during development without
// generating invalid traffic: https://developers.google.com/admob/android/test-ads
const FORCE_TEST_ADS = true;

// AdMob.initialize() only needs to run once per app session; every call
// site awaits this same promise instead of re-initializing.
let initializePromise: Promise<void> | null = null;

function ensureInitialized(): Promise<void> {
  if (!initializePromise) {
    initializePromise = AdMob.initialize({ initializeForTesting: FORCE_TEST_ADS }).then(() => undefined);
  }
  return initializePromise;
}

// Caches an in-flight/completed prepareRewardVideoAd() call per placement,
// so a preload kicked off ahead of time (see preloadRewardedAd below) means
// showRewardedAd's own prepare step is often already finished by the time
// the player actually taps "Watch Ad" - the visible "Loading Ad" overlay is
// real network latency fetching the ad creative, not a fixed delay, and
// this is what actually shortens it. There's no way to guarantee it away
// entirely: a player who taps through the confirmation dialog instantly,
// or a slow connection, can still catch it mid-load.
const preparedAds: Partial<Record<RewardedAdPlacement, Promise<unknown>>> = {};

function ensurePrepared(placement: RewardedAdPlacement): Promise<unknown> {
  if (!preparedAds[placement]) {
    preparedAds[placement] = ensureInitialized().then(() =>
      AdMob.prepareRewardVideoAd({ adId: REWARDED_AD_UNIT_IDS[placement], isTesting: FORCE_TEST_ADS }),
    );
  }
  return preparedAds[placement]!;
}

/**
 * Starts fetching a placement's rewarded ad in the background, before the
 * player has actually asked to watch one - call this the moment a
 * confirmation dialog offering that ad opens (see requestNewGame's and
 * handleWeaponButtonClick's pending-confirmation state in Index.tsx), not
 * when they tap "Watch Ad". A no-op outside a native build. Failures here
 * are silent - showRewardedAd retries the prepare step itself if this one
 * didn't finish in time or didn't succeed.
 */
export function preloadRewardedAd(placement: RewardedAdPlacement): void {
  if (!Capacitor.isNativePlatform()) {
    return;
  }
  ensurePrepared(placement).catch(() => {
    delete preparedAds[placement];
  });
}

// Test-only: preparedAds is module-level state that outlives any single
// it(), so a preload started in one test (and never consumed by a matching
// showRewardedAd call in that same test) would otherwise leak into - and
// change the mocked-call assertions of - whichever test runs next.
export function __resetPreparedAdsForTests() {
  for (const key of Object.keys(preparedAds) as RewardedAdPlacement[]) {
    delete preparedAds[key];
  }
}

// How long the non-native fallback below "plays" before resolving. AdMob's
// native rewarded ads don't run at all outside an actual Android build, so
// this stands in for the whole flow in a desktop browser (local `npm run
// dev`, the vitest suite, the GitHub Pages build) - matching the fixed
// delay both call sites used before this module existed, so neither
// development nor the test suite changes behavior.
const WEB_FALLBACK_DELAY_MS = 2000;

/**
 * Shows a rewarded ad for the given placement and resolves once the
 * outcome is actually known: `true` only if the user genuinely earned the
 * reward (watched to completion), `false` if they closed it early or it
 * failed to load/show, and (outside a native build, where no real ad can
 * run at all) `true` after a short simulated delay.
 *
 * Never resolves optimistically on a timeout or a bare "closed" signal -
 * both call sites (`requestNewGame`'s game-token gate,
 * `beginWeaponProcurement`'s weapon-refill gate in Index.tsx) depend on
 * that: crediting the player before the reward is confirmed would let
 * backgrounding or force-quitting mid-ad be used to farm free tokens/ammo.
 * See the "Ad integration" sections of GAME_DESIGN.md.
 *
 * Reuses (and consumes) whatever preloadRewardedAd already started for
 * this placement rather than always starting its own prepare step from
 * scratch - see ensurePrepared above.
 */
export async function showRewardedAd(placement: RewardedAdPlacement): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    return new Promise((resolve) => {
      window.setTimeout(() => resolve(true), WEB_FALLBACK_DELAY_MS);
    });
  }

  await ensureInitialized();

  return new Promise((resolve) => {
    let settled = false;

    const settle = (result: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      void rewardedHandle.then((handle) => handle.remove());
      void dismissedHandle.then((handle) => handle.remove());
      void failedToShowHandle.then((handle) => handle.remove());
      resolve(result);
    };

    // The reward, dismiss, and show-failure events are mutually exclusive
    // outcomes of one ad view - exactly one of them fires per showRewardVideoAd()
    // call, so whichever settles first wins and the other listeners are torn
    // down. showRewardVideoAd()'s own returned promise resolves specifically
    // "when the user earns the reward" per its type definition, but doesn't
    // document what happens on a plain dismiss without a reward - listening
    // for all three events directly, rather than trusting that promise's
    // resolution alone, is what makes the "false" outcomes reliable.
    const rewardedHandle = AdMob.addListener(RewardAdPluginEvents.Rewarded, () => settle(true));
    const dismissedHandle = AdMob.addListener(RewardAdPluginEvents.Dismissed, () => settle(false));
    const failedToShowHandle = AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => settle(false));

    ensurePrepared(placement)
      .then(() => AdMob.showRewardVideoAd({ adId: REWARDED_AD_UNIT_IDS[placement] }))
      .catch(() => settle(false))
      .finally(() => {
        // Shown or failed either way - a prepared ad is single-use, so the
        // next time this placement is needed it must be prepared again,
        // not reuse this same (now spent) promise.
        delete preparedAds[placement];
      });
  });
}

import { Capacitor } from '@capacitor/core';
import { AdMob, RewardAdPluginEvents } from '@capacitor-community/admob';

// Google's official sample rewarded ad unit ID - always serves a real,
// harmless test ad and is safe to ship in a development build:
// https://developers.google.com/admob/android/test-ads
//
// TODO(publish): swap this for the app's real rewarded ad unit ID from the
// AdMob console (and drop `isTesting`/`initializeForTesting` below) before
// the Play Store release build - see the "AdMob integration" step of the
// publishing guide in GAME_DESIGN.md.
const REWARDED_AD_UNIT_ID = 'ca-app-pub-3940256099942544/5224354917';

// AdMob.initialize() only needs to run once per app session; every call
// site awaits this same promise instead of re-initializing.
let initializePromise: Promise<void> | null = null;

function ensureInitialized(): Promise<void> {
  if (!initializePromise) {
    initializePromise = AdMob.initialize({ initializeForTesting: true }).then(() => undefined);
  }
  return initializePromise;
}

// How long the non-native fallback below "plays" before resolving. AdMob's
// native rewarded ads don't run at all outside an actual Android build, so
// this stands in for the whole flow in a desktop browser (local `npm run
// dev`, the vitest suite, the GitHub Pages build) - matching the fixed
// delay both call sites used before this module existed, so neither
// development nor the test suite changes behavior.
const WEB_FALLBACK_DELAY_MS = 2000;

/**
 * Shows a rewarded ad and resolves once the outcome is actually known:
 * `true` only if the user genuinely earned the reward (watched to
 * completion), `false` if they closed it early or it failed to load/show,
 * and (outside a native build, where no real ad can run at all) `true`
 * after a short simulated delay.
 *
 * Never resolves optimistically on a timeout or a bare "closed" signal -
 * both call sites (`requestNewGame`'s game-token gate,
 * `beginWeaponProcurement`'s weapon-refill gate in Index.tsx) depend on
 * that: crediting the player before the reward is confirmed would let
 * backgrounding or force-quitting mid-ad be used to farm free tokens/ammo.
 * See the "Ad integration" sections of GAME_DESIGN.md.
 */
export async function showRewardedAd(): Promise<boolean> {
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

    AdMob.prepareRewardVideoAd({ adId: REWARDED_AD_UNIT_ID, isTesting: true })
      .then(() => AdMob.showRewardVideoAd())
      .catch(() => settle(false));
  });
}

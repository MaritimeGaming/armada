# Armada — Google Play release prep

Working notes for getting Armada onto the Play Store. Covers a pre-submission
audit, the store-listing copy, the graphic-asset checklist, and a step-by-step
Play Console walkthrough with pre-filled answers for every policy form.

---

## 0. Status checklist (updated 2026-09-10)

**Done**
- [x] Package renamed to `com.maritimegaming.armada` (permanent ID, set before first upload)
- [x] Repo moved to `MaritimeGaming` GitHub org, made public
- [x] Privacy policy live at `https://armada.maritimegaming.com/privacy` (custom domain, HTTPS enforced)
- [x] Store graphics: `store-assets/icon-512.png`, `store-assets/feature-graphic-1024x500.jpg`
- [x] Listing copy drafted (§3)
- [x] Category decided: Board
- [x] Account type confirmed: individual → closed testing required

**Blocking the closed test (do these first — nothing below matters until the 12/14 clock is running)**
- [ ] 4–6 phone screenshots captured on a device → `store-assets/` (§4) — the one real content gap; at least 2 are required to save a usable store listing
- [ ] Create the app entry (§5)
- [ ] "Set up your app" forms: app access, ads, content rating, target audience, data safety, advertising ID, etc. (§6) — Play Console gates rollout on *every* track, including closed testing, behind these
- [ ] Main store listing: descriptions, graphics, category, tags (§7.1)
- [ ] Store settings + contact details (§7.2)
- [ ] Build *any* signed AAB (§7.4) — enrolls Play App Signing automatically on first upload; test ads are fine for this build, see below
- [ ] Recruit 12+ testers with Android devices (start immediately, in parallel with the above)
- [ ] Closed testing track: upload the AAB, send the opt-in link (§7.5)
- [ ] 14 continuous days at ≥12 opted-in testers

**NOT required before the closed test — do before promoting to production instead**
- [ ] `FORCE_TEST_ADS` → `false` in `src/lib/ads.ts` — fine, arguably better, to leave `true` through testing (no real ad traffic against the account while 12 people poke at it)
- [ ] AdMob UMP/GDPR consent flow: `requestConsentInfo()` / `showConsentForm()` at startup — Google's consent requirement is about serving real personalized ads; AdMob test mode doesn't trigger it
- [ ] AdMob console: update the app entry's package name to `com.maritimegaming.armada` (before it links to the Play listing)
- [ ] AdMob console: create the GDPR consent message, privacy URL `https://armada.maritimegaming.com/privacy`
- [ ] AdMob console: switch ads from test to live (pairs with `FORCE_TEST_ADS`)
- [ ] Publish `app-ads.txt` at the site root (AdMob authorized-sellers file) — good hygiene, not a gate either way

**After the 14 days**
- [ ] Apply for production access → Google review (~7 days)
- [ ] Do the "NOT required" items above, then rebuild the AAB with real ads on
- [ ] Promote to production → first-app review (days–2 weeks)

---

## 1. App identity (single source of truth)

| Field | Value |
| --- | --- |
| App name (Play listing, ≤30 chars) | `Armada` |
| Package / applicationId | `com.maritimegaming.armada` |
| Developer / publisher name | Maritime Gaming |
| Support email | `contact@maritimegaming.com` |
| Privacy policy URL | `https://armada.maritimegaming.com/privacy` |
| Website (optional) | `https://armada.maritimegaming.com/` |
| Default language | en-US |
| App or game | Game |
| Category | Board (alt: Strategy) |
| Free or paid | Free |
| Contains ads | Yes (rewarded video, AdMob) |
| In-app purchases | No |
| Current versionCode / versionName | `1` / `1.0` |
| Min / target / compile SDK | 24 / 36 / 36 |
| AdMob App ID | `ca-app-pub-1765694427918098~8079521716` |

targetSdk 36 clears Google Play's "new apps must target API 35+" bar for 2025.

---

## 2. Pre-submission audit

### Blockers — fix before uploading a production build

1. **`FORCE_TEST_ADS = true` in [`src/lib/ads.ts:22`](src/lib/ads.ts).**
   Every ad request is currently forced to serve a Google test ad. A
   production build with this left on shows only test ads to real users
   (zero revenue) and serving test ads in a public release is against
   AdMob policy. Flip to `false` for the release build. There's already a
   `TODO(publish)` on it.

2. **No GDPR / UMP consent flow for ads.** Nothing in the codebase calls
   the User Messaging Platform (`AdMob.requestConsentInfo()` /
   `AdMob.showConsentForm()` from `@capacitor-community/admob`). Google's
   consent policy requires a certified CMP to gather consent from users in
   the EEA, UK, and Switzerland before serving personalized ads; without
   it AdMob will throttle or stop serving ads to those regions and it's a
   policy violation. Minimum viable fix:
   - In AdMob console → Privacy & messaging → create a **GDPR** message
     (and an **IDFA/US-state** message if desired) for the app.
   - At app startup, before the first ad request, call
     `AdMob.requestConsentInfo()` → `AdMob.showConsentForm()` when
     `isConsentFormAvailable && status === 'REQUIRED'`.
   - This is independent of the Play Console forms below but should land
     in the same release.

3. **Store graphics don't exist yet.** See §4 — 512×512 icon, 1024×500
   feature graphic, and ≥2 phone screenshots are all required to submit.

### Should-fix / decisions

4. **Testing-track requirement.** If the Play Console account is an
   **individual** account created after 2023-11-13, Google requires a
   closed test with **≥12 testers opted in for ≥14 continuous days**
   before you can promote to production. Org accounts are exempt. Confirm
   which this is — it changes the timeline by ~2+ weeks. Plan the first
   upload as a **Closed testing** release either way; it's the safe path.

5. **Data Safety must declare the Advertising ID.** `play-services-ads`
   (pulled in by `@capacitor-community/admob`) merges
   `com.google.android.gms.permission.AD_ID` into the manifest
   automatically at targetSdk 33+, even though it's not in
   [`AndroidManifest.xml`](android/app/src/main/AndroidManifest.xml)
   source. The Data Safety form (§6) already accounts for this.

6. **`android:allowBackup="true"`** (default) in the manifest. Harmless
   for a localStorage-only game with no secrets, but consider setting it
   `false` to keep auto-backup from carrying stale game state between
   devices. Optional.

### Verified OK

- Privacy policy is live, standalone, reachable without app history, and
  covers ads + on-device storage. Effective date current.
- Keystore material (`armada-upload.jks`, `keystore.properties`,
  `android/keystore.properties`) is git-ignored and not tracked.
- Release signing config wired in [`android/app/build.gradle`](android/app/build.gradle);
  falls back to debug-signed if props absent.
- `minifyEnabled false` — fine (no obfuscation needed; keeps stack traces
  readable).
- No IAP, no account system, no analytics SDK, no crash reporter, no
  location/camera/contacts/mic permissions. Only `INTERNET` in source.
- IARC content: cartoonish letter-grid Battleship; explosions and weapon
  names (MOAB, torpedo, mine) but no characters, blood, gore, or
  depictions of violence against people. Rating should land at
  Everyone / PEGI 3 / ~7+ (see §5).

---

## 3. Store listing copy

### Title (≤30)
```
Armada
```

### Short description (≤80)
```
Sink the hidden enemy fleet before they sink yours. Battleship, reimagined.
```
(74 chars.)

Alternate:
```
Fast naval strategy: hunt the enemy fleet, manage the oil slick, drop a MOAB.
```
(76 chars.)

### Full description (≤4000)
```
Armada is Battleship stripped of the busywork and rebuilt around the good part:
the hunt. No ship-placement chores, no leveling grind, no story to sit through —
just you against a genuinely sharp opponent, one grid at a time. It's the kind of
game you keep on your phone for the rest of your life, next to Solitaire and
Minesweeper.

WHAT'S DIFFERENT

• No setup. Both fleets are placed instantly. You're taking your first shot two
  seconds after tapping New Game.

• A real opponent. One computer player, always playing its best — it hunts
  wounded ships intelligently, presses its advantage, and manages the oil slick
  just like you do. There's no "easy mode" to pad your win rate against.

• The oil slick. Sink the Oil Tanker and its cargo spreads across the board, one
  cell a turn. Every shot into the slick might ignite it and take out everything
  underneath — yours or theirs. Do you let it spread for a bigger payoff, or
  strike before your opponent lights it up under your fleet?

• Six special weapons, three per game. MOAB (blast a 3×3 square), Mine (drifts
  every turn until it finds a hull), Torpedo / Rocket / Harpoon (streak across a
  row, column, or diagonal, hitting everything in the lane), and the Drone
  (reveals the fog without firing a shot). Which three you get is randomized each
  game, so the tactics shift every time.

• Ship immunities. A Submarine shrugs off a MOAB. A Helicopter dodges a torpedo.
  Knowing what beats what is its own layer of strategy.

• Optional single-cell ships. Turn the Ensign, Helicopter, and Lifeboat on for a
  brutal pure-luck endgame, or leave them off for a cleaner match.

• Lifetime stats and a Daily Win Streak to chase.

FAIR BY DESIGN

Armada is free and works fully offline. It has no forced ads and no in-app
purchases. The only ads are optional rewarded videos: watch one, by your choice,
to top up weapon charges or start an extra game — the app never shows an ad
without asking first. No account, no sign-up, nothing about you leaves your
device.

Weigh anchor.
```
(~1,850 chars. Trim or expand as needed.)

### "Recent changes" (release notes, first release, ≤500)
```
First release. Weigh anchor.
```

### Store listing tags / keywords
Play uses the description text for search, not a keyword field, but pick up to
5 in-console tags from: Board games, Strategy, Single player, Casual, Offline.

---

## 4. Graphic assets

| Asset | Spec | Source | Status |
| --- | --- | --- | --- |
| App icon | 512×512, 32-bit PNG, ≤1 MB | downscaled from `assets/icon.png` | **Done** → `store-assets/icon-512.png` |
| Feature graphic | 1024×500, PNG or JPG, no alpha | new design (canvas) | **Done** → `store-assets/feature-graphic-1024x500.jpg` |
| Phone screenshots | 2–8 images, PNG/JPG, 16:9 or 9:16, each side 320–3840 px | capture from device | **TODO — capture on device** |
| 7" tablet screenshots | optional, same rules | — | skip (portrait phone game) |
| 10" tablet screenshots | optional | — | skip |
| Promo video | optional YouTube URL | — | skip for v1 |

`store-assets/icon-512.png` and `feature-graphic-1024x500.jpg` are ready to
upload as-is. The feature graphic is generated programmatically — the
source is reproducible; regenerate by restoring the canvas script if the
tagline or art needs to change.

### Screenshots — capture on a device / emulator

Browser-preview screenshots come out scaled and letterboxed; capture the
real thing from the running Android build at native resolution instead:

```bash
npm run cap:sync && cd android && ./gradlew installDebug
```
Then, with the app open on a connected device or emulator (portrait):
```bash
adb exec-out screencap -p > store-assets/screenshot-1.png
```

Shot list (aim for 4–6, portrait):
1. Title screen (`title-screen.jpg` art + PLAY).
2. Mid-game: enemy board with fog of war, a few hits (orange) and misses.
3. A weapon armed — crosshair cursor on the enemy grid, weapons bar lit.
4. Oil slick spread across the board (sink the Oil Tanker first).
5. A MOAB or Torpedo blast resolving.
6. Victory dialog with the end-of-game green ship reveal, or the
   Statistics dialog showing the Daily Win Streak.

Google displays the first 3–4 most prominently — lead with 1, 2, 4.

#### Editing screenshots — what's allowed

Google's Metadata / screenshot policy requires that screenshots
**truthfully represent the actual in-app experience**. Within that:

**Allowed (and encouraged):**
- **Cropping out the status bar and the system navigation bar.** Standard
  practice — most polished listings do it. To get a clean capture:
  ```bash
  adb shell settings put global policy_control immersive.full=*
  # capture your shots, then restore:
  adb shell settings put global policy_control null
  ```
  or just crop the top/bottom strips in any image editor afterward.
- Placing the capture on a **background** (a navy gradient matching the
  app looks good), adding a **device frame**, and a **short caption**
  (2–4 words: "No setup. Just play.", "Manage the oil slick", "Six
  weapons, three per game").
- Light color grading / scaling to a standard size (e.g. 1080×1920 or
  1284×2778).

**Not allowed:**
- Fabricated or mocked-up UI, features the app doesn't have, content not
  actually in the app.
- Fake ratings, "Editor's Choice"/award badges you didn't receive,
  fake install counts.
- Misleading or deceptive overlay text; blurry or low-quality images.

**Size limits (enforced):** each side 320–3840 px, and the long side no
more than 2× the short side. A 9:16 crop (e.g. 1080×1920) is safely
within that; don't crop so hard it goes past 1:2.

Capture in a recent build; `FORCE_TEST_ADS` doesn't matter for
screenshots since rewarded ads are opt-in and never appear in gameplay.

The in-APK launcher icon (adaptive: `ic_launcher_foreground` /
`_background`) is already generated under
`android/app/src/main/res/mipmap-*` and is separate from the 512×512
listing icon above.

---

## 5. Play Console: create the app

**All apps → Create app.**

- App name: `Armada`
- Default language: English (United States) – en-US
- App or game: **Game**
- Free or paid: **Free** (this is permanent once you have installs)
- Declarations: check the Developer Program Policies box and the US
  export laws box.

After creation you land on the **Dashboard** with a "Set up your app" and
"Create a production release" checklist. Work the "Set up your app"
section first (§6), then the release (§7).

---

## 6. Play Console: "Set up your app" — every form

### 6.1 App access
Select **All functionality is available without special access**. No login,
no gated areas.

### 6.2 Ads
- Does your app contain ads? → **Yes**.

### 6.3 Content ratings (IARC questionnaire)
Start the questionnaire. Email: `contact@maritimegaming.com`. Category:
**Game**.

Recommended answers:
| Question | Answer |
| --- | --- |
| Violence — cartoon/fantasy or realistic? | The game has **mild, non-realistic combat** (abstract grid, no characters shown). If asked "does the game contain violence": you may answer **No** in the strict sense (no depiction of a person/creature being harmed) — the "combat" is tapping grid cells. If the questionnaire's violence definition seems to fit the explosions/weapon theme, answer **Yes → cartoon/fantasy, not realistic, no blood**. |
| Blood / gore | No |
| Sexual content, nudity | No |
| Profanity / crude humor | No |
| Controlled substances (drugs, alcohol, tobacco) | No |
| Gambling — real or simulated | No |
| Simulated gambling | No |
| User interaction / user-generated content / shares location | No |
| Digital purchases | No |
| Does the app contain ads? | Yes |

Expected outcome: **Everyone (ESRB) / PEGI 3 / USK 0 / IARC 3+**, possibly
Everyone 10+ if you answered Yes to cartoon violence. Either is fine.

### 6.4 Target audience and content
- Target age groups: select **13–15, 16–17, 18 and over**. Do **not**
  select any under-13 band — the privacy policy states the app is not
  directed to children under 13, and staying out of the under-13 bands
  keeps Armada clear of the Play Families policy (which would forbid the
  standard AdMob SDK and demand a Google-certified ads SDK).
- "Do you want your app in the Designed for Families program?" → **No**.
- Appeal to children: **No** — abstract strategy game, no
  child-oriented characters or themes.
- Store presence for under-13: N/A after the above.

### 6.5 Data safety
Answers below reflect: no first-party collection, no server, localStorage
only; Google AdMob SDK collects the Advertising ID and related signals for
ads. Follow AdMob's published Data Safety guidance
(support.google.com/admob/answer/11150250).

**Does your app collect or share any of the required user data types?** →
**Yes** (because of the ads SDK).

**Data types — Device or other IDs:**
- Collected: **Yes**
- Shared: **Yes** (AdMob/Google acts as a third party for ad serving)
- Processed ephemerally: No
- Required or optional: **Required** (users can't opt out of the data type
  itself; they can opt out of *personalization*)
- Purposes: **Advertising or marketing**, **Analytics**

**Other data types** (App activity, App info & performance, Location,
Personal info, Financial info, Messages, Photos, Contacts, Calendar,
Files, Audio, Health, etc.): **not collected**.
- Note on location: AdMob may infer coarse location from IP for ad
  serving. Per Google's Data Safety guidance, IP-derived coarse location
  used only transiently for ad delivery does **not** need to be declared
  as a "Location" data type. Declare only **Device or other IDs** unless
  you later add location-targeted features.

**Security practices:**
- Is data encrypted in transit? → **Yes** (HTTPS; AdMob uses TLS).
- Can users request data deletion? → **No dedicated mechanism.** Provide
  the explanation: no account exists; on-device data is cleared by
  uninstalling or clearing storage; ad-ID reset is controlled in Android
  system settings. (There's no "delete my data" URL to give because there
  is no server-side data.)
- Committed to Play Families policy? → N/A (not a Families app).
- Independent security review? → No.

Cross-check the final Data Safety summary against the wording in
[`src/pages/Privacy.tsx`](src/pages/Privacy.tsx) so the listing and the
policy agree.

### 6.6 Government apps
**No.**

### 6.7 Financial features
**My app doesn't provide any financial features.**

### 6.8 Health
**No health content.**

### 6.9 Advertising ID declaration (Play Console → App content)
- Uses advertising ID? → **Yes**
- Purpose: **Advertising or marketing** (and Analytics if you want AdMob
  reporting to line up). This must match §6.5.

### 6.10 News app
**No.**

### 6.11 COVID-19 contact tracing / status
**No.**

---

## 7. Play Console: store listing + release

### 7.1 Store listing (Grow → Store presence → Main store listing)
- App name: `Armada`
- Short description: §3
- Full description: §3
- App icon / feature graphic / phone screenshots: §4
- App category: **Game → Board** — see the category note below
- Tags: choose up to 5 from the fixed list Play offers for the category
  (look for: Battleship, Board, Turn-based, Single player, Offline,
  Casual, Strategy)
- Store listing contact: `contact@maritimegaming.com`, website
  `https://armada.maritimegaming.com/`
- External marketing: leave "show this app in ads outside Google Play" as
  you prefer (default on is fine).

### 7.2 Store settings
- App category: Game / Board
- Manage tags: as above
- Email + (optional) phone + website
- Google Play for Education: opt out

#### Category note — Board vs Strategy

Google does **not** publish precise definitions. The authoritative source
is the Play Console Help article *"Choose a category and tags for your app
or game"* plus the fixed tag list Play shows you in-console once a
category is chosen. The game categories are broad genre buckets:

- **Board** — digital board games and board-game-like mechanics: chess,
  checkers, dominoes, Ludo, Monopoly-likes, and grid games like
  Battleship. Physical Battleship is a Hasbro *board game*, and most
  stores shelve Battleship-style titles here.
- **Strategy** — games built around planning and skillful thinking: RTS,
  4X, tower defense, turn-based tactics. Dominated by large live-service
  titles (Clash of Clans, Rise of Kingdoms, etc.).

Armada honestly fits either. Recommendation: **Board**, because —
1. Battleship heritage puts it there by convention.
2. Board is a smaller, less saturated category than Strategy, so a niche
   indie game has better odds of charting and being browsed.
3. Armada's design is explicitly an "evergreen time-waster" with no
   leveling or base-building (see `GAME_DESIGN.md`), which matches the
   Board/casual audience's expectations, not the Strategy audience's.

The category is not permanent — you can change it later with no penalty,
and tags carry more discovery weight than the single category anyway.

### 7.3 App signing
Use **Play App Signing** (default for new apps). Google holds the app
signing key; `armada-upload.jks` is your **upload key**. On first release,
either let Google generate the app signing key (recommended) or opt to
upload your own. Keep `armada-upload.jks` + `keystore.properties` backed
up off-machine — losing the upload key is recoverable (Google can reset
it); losing it with no Play App Signing is not.

### 7.4 Build the release AAB
```bash
npm test
```
Then, with `src/lib/ads.ts` `FORCE_TEST_ADS` set to `false` and the
consent flow (audit item 2) in place:
```bash
npm run cap:sync
```
```bash
cd android && ./gradlew bundleRelease
```
Output: `android/app/build/outputs/bundle/release/app-release.aab`,
signed with the release key from `keystore.properties`.

Bump `versionCode` in [`android/app/build.gradle`](android/app/build.gradle)
for every subsequent upload (`1` → `2` → …); `versionName` is cosmetic.

### 7.5 First release — Closed testing (REQUIRED, this is an individual account)

**Confirmed:** the Play Console account is an individual account, so the
closed-testing requirement applies. Google will not let you create a
production release until you've completed it.

**The rule (Google Play policy for personal developer accounts created on
or after 2023-11-13):**
- Run a **closed testing** track for your app.
- Have **at least 12 testers opted in**, and keep them opted in for **at
  least 14 continuous days**.
- Those two conditions must be met *simultaneously* — Play Console shows a
  progress meter ("X of 12 testers", "day Y of 14"). If your opted-in
  count drops below 12, the 14-day counter stops making progress until
  you're back to 12.
- After the 14 days, an **"Apply for production access"** form unlocks.
  It's a short questionnaire: how you recruited testers, how testing
  went, what feedback you received, why the app is ready. A Google
  reviewer (a human) reads it — answer specifically, not with one-liners.
- Review of that application typically takes up to ~7 days. Only after
  it's approved can you promote to Production.

**What counts as a "tester":**
- 12 **distinct Google accounts**, not 12 devices and not your own account
  on multiple profiles. Google can detect self-testing.
- Each tester must **join through the opt-in link** (a web URL, or a Play
  Store link for the closed track) and **install the app**. Just being on
  the email list isn't enough — they have to opt in.
- Testers should ideally actually open and use the app during the window.
  Engagement isn't a hard numeric gate the way count/duration are, but the
  production-access reviewer asks about feedback, so real usage helps.

**Practical plan — start recruiting testers now, in parallel with
everything else:**
1. Build a list of 12+ people (friends, family, coworkers, Discord/Reddit
   communities). Collect their Gmail addresses.
2. In Play Console: **Testing → Closed testing → create a track** (or use
   the default "Closed testing – Alpha" track) → **Testers** tab → create
   an email list or link a Google Group, add all the addresses.
3. Upload the AAB as a release on that track, add release notes (§3), roll
   it out.
4. Send each tester the **opt-in URL** (Testers tab → "Copy link"). Ask
   them to open it, tap "Become a tester", install from Play, and open the
   app at least once.
5. Watch the progress meter. Day 1 of 14 starts once you have 12 opted in.
6. If turnout is thin, tester-exchange communities (e.g. r/AndroidTesters,
   the "12 testers" subreddits/Discords, or a paid service) exist
   specifically for this requirement.
7. After 14 days at ≥12: **Apply for production access**, fill in the
   form, wait for review.

### 7.6 Production release (after closed-testing access is granted)
- Promote the tested build: **Testing → Closed testing → Promote release
  → Production**, or create a fresh Production release with a new
  `versionCode`.
- Countries/regions: select all, or start small.
- Release notes: §3.
- Consider a **staged rollout** (e.g. 20%) for the first launch.
- First-time app review by Google can take several days up to ~2 weeks,
  separate from the production-access review above.

---

## 8. Decisions & open questions

**Decided:**
- Account is **individual** → closed testing (§7.5) is required before
  production. Start recruiting 12 testers now, in parallel.
- Category: **Board** (§7.2). Revisit later if it doesn't chart.

**Still open:**
1. Are you set up to configure the **GDPR consent message in AdMob** and
   land the UMP SDK calls before first release (audit item 2)? This is the
   one real code task still outstanding for monetization compliance.
2. Confirm `contact@maritimegaming.com` is monitored — Google and users
   both use it.
3. Screenshots: capture 4–6 on a device per §4 and drop them in
   `store-assets/`.

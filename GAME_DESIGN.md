# Armada — Game Design Philosophy

This document captures the design intent behind Armada so that anyone (or any
AI session) working on this codebase understands *why* the game works the way
it does, not just *how*. It exists because several design choices look like
bugs or oversights if you don't know the reasoning behind them.

Core game logic lives in [`src/lib/armada-game.ts`](src/lib/armada-game.ts);
UI/state wiring lives in [`src/pages/Index.tsx`](src/pages/Index.tsx). Note
that [`AGENTS.md`](AGENTS.md) is leftover generic Nostr-client boilerplate
from the template this project started from — it is not specific to this
game and should not be treated as a source of design intent.

## Core philosophy: playability over realism

Given a choice between realistic naval-warfare simulation and fun gameplay,
this project always chooses fun. Two examples already in the code:

- **Diagonal ships are physically longer than horizontal/vertical ones.**
  A ship placed diagonally spans `length × √2` the on-screen distance of the
  same ship placed straight, because what matters is that it occupies the
  same *number of cells*, not the physical distance between its endpoints.
  This is correct as implemented — do not "fix" it.
- **The oil slick is visible through fog of war** (see below), even though a
  realistic simulation would keep it hidden like everything else. The oil
  slick itself is already a fantastical mechanic (volatile oil that can
  chain-detonate a fleet), so there's no realism left to protect by hiding it.

If a future change would make the game more realistic at the cost of being
less fun or less clear to the player, don't make it. If it makes the game
more fun at the cost of realism, that's the correct tradeoff.

## Game setup: no manual ship placement

Most Battleship games spend real time having the player place ships before
each match. That setup time is mostly wasted because ship placement has very
little strategic value — the game plays out almost the same regardless of
where ships are placed. So in Armada, **both navies are placed randomly by
the app** before play begins (`placeShips()` in `armada-game.ts`). There is
no manual placement UI, and none should be added — it would be busywork, not
gameplay.

## Game progression: this is not a leveling game

Most mobile games (as a genre, not just Battleship clones) have a model of
increasing difficulty/complexity as the player "progresses" — unlocking new
content, leveling up, being rewarded for milestones. **Armada deliberately
does not work that way.** Every round has the same number of ships, the same
ship sizes, and the same targeting mechanics. There is no epic arc to
discover.

Armada belongs to the "evergreen time-waster" genre — the same category as
Solitaire, Minesweeper, or Wordle — not the "level up and unlock stuff"
genre most mobile games default to. Future work should not try to bolt on
XP, unlockable levels, or escalating difficulty tiers as a core structure.
Variety instead comes from the **variables** below, which change the texture
of a given round without changing its fundamental difficulty or structure.

## Variable A: Computer opponent strategy

The computer's "difficulty" isn't really about the computer being smarter in
a deep sense — it's about how efficiently it converges on sinking the
player's fleet, which affects who finishes first.

**Implemented today** (`selectAppTargetIndex()` in `armada-game.ts`,
selectable in Settings, persisted to localStorage):
- **Level 1**: Pure random targeting across all untargeted cells — including
  when it decides to fire a special weapon (Variable D): the weapon just
  rides along with wherever the normal random target would have landed,
  same as if no weapon had been picked at all.
- **Level 2**: If a ship has exactly one hit that isn't yet sunk, target its
  (8-neighbor, including diagonal) adjacent cells to find the rest of it.
  Once **two or more** hits land on the same ship, its position is fully
  known — it's a straight line — so targeting switches to just that ship's
  own remaining untargeted cells instead of guessing via adjacency, which
  would otherwise waste shots perpendicular to the ship's actual line. This
  naturally bounds the search to the ship's true length without needing a
  separate min/max heuristic, and handles gaps correctly too (e.g. cells 0
  and 2 hit but not 1, from a MOAB or scattered random shots) since it
  simply targets whichever of the ship's own cells are still untargeted,
  in any order. See `hitIndexesByShipCode` in `selectAppTargetIndex()`.
  This same "play shrewdly" character now also covers
  weapon use: whenever Level 2 decides to fire a MOAB, Mine, Torpedo, or
  Rocket, it picks whichever untargeted cell maximizes that weapon's
  "blast zone" — the count of still-untargeted cells within its footprint
  (the 8-neighbor adjacency for MOAB/Mine, or the up-to-5 cells it would
  travel through for Torpedo/Rocket; see `getWeaponBlastZoneIndexes()` and
  `selectAppWeaponTargetIndex()`) — breaking ties randomly. This reorders
  the turn's decision: weapon choice (`selectAppWeaponChoice()`) now
  happens *before* target selection, since the target search only makes
  sense once the weapon (and therefore the footprint shape) is known.
  Weapon-aware play was originally sketched below as a separate, later
  difficulty tier, but landed as part of Level 2 instead: introducing a
  third rung risked a distinction most players couldn't articulate ("hunts
  ships but wastes MOABs" vs. "hunts ships and uses them well"), where
  folding it into Level 2 keeps the story simple — Level 1 is chaos in
  every decision, Level 2 is shrewd in every decision.

**Proposed future levels** (not yet implemented):
- **Oil-slick-aware play**: prioritize sinking the Oil Tanker early, then
  deliberately let the slick spread as wide as possible before trying to
  ignite it (mirrors the human's own best strategy — see Variable B).
- **Outright cheating**: e.g. a flat 25% chance per shot that the computer
  looks at the true board state and targets a cell it knows contains a ship.
  The player would experience this as "the computer seems better," without
  it being obvious that it's cheating. This is an accepted, common technique
  in single-player mobile games (rubber-banding) and is not considered
  unfair or out of bounds for this project — it's a legitimate lever, just
  not implemented yet.

## Variable B: The Oil Slick

The Oil Tanker (code `O`, part of `BASE_SHIPS`, always included in every
game) is a 3-cell ship. Sinking it triggers an oil slick:

- The slick starts at the tanker's wreck cells and **spreads by one
  untargeted adjacent cell per turn** (`spreadOilSlick()`).
- Targeting an oil-covered cell has a **1-in-12 chance to ignite** the slick
  (`OIL_IGNITION_ODDS`), which chain-detonates every remaining untargeted
  oil cell at once, then extinguishes the slick.
- **The oil slick is visible on both boards regardless of fog-of-war state**
  (`getCellPresentation()` checks oil before the hidden/unknown branch). This
  is intentional, per the core philosophy above — realism would hide it, but
  gameplay is better when the player can see the slick creeping across the
  board and has to make a real timing decision about it.

This creates the game's main timing/risk metagame: if you sink the Oil
Tanker early, the rest of the round becomes partly about *managing* the
slick — you want it to cover as much of the grid as possible before it goes
off (more coverage = more chance of taking out enemy ships), but waiting too
long risks your opponent igniting it on *your* fleet first via a lucky
strike.

## Variable C: Single-cell ships

Optional ships — Ensign (`E`), Helicopter (`H`), Lifeboat (`L`), all
1-cell — toggleable via the "Singles (E H L)" setting (`includeSingles`,
default on, persisted to localStorage). Unlike multi-cell ships, there is no
strategy that improves your odds of finding a single-cell ship: you can sink
every other ship in the enemy fleet and still be reduced to pure luck to
land the final blow on the last single-cell ship.

The one exception is the oil slick (Variable B): once it has spread across
enough of the board, any shot into the slick carries a chance of igniting
it and catching whatever single-cell ships happen to be sitting under the
oil at that moment. This is the only lever that gives a player *some*
influence over an otherwise pure-luck endgame — worth keeping in mind when
tuning either mechanic, since they're designed to interact.

## Variable D: Additional weapons

**Implemented today:**
- **MOAB (Mother of All Bombs)** (`fireMoab()`/`getMoabTargetIndexes()` in
  `armada-game.ts`): targets one cell plus its 8 neighbors (up to 9 cells
  total), clipped at grid edges — firing at a corner only resolves 4 cells,
  not 9. Already-targeted cells within that blast are left alone rather than
  reprocessed. Replaces the player's regular shot for the turn (see Turn
  economy below). Weapon charges are a standing inventory, not part of a
  round: `moabCount` lives in its own `localStorage` key (`Index.tsx`),
  separate from `GameState`, starting at `MOAB_STARTING_COUNT` (2) the very
  first time someone plays. Firing decrements it by one, and it is
  deliberately untouched by New Game or the ship-set toggle — the only way
  it goes up is the refill flow below. Sound is always a double
  "explosion" cue with a brief pause between them (distinct from the oil
  slick's triple-explosion ignition cadence), regardless of whether
  anything was hit, plus any sink/single-ship cues layered on top — unless
  the blast also ignites the oil slick, in which case the ignition's own
  triple-explosion sequence takes over instead of stacking two cadences.

- **Mine** (`resolveMineHit()`/`moveMine()` in `armada-game.ts`): only one
  may be active at a time — the Mines button disables itself while
  `GameState.playerMineIndex` is non-null. Firing it at an untargeted cell
  runs the normal targeting sequence there (splash, or explosion/sink if
  occupied) and always costs one charge and one quota dot, same as MOAB. If
  that placement shot was a *hit*, the mine is spent immediately — nothing
  further to activate. If it was a *miss*, a mine is planted at that cell
  (`playerMineIndex` is set); no further charge/quota cost is ever taken
  for it again.

  A Mine detonation always takes out **two** cells of whatever ship it
  hits, not one: the impact cell, plus the nearest other still-untargeted
  cell of that same ship (`findNearestUntargetedShipCell()`), measured by
  position along the ship rather than raw grid distance — so it can (and
  does) skip past cells that are already hit to reach the closer
  *untargeted* one. This was a deliberate buff — the Mine's single-cell hit
  was judged too weak next to the other weapons. Boundary cases fall out of
  that one rule for free, with no extra logic needed: a single-cell ship
  gets no bonus (there's no other cell to reach); a ship with only one
  other untargeted cell left is sunk outright by a single Mine; and a ship
  hit somewhere in the middle with no prior hits ties between its two
  neighbors, broken randomly. The bonus cell gets its own independent
  oil-ignition roll, same as any other hit — a Mine can now trigger two
  separate ignition chances in one detonation. This applies identically
  whether the Mine detonates from a direct drop or from its automatic
  wander (below); both funnel through the same `resolveMineHit()`.

  On every later turn the player takes (any shot or weapon, not just
  another mine), the active mine automatically moves to one adjacent cell
  first (`selectMineWanderIndex()`, silently, before the turn's own action
  resolves) — clipped at grid edges. This isn't a uniformly random walk:
  with probability `MINE_WANDER_UNTARGETED_BIAS` (75%), it moves to a
  random still-*untargeted* neighbor if at least one exists, only falling
  back to a uniformly random neighbor (targeted or not) the other 25% of
  the time, or whenever every neighbor is already targeted. This was a
  deliberate second buff, on top of the double-detonation above — a pure
  random walk too often just re-treaded cells everyone already knew about.
  It's weighted rather than an absolute "always chase untargeted" rule
  for a specific reason: an absolute rule would let the mine greedily fix
  on whatever small local pocket of untargeted cells it's already next to,
  never willing to cross a stretch of already-targeted ground to reach a
  completely different, richer unexplored region elsewhere on the board.
  The occasional "wrong" move is what lets it break out of a dead end.

  A move only *detonates* if the new cell is both untargeted and occupied
  (see the double-detonation above), consuming the mine and re-enabling
  the button. Otherwise, if the new cell is still untargeted and empty,
  it's silently marked targeted anyway (no sound, exposure flipped to
  `known` same as a normal miss reveal) even though nothing was actually
  fired there: the mine quietly rules the cell out, so the player doesn't
  have to spend a shot confirming what it already found. Landing on a cell
  that's already targeted is a true no-op - completely untouched, nothing
  to reveal that isn't already known. This silent reveal deliberately
  bypasses the normal targeting pipeline (a raw cell update, not
  `resolveTargetingSequence`), which is *why* a mine's movement can still
  never ignite the oil slick by itself, preserving the original principle
  that shaped this: only an actual hit (always a real ship cell) ever
  risks ignition, never a passive reveal.

  The Helicopter is the one occupied cell a mine's wander can never
  resolve either way, hit or reveal - it drifts past completely
  undetected, exactly as airborne implies, leaving that cell's
  `untargeted`/`unknown` state entirely alone, same as if nothing were
  there at all.

  A debug aid for validating this during development: any cell currently
  holding a mine renders an asterisk (alone if the cell is still hidden by
  fog of war, appended to whatever the cell would otherwise show if it's
  visible) - see the `hasMine` plumbing through `NavyPanel`/`GridCell`/
  `getCellPresentation` in `Index.tsx`.

- **Torpedo and Rocket** (`fireTorpedo()`/`fireRocket()` in
  `armada-game.ts`, both thin wrappers around a shared `fireTravelingWeapon()`
  engine): direct counterparts differing only in orientation - Torpedo
  travels horizontally, Rocket vertically - so they're documented together.
  Rocket replaced an original "Gravity Bomb" concept - dropped at the top
  of a column, travels down until it hits an active ship - with the exact
  same mechanic as the Torpedo, just turned 90 degrees.

  Either can be launched at any untargeted cell, unlike that edge-only
  concept originally sketched for Gravity Bomb. It always travels exactly
  `WEAPON_TRAVEL_DISTANCE` (5) further cells - Torpedo rightward from
  columns 0-4 and leftward from columns 5-9; Rocket downward from rows 0-4
  and upward from rows 5-9 - regardless of whether the launch cell (or any
  cell along the way) was a hit. This replaced an earlier "stop at the
  first hit" version of the Torpedo: in practice the very first or second
  cell was a live ship often enough that the travel animation rarely got
  to play, which defeated the point of it. Fixed-distance means a single
  shot can now hit more than one ship. Along the way, cells already
  targeted (miss, hit, or sunk) are passed over untouched, an untargeted
  empty cell is silently marked targeted (no sound, matching the request
  that the whole run shouldn't play a splash per cell), and every
  untargeted occupied cell detonates (a normal hit, including its own
  independent oil-ignition odds). Costs one charge and one quota dot up
  front, at launch, regardless of how many cells it crosses or how many
  ships it hits. Given the board is 10 wide/tall and the direction split
  falls exactly at index 4/5 on whichever axis, the 5-cell run is never
  actually clipped by the edge - every launch position has exactly 5 valid
  cells in its travel direction.

  The travel is animated one cell at a time (`runWeaponTravelSteps()` in
  `Index.tsx`, shared by both weapons): each traveled cell lights up with
  the normal targeting highlight for `WEAPON_TRAVEL_STEP_DELAY_MS` (500ms)
  before resolving and moving to the next, so a shot reads as a wave
  sweeping across the row or column rather than an instant reveal. Because
  that always takes a few seconds (5 steps at 500ms each, on top of the
  instant launch resolution), turn ownership deliberately does *not* pass
  to the other side until the whole sequence finishes - unlike every other
  weapon, which hands off the turn the instant it resolves. Otherwise the
  computer's own turn could start firing mid-animation. `isWeaponInFlight`
  (player) and `appWeaponInFlightRef` (computer) exist solely to block
  input/re-entry during that window, shared by both weapons since only one
  can ever be traveling for a given side at a time.

**Not yet implemented:**
- **Surveillance Drone**: reveals a cell, a 3x3 block, a full row, or a full
  column, without targeting any of it.

### Turn economy

**Firing MOAB, Torpedo, Rocket, or the Drone replaces your regular shot
for that turn** — it's an alternative action, not a bonus one. This
keeps weapons a meaningful resource-management choice (use it now vs. save
it) rather than a strictly-additive power boost.

**The Mine is the odd one out.** Placing a mine is itself a turn-consuming
action, same as the other weapons above. But once placed, its automatic
one-cell wander on every later turn is *not* something the player (or the
computer) "fires" — it just happens, passively, alongside whatever regular
shot or weapon is used that turn. This mirrors how the oil slick spreads by
one cell every turn regardless of what else happens (see Variable B) — both
are background world-state advancing independently of the player's chosen
action for the turn, rather than a discrete "shot" that competes with it.

### Per-game weapon quota

Ads make the standing inventory effectively unlimited over enough sessions,
which would otherwise let a patient player wallpaper most of the enemy
grid for free (four un-overlapped MOABs alone reveal ~36 of 100 cells).
The fix is a hard, separate cap: **`SPECIAL_WEAPON_QUOTA` (4) total special
weapon shots per side per game, across all weapon types combined** —
independent of how many charges are sitting in inventory. `playerWeaponsUsed`
tracks this on `GameState` itself (unlike the standing inventory), so it
resets to 0 every New Game while the inventory carries over untouched. This
is what decouples "grind ads to build a deep reserve" (fine, that's the
intended monetization loop) from "grind ads to win this particular match"
(not fine — capped regardless of reserve size).

Implemented for the player: the MOAB button (and the same per-cell
targetability check) also disables once the quota is hit, even with
charges left, and a small 2x2 grid of dots in a "My Weapons" bar tracks
it visually — solid green per unused shot, turning red as each is spent,
no text needed.

The weapons bar is split into two (`WeaponsBar` in `Index.tsx`, one per
side) precisely so this display is symmetric: a matching "Enemy Weapons"
bar shows the computer's own MOAB count (`appMoabCount`, starting at
`APP_MOAB_STARTING_COUNT` (2) each game, unlike the player's ad-driven
standing inventory) and its own quota dots (`appWeaponsUsed`). The
computer's MOAB button is wired permanently disabled
(`moabButtonDisabled` hardcoded `true`) — it's display-only, information
for the player about what the computer *could* still use, not a control.

The computer's side of actually *firing* weapons is now implemented
(`selectAppWeaponChoice()` in `armada-game.ts`): once a target cell is
chosen for its turn, if it hasn't hit `SPECIAL_WEAPON_QUOTA` yet, there's
a flat 25% chance (`APP_WEAPON_USE_CHANCE`) it fires a special weapon
instead of a plain shot, picked at random from whatever's currently
available (skipping Mines while one is already active, and any weapon
whose standing count is 0). This is the "random cell, random timing"
version of the idea — purely random, not the more deliberate "2 of each
type, then random until the quota's spent" pacing that was originally
discussed. *Which* weapon fires is still random at both difficulty levels;
it's *where* it fires that now differs — Level 1 rides along with a plain
random target same as always, while Level 2 picks the target that
maximizes the weapon's blast zone (see Variable A's "weapon-aware play").

### One MOAB per side per game

On top of the shared `SPECIAL_WEAPON_QUOTA`, the MOAB specifically is
capped at **one use per side per game**, independent of both the quota and
standing inventory — a player who has procured a deep MOAB reserve still
only gets to fire it once per round. This exists because a single MOAB
already reveals up to 9 cells; stacking several in one game (which the
shared 4-shot quota alone wouldn't prevent, given enough charges) would
make Mines the only meaningfully-limited weapon and let MOAB spam dominate
a round. `playerMoabUsedThisGame`/`appMoabUsedThisGame` on `GameState`
track this (reset every New Game, like the quota counters), and
`selectAppWeaponChoice()` excludes MOAB from the computer's random pool
once its flag is set, so the cap applies symmetrically to both sides.

Communicated via a small dot on the MOAB button itself (both "My Weapons"
and the mirrored "Enemy Weapons" bar) — green while still available this
game, red once spent, reusing the same green/red idiom as the quota dots
rather than adding new visual language. The button disables once the dot
turns red, even with charges left in the standing inventory.

### UI direction: arm, then tap

Implemented for the MOAB, and the intended pattern for future weapons too:
weapon icons live in the bottom "Special Weapons" bar (`weaponsBar` in
`Index.tsx`), each showing a small remaining-count badge. Tapping an icon
*arms* that weapon — it's visibly highlighted/selected — and the Enemy Navy
grid's tap behavior temporarily switches from "fire a regular shot" to
"deploy this weapon" for the next tap on a legal cell, then disarms back to
normal. Tapping the armed icon again cancels back to a regular shot. As a
safety net, the armed state also clears automatically if the turn moves on
or the game ends without it being fired.

Two device-specific reinforcements of "you're about to place this weapon
right here," both keyed off `armedWeapon`, threaded down through
`NavyPanel` into `GridCell`:
- **Desktop**: the mouse cursor swaps to that weapon's own icon
  (`public/moab-cursor.svg`, `public/mine-cursor.svg`) over any legal
  target cell, replacing the plain crosshair cursor used for a normal shot.
  Same `cursor: url(...) 12 12, crosshair` mechanism the crosshair already
  used, just a different file chosen by `armedWeapon`.
- **Mobile** (and anywhere else without a hover cursor): while the player
  is pressing-and-holding the target cell (the existing preview-before-fire
  step), that weapon's icon renders inside the cyan preview highlight
  instead of the plain empty fill - the closest touch equivalent of a
  cursor, delivered at the one moment touch actually has an analogous
  state.

For the Torpedo and Rocket specifically, both the cursor and the mobile
preview icon are direction-aware, not a single fixed asset: the Torpedo's
arrow points right over columns 0-4 and left over columns 5-9
(`torpedo-cursor.svg`/`torpedo-cursor-left.svg`), the Rocket's points down
over rows 0-4 and up over rows 5-9 (`rocket-cursor.svg`/
`rocket-cursor-up.svg`) - mirroring exactly which direction that weapon
would actually travel from the hovered/pressed cell (see
`getWeaponTravelIndexes()`'s own column/row <= 4 split). `WEAPON_CURSOR_FILES`
and `WEAPON_PREVIEW_ICONS` (`Index.tsx`) hold a `{ default, flipped }` pair
per weapon - MOAB and Mine have no direction, so they only ever use
`default`. The weapons bar's own button icons are unaffected (still the
plain bidirectional `ArrowRightLeft`/`ArrowUpDown`), since a button has no
cell position to point a direction at - only `GridCell`'s cursor and
preview icon need to know which cell they're over.

This was chosen over two alternatives:
- **Right-click / long-press context menu on the cell itself**: doesn't
  translate to touch (no mobile equivalent of right-click), and if some
  future weapon were only legal on some cells, a per-cell menu means the
  player has to tap a cell just to discover what's available there — bad
  discoverability compared to seeing all weapon icons up front.
- **Drag-and-drop the weapon onto the grid**: more implementation cost
  (drag state, hit-testing, cancel-on-drag-away) for no real gameplay
  benefit, and generally less precise than tap-to-arm on small touchscreens.

Arm-then-tap also reuses the press-and-hold-to-preview / release-to-fire
interaction already built for regular shots
(`onCellPressStart`/`onCellPressEnd` in `Index.tsx`) — it's a third mode on
top of the same primitive, not a new gesture.

A hypothetical edge-restricted weapon should extend the existing per-cell
`isCellTargetable` computation to only mark legal cells as targetable
while armed, rather than showing an error after the fact. Neither the
Torpedo nor the Rocket needed this in the end: both can launch from
anywhere on the board, so neither ever restricts `isCellTargetable`.

Intended monetization model: players start with a handful of charges per
weapon, with refills obtainable via rewarded ads (Google Play style: watch
a 30-second ad for +3 charges of that type, once connected to a real ad
SDK). Tapping a weapon icon that's at 0 offers that flow directly, rather
than routing through a separate inventory screen — for the MOAB this is
currently stubbed as a 2-second "Procuring Weapons" overlay that then
refills to `MOAB_REFILL_COUNT` (3) and arms the weapon, with no real ad or
network call yet. This fits the "no progression" philosophy above because
weapons are consumable tools that add variety to a round, not permanent
unlocks that change the game's baseline difficulty.

Implementation note: this shipped player-only first, as expected, since the
computer AI (Variable A) didn't reason about anything beyond cell
targeting. The computer's initial weapon usage (see the Per-game weapon
quota section above) shipped as a random add-on to its existing target
selection — it decided *whether* and *which* weapon to fire independently
of where its regular shot would land. Variable A's "weapon-aware play"
has since closed that gap for Level 2: it now picks *where* to fire a
chosen weapon based on maximizing that weapon's blast zone, rather than
firing wherever its regular shot happened to land. Level 1 still fires
wherever its plain random target lands, weapon or not.

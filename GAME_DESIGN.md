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
- **Level 1**: Pure random targeting across all untargeted cells.
- **Level 2**: If a ship has been hit but not sunk, target its (8-neighbor,
  including diagonal) adjacent cells to finish it off before falling back to
  random targeting.

**Proposed future levels** (not yet implemented):
- **Line-following hunt logic**: once two hits land on the same ship, target
  along the inferred line instead of all adjacent cells, using the ship's
  known/possible length to bound the search.
- **Oil-slick-aware play**: prioritize sinking the Oil Tanker early, then
  deliberately let the slick spread as wide as possible before trying to
  ignite it (mirrors the human's own best strategy — see Variable B).
- **Weapon-aware play**: use additional weapons (Variable D) intelligently
  once those exist, to widen the computer's advantage at higher difficulty.
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

- **Mine** (`moveMine()` in `armada-game.ts`): only one may be active at a
  time — the Mines button disables itself while `GameState.playerMineIndex`
  is non-null. Firing it at an untargeted cell runs the normal targeting
  sequence there (splash, or explosion/sink if occupied) and always costs
  one charge and one quota dot, same as MOAB. If that placement shot was a
  *hit*, the mine is spent immediately — nothing further to activate. If it
  was a *miss*, a mine is planted at that cell (`playerMineIndex` is set);
  no further charge/quota cost is ever taken for it again.

  On every later turn the player takes (any shot or weapon, not just
  another mine), the active mine automatically moves to one random adjacent
  cell first (`getAdjacentIndexes`, silently, before the turn's own action
  resolves) — clipped at grid edges, no memory of where it's already been.
  A move only does anything if the new cell is both untargeted and
  occupied: that's a hit, resolved through the same normal-targeting path
  (including standard oil-ignition-on-hit odds), and the mine is consumed,
  re-enabling the button. Landing on an already-targeted cell (occupied or
  not) or an untargeted empty cell is a total no-op — the cell's state
  doesn't change and nothing plays. This is *why* a mine's movement can
  never ignite the oil slick by itself, per the request that shaped this:
  an empty oil cell is never actually targeted by a move, only a hit is,
  and a hit is always a real ship cell, so the ignition roll only ever
  happens through the same path as any other hit.

  A debug aid for validating this during development: any cell currently
  holding a mine renders an asterisk (alone if the cell is still hidden by
  fog of war, appended to whatever the cell would otherwise show if it's
  visible) - see the `hasMine` plumbing through `NavyPanel`/`GridCell`/
  `getCellPresentation` in `Index.tsx`.

**Not yet implemented:**
- **Surveillance Drone**: reveals a cell, a 3x3 block, a full row, or a full
  column, without targeting any of it.
- **Torpedo**: dropped at the left edge of a row, travels right until it
  hits an active ship.
- **Gravity Bomb**: dropped at the top of a column, travels down until it
  hits an active ship.

### Turn economy

**Firing MOAB, Torpedo, Gravity Bomb, or the Drone replaces your regular
shot for that turn** — it's an alternative action, not a bonus one. This
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
discussed. Worth keeping in mind: a computer choosing purely at random
when/where to fire will likely get less value per shot than a human
aiming deliberately (e.g. at a partially-sunk ship's remaining cells), so
equal quotas alone don't fully equalize the advantage — see Variable A's
proposed "weapon-aware play" for the natural follow-up.

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

This was chosen over two alternatives:
- **Right-click / long-press context menu on the cell itself**: doesn't
  translate to touch (no mobile equivalent of right-click), and since only
  some weapons are legal on some cells (Torpedo/Gravity Bomb only at grid
  edges), a per-cell menu means the player has to tap a cell just to
  discover what's available there — bad discoverability compared to seeing
  all weapon icons up front.
- **Drag-and-drop the weapon onto the grid**: more implementation cost
  (drag state, hit-testing, cancel-on-drag-away) for no real gameplay
  benefit, and generally less precise than tap-to-arm on small touchscreens.

Arm-then-tap also reuses the press-and-hold-to-preview / release-to-fire
interaction already built for regular shots
(`onCellPressStart`/`onCellPressEnd` in `Index.tsx`) — it's a third mode on
top of the same primitive, not a new gesture.

Edge-restricted weapons (Torpedo, Gravity Bomb) should extend the existing
per-cell `isCellTargetable` computation to only mark legal cells (left
column, top row respectively) as targetable while armed, rather than
showing an error after the fact.

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
quota section above) has since been added, but deliberately as a random
add-on to its existing target selection rather than a real strategy layer —
it decides *whether* and *which* weapon to fire independently of where its
regular shot would land. A smarter version (e.g. preferring MOAB on cells
adjacent to a hit) is still future work, tracked under Variable A's
"weapon-aware play."

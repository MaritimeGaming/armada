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

## Variable D: Additional weapons (not yet implemented)

No weapons beyond single-cell targeting exist in the code today — this is
the most likely direction for new gameplay features. Ideas on the table:

- **Mine**: placed on a cell. On every subsequent turn (regardless of who's
  acting or what else happens that turn) it moves to one random adjacent
  cell — a pure, unconstrained random walk. It doesn't avoid cells that have
  already been targeted, and it doesn't avoid cells it has already visited
  itself; it's just bobbing around in the ocean with no memory. If the cell
  it moves into is occupied by a live (untargeted, unsunk) ship, it explodes
  automatically, exactly as if that cell had been targeted directly. Silent
  and invisible to the opponent — there's no indication a mine is nearby
  until it goes off.
- **MOAB (Mother of All Bombs)**: targets one cell plus its 8 neighbors (9
  cells total) in a single shot.
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

### UI direction: arm, then tap

Discussed and settled on (not yet built): weapon icons live in the bottom
"Special Weapons" bar (currently a placeholder, see `weaponsBar` in
`Index.tsx`), each showing a small remaining-count badge. Tapping an icon
*arms* that weapon — it's visibly highlighted/selected — and the Enemy Navy
grid's tap behavior temporarily switches from "fire a regular shot" to
"deploy this weapon" for the next tap on a legal cell, then disarms back to
normal. Tapping the armed icon again cancels back to a regular shot.

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

Intended monetization model: players start with one or two of each weapon,
with refills obtainable via rewarded ads (Google Play style: watch a
30-second ad for +3 charges of that type, once connected to a real ad SDK).
Tapping a weapon icon that's at 0 should offer that flow directly, rather
than routing through a separate inventory screen. This fits the "no
progression" philosophy above because weapons are consumable tools that add
variety to a round, not permanent unlocks that change the game's baseline
difficulty.

Implementation note for whoever builds this: since the computer AI (Variable
A) doesn't currently reason about anything beyond cell targeting, weapons
will likely need to ship as player-only first, with AI usage added later
once there's a strategy layer for it to plug into.

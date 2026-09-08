# Armada — Game Design Philosophy

This document captures the design intent behind Armada so that anyone (or any
AI session) working on this codebase understands *why* the game works the way
it does, not just *how*. It exists because several design choices look like
bugs or oversights if you don't know the reasoning behind them.

Core game logic lives in [`src/lib/armada-game.ts`](src/lib/armada-game.ts);
UI/state wiring lives in [`src/pages/Index.tsx`](src/pages/Index.tsx).

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

There is a single computer opponent behavior, not a selectable difficulty.
An earlier version of this game offered two levels — Level 1 (pure random
targeting) and Level 2 (the shrewd play described below) — chosen in
Settings and persisted to localStorage. That selector was removed: there's
no real point in offering a deliberately weaker mode to play against, and
a dropdown that mostly exists to let a player choose to lose more often
doesn't add anything. The direction instead is to keep improving this one
opponent so it's genuinely competitive with a human player, and let
board-layout randomness (Variable C's ship-set toggle, where ships happen
to land) supply game-to-game variance rather than a manually-picked
handicap. `selectAppTargetIndex()` in `armada-game.ts` no longer takes a
difficulty argument at all — what used to be Level 2's logic is simply
what the computer always does.

**Implemented today** (`selectAppTargetIndex()` in `armada-game.ts`): if a
ship has exactly one hit that isn't yet sunk, target its (8-neighbor,
including diagonal) adjacent cells to find the rest of it. Once **two or
more** hits land on the same ship, its position is fully known — it's a
straight line — so targeting switches to just that ship's own remaining
untargeted cells instead of guessing via adjacency, which would otherwise
waste shots perpendicular to the ship's actual line. This naturally bounds
the search to the ship's true length without needing a separate min/max
heuristic, and handles gaps correctly too (e.g. cells 0 and 2 hit but not
1, from a MOAB or scattered random shots) since it simply targets whichever
of the ship's own cells are still untargeted, in any order. This logic
lives in its own `getHuntCandidateIndexes()` helper, optionally narrowed to
a single ship code — used two ways: unrestricted for the general hunt
described here, and restricted to `'O'` for the Oil Tanker priority below.
If no hit-derived candidate cells exist yet, it falls back to a plain
random pick among all untargeted cells.

**Oil Tanker targeting priority**: finding, then sinking, the Oil Tanker is
the single top priority for `selectAppTargetIndex()`, ahead of everything
else described above — including a Drone reveal on some *other* ship.
Concretely, in order:

1. **A revealed Oil Tanker cell always wins first.** If the tanker itself
   has a revealed-but-untargeted cell (`getRevealedTargetIndexes()`,
   filtered to `shipCode === 'O'`), that's the shot, unconditionally — a
   revealed tanker cell *is* the tanker being found, so nothing outranks
   taking it.
2. **Until the tanker has taken at least one hit, everything else is
   ignored** — including a Drone reveal on a different ship. Target
   selection is a plain random pick across every untargeted cell, same as
   if nothing anywhere had ever been hit. This is deliberate, not an
   oversight: a free kill on some other ship is still a turn not spent
   looking for the tanker, and that other ship isn't going anywhere — see
   point 4. The hunt logic below doesn't engage for *any* ship during this
   phase either, so a wounded-but-not-revealed ship gets no special
   treatment yet either.
3. **Found but not yet sunk: every further shot goes at the tanker
   specifically** (`getHuntCandidateIndexes(navy, 'O')` — adjacency for one
   hit, its own remaining line for two or more, exactly the general hunt's
   own rules, just scoped to one ship), still ahead of any other wounded or
   revealed ship.
4. **Once the tanker is fully sunk, this is the "pick it up eventually"
   moment** — any other ship's revealed cell (deferred by steps 2 and 3)
   now gets the same unconditional top priority a revealed cell always
   used to have, before the general hunt or slick-management logic below
   even runs. From here targeting falls through to the general hunt,
   unrestricted — see the slick-management behavior in Variable B for what
   changes about *which* untargeted cells that hunt (and the random
   fallback beneath it) is allowed to consider once the tanker's down.

Earlier versions of this logic let *any* revealed cell win immediately,
tanker or not - changed once real use showed that let the computer get
distracted finishing off an already-found ship elsewhere on the board
instead of staying focused on finding the tanker, which is supposed to be
the more urgent goal.

This same "play shrewdly" character also covers weapon use: whenever the
computer decides to fire a MOAB, Mine, Torpedo, Rocket, Harpoon, or Drone,
it picks whichever untargeted cell maximizes that weapon's "blast zone" —
the count of still-untargeted cells within its footprint (the 8-neighbor
adjacency for MOAB/Mine, the up-to-5 cells Torpedo/Rocket/Harpoon would
travel through, or the Drone's own smaller diamond reveal footprint; see
`getWeaponBlastZoneIndexes()` and `selectAppWeaponTargetIndex()`) —
breaking ties randomly. This reorders the turn's decision: weapon choice
(`selectAppWeaponChoice()`) now happens *before* target selection, since
the target search only makes sense once the weapon (and therefore the
footprint shape) is known. A Drone-revealed ship still outranks all of
this — see the Drone's own entry under Variable D for
`getRevealedTargetIndexes()`, which short-circuits weapon choice and
target selection alike before any of the above ever runs.

**Proposed future AI improvements** (not yet implemented):
- **Ship-immunity-aware weapon choice**: avoid spending a Rocket/Mine/
  Harpoon/Torpedo/MOAB on a cell it already knows (via a prior reveal)
  holds a ship immune to that weapon — see the ship-immunity rules under
  Variable D above, not yet accounted for in `selectAppWeaponChoice()` or
  `selectAppWeaponTargetIndex()`.
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

**The computer manages the slick too**, once it's sunk the Oil Tanker (see
Variable A's Oil Tanker targeting priority for how it gets there). The
goal is to let the slick grow to roughly the size of everything else still
unexplored before risking a shot inside it, rather than either avoiding it
forever or ignoring it entirely - `selectAppTargetIndex()` compares the
count of untargeted cells inside the slick against the count outside it:
while the slick still has room to grow (`getOilSlickSpreadCandidateIndexes()`
- shared with `spreadOilSlick()`'s own logic, so both always agree on
"can it get bigger") *and* inside is still the smaller pool, its
plain-random fallback (see below for the hunt) is restricted to cells
outside the slick; once inside catches up to outside, or the slick has
nowhere left to spread, that restriction lifts and any untargeted cell -
oil or not - is back on the table. This converges on its own without ever
stalling: each turn the slick can still grow, "inside" gains exactly one
cell while "outside" loses at least one (the turn's own shot) and
typically two (the spread itself eats one more "outside" cell converting
it to oil), so the gap closes turn over turn regardless of how large
"outside" started; and the "room to expand" check means a slick that's
boxed in can never be avoided past the point where waiting stops
accomplishing anything. This lands on "roughly balanced," not "literally
maximal" - the slick isn't deferred until *every* other cell on the board
has been tried, just until it's no longer clearly the smaller unknown.

**A known hunt target only defers to slick avoidance while some ship might
still be hiding in the very territory being explored.** `selectAppTargetIndex()`
checks `haveFoundAllRemainingShips()` - true once every still-unsunk ship
has taken at least one hit, i.e. nothing on the board is still sitting
completely undiscovered - before letting the general hunt's own candidate
cells be filtered by the outside-only restriction above. While some ship
remains entirely unfound, a *different*, already-wounded ship's own
remaining cell doesn't get to jump the queue just because it's known: that
cell could wait, but the still-hidden ship might only ever be found by
continuing to explore "outside," so slick avoidance still wins and the
known lead is filtered out same as before, falling through to a random
outside pick. Once nothing remains undiscovered, though, there's no more
exploration value left to protect - a known lead, oil-covered or not,
always outranks a slick that's now just delaying an inevitable, already-
identified kill. This was a real bug, not a hypothetical: a wounded ship's
own last untargeted cell could otherwise sit ignored indefinitely - the
computer randomly picking off empty water outside the slick instead of
just finishing it off - whenever that one remaining cell happened to be
oil-covered.

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

  The Ensign and Helicopter are the two ships a mine's wander can never
  detonate - see the ship-immunity rules below. Wandering onto one of
  them exposes it (same `exposeCellWithoutDamage()` used everywhere else
  immunity applies) rather than leaving the cell untouched: this used to
  be a Helicopter-only special case that skipped the cell entirely, hit
  or reveal, before ship immunity generalized "found but can't be
  damaged" into its own shared mechanic.

  Any cell currently holding a mine renders a red filled circle
  (`MINE_GLYPH`, `'●'`), via the `hasMine` plumbing through
  `NavyPanel`/`GridCell`/`getCellPresentation` in `Index.tsx` (the actual
  per-cell logic lives in `src/lib/cell-presentation.ts`, split out from
  `Index.tsx` so it can be unit tested directly without breaking that
  file's Fast Refresh - see the test-suite policy in `CLAUDE.md`). A
  circle, not an asterisk: an asterisk glyph sits high in its own em-box in
  most fonts (designed as a footnote-reference mark, not a centered
  symbol), so it never actually lined up with the vertically-centered ship
  letters around it - a circle centers the same way a letter does, and
  matches the Mine weapon's own `CircleDot` icon used everywhere else in
  the UI rather than introducing an unrelated shape just for this
  indicator. Colored `text-red-500` unconditionally, whether or not the
  cell is occupied, so the mine reads as its own distinct marker rather
  than blending into the white a ship's own letter already uses. An
  unoccupied cell shows *only* the glyph - nothing else there to combine
  it with, and this also hides a previous miss's dash for as long as the
  mine sits on top of it. An occupied cell keeps its own value (a live
  ship's letter, or an already-sunk one) and its own color untouched, with
  the glyph layered on top as a second, independently-centered element
  rather than appended as a second character - so, for example, a mine
  that's drifted onto an already-sunk ship still shows that ship's own
  letter in its usual color, with the red mine glyph visibly overlaid on
  top of it, both fully legible at once.

**Grid cell font size** (`GridCell` in `Index.tsx`, both the interactive
`<button>` and static `<div>` variants): sized to fill roughly 44-52% of
the cell's own width - large enough to read at a glance, without touching
the cell's edges. Uses `text-[clamp(0.75rem,3.3vw,1.04rem)]
lg:text-[1.265rem]` rather than a single `vw`-based `clamp()` across the
whole range, because cell size itself isn't a smooth function of viewport
width: it holds flat around 32px from roughly 375px up through 767px wide
(single-panel mobile layout), then jumps to a flat 46px at the `lg`
breakpoint (1024px, where `DESKTOP_LAYOUT_QUERY` switches to the
side-by-side two-panel layout) and stays there at any wider desktop size -
both panel widths are themselves capped, not viewport-proportional. A
single continuous `clamp()` can't track a step function like that: tuned
to hit the right size at 1024px+, it would overshoot everywhere in the
flat 375-767px plateau below it. The mobile-range `clamp()` still carries
its own small `vw` term rather than a fixed size, purely to keep scaling
down gracefully below 375px (a 320px-wide phone gets a smaller cell too,
around 26px). These values are the exact midpoint, parameter by parameter,
between the original `clamp(0.5rem,1.6vw,0.78rem)` (~25-38% fill, judged
too small to read comfortably) and a first pass at
`clamp(1rem,5vw,1.3rem) lg:text-[1.75rem]` (~60-65% fill, judged too large)
- landing here once real use showed both ends of that range were wrong in
opposite directions.

**Ship Legend hit counter** (top-right of each Legend, `NavyPanel` in
`Index.tsx`): reads "Hits: `hitCellCount` / `occupiedCellCount`" -
`occupiedCellCount` is just every occupied cell this navy started the game
with (fixed for the whole game), `hitCellCount` is however many of those
are no longer `'untargeted'` (hit, whether merely `'targeted'` or already
`'sunk'`). Counts up monotonically over the course of a game, reaching
`occupiedCellCount` exactly when every ship is sunk - a quick "how much of
this fleet is left" readout that doesn't require counting Legend rows by
eye. Replaced an earlier "Cells: N" counter that counted down instead (the
number of occupied, still-untargeted cells) - functionally the complement
of the same information, swapped to count up because "how much damage have
I done" reads more naturally as it climbing than as watching a number
shrink toward zero from a number the player doesn't already know offhand
(the fleet's exact total occupied-cell count).

- **Torpedo, Rocket, and Harpoon** (`fireTorpedo()`/`fireRocket()`/
  `fireHarpoon()` in `armada-game.ts`, all thin wrappers around a shared
  `fireTravelingWeapon()` engine, parameterized by a `WeaponTravelAxis` of
  `'horizontal' | 'vertical' | 'diagonal'`): three variants on the same
  mechanic, differing only in which axis (or both) they travel - Torpedo
  horizontally, Rocket vertically, Harpoon diagonally - so they're
  documented together. Rocket replaced an original "Gravity Bomb" concept -
  dropped at the top of a column, travels down until it hits an active
  ship - with the exact same mechanic as the Torpedo, just turned 90
  degrees.

  Any of the three can be launched at any untargeted cell, unlike that
  edge-only concept originally sketched for Gravity Bomb. Each always
  travels exactly `WEAPON_TRAVEL_DISTANCE` (5) further cells - Torpedo
  rightward from columns 0-4 and leftward from columns 5-9; Rocket downward
  from rows 0-4 and upward from rows 5-9 - regardless of whether the launch
  cell (or any cell along the way) was a hit. This replaced an earlier
  "stop at the first hit" version of the Torpedo: in practice the very
  first or second cell was a live ship often enough that the travel
  animation rarely got to play, which defeated the point of it.
  Fixed-distance means a single shot can now hit more than one ship. Along
  the way, cells already targeted (miss, hit, or sunk) are passed over
  untouched, an untargeted empty cell is silently marked targeted (no
  sound, matching the request that the whole run shouldn't play a splash
  per cell), and every untargeted occupied cell detonates (a normal hit,
  including its own independent oil-ignition odds). Costs one charge and
  one quota dot up front, at launch, regardless of how many cells it
  crosses or how many ships it hits. Given the board is 10 wide/tall and
  the direction split falls exactly at index 4/5 on whichever axis, the
  5-cell run is never actually clipped by the edge - every launch position
  has exactly 5 valid cells in its travel direction, on every axis this
  engine supports.

  **Harpoon** travels diagonally, and moves both axes at once -
  `getWeaponTravelIndexes()` steps the column *and* the row independently,
  each using the exact same 0-4-vs-5-9 split as Torpedo/Rocket use on their
  single axis. This was chosen over a single fixed diagonal direction
  (e.g. always down-right) because that would leave two of the board's
  four quadrants with no full-length run available in *either* diagonal
  direction - a cell in the top-right corner has no room to travel
  down-right, and no room to travel up-left either, since both run off the
  board almost immediately. Deriving the direction independently per axis
  instead gives every cell its own quadrant-appropriate diagonal: top-left
  always down-right, bottom-right always up-left, top-right always
  down-left, bottom-left always up-right - so, like Torpedo and Rocket,
  every cell still gets the full 5-cell run, just diagonally, using only
  one weapon slot instead of needing two "NW-SE" and "NE-SW" variants.

  The travel is animated one cell at a time (`runWeaponTravelSteps()` in
  `Index.tsx`, shared by all three weapons): each traveled cell lights up
  with the normal targeting highlight for `WEAPON_TRAVEL_STEP_DELAY_MS`
  (500ms) before resolving and moving to the next, so a shot reads as a
  wave sweeping across the row, column, or diagonal rather than an instant
  reveal. Because that always takes a few seconds (5 steps at 500ms each,
  on top of the instant launch resolution), turn ownership deliberately
  does *not* pass to the other side until the whole sequence finishes -
  unlike every other weapon, which hands off the turn the instant it
  resolves. Otherwise the computer's own turn could start firing
  mid-animation. `isWeaponInFlight` (player) and `appWeaponInFlightRef`
  (computer) exist solely to block input/re-entry during that window,
  shared by all three weapons since only one can ever be traveling for a
  given side at a time.

- **Drone** (`fireDrone()`/`getDroneRevealIndexes()` in `armada-game.ts`):
  the one weapon that doesn't attack. Fired at any untargeted cell, it
  reveals the fog of war on every cell within Manhattan distance 2 of it -
  a 13-cell diamond at most (the center, a ring of 4 at distance 1, and a
  ring of 8 at distance 2), clipped at grid edges. Cells in that footprint
  that are still untargeted become visible - an occupied one shows its
  ship, an empty one shows open water - but neither gets marked
  `targeted`: no hit, no miss, no sound, no ignition risk, nothing actually
  fired. Cells outside the footprint, or already targeted or already
  revealed, are left untouched. Still costs one charge and one quota dot up
  front, same as every other weapon, regardless of how much (if anything)
  was still fogged there.

  This is exactly the "expose without targeting" distinction flagged as an
  open question when the Drone was first proposed - resolved with a new,
  dedicated `CellState.droneRevealed` boolean (`effect` stays `'untargeted'`
  throughout), rather than reusing `exposure`. `fireDrone()` also still
  bumps `exposure` from `'unknown'` to `'known'` wherever it actually was
  `'unknown'` - that's what visually lifts the fog for whoever's looking at
  this navy (e.g. the player firing a Drone at the enemy: `getCellPresentation()`
  already falls through a `'known'`, untargeted, occupied cell to the same
  plain ship-colored cell the player's own always-visible navy uses, or to
  the oil color if oil has spread over it).

  The one deliberate exception: `computeBaseCellPresentation()` gives a
  droneRevealed, still-untargeted, occupied cell its own distinct
  background (with plain white bold text) rather than leaving it fully
  indistinguishable from an ordinary visible ship cell - on *either* grid,
  since a Drone (or a weapon exposing a ship it's immune to - see Variable
  D below) can reveal either side's ships. This exists purely so the
  reveal is still visible after the fact: without it, nothing on screen
  would ever confirm the computer actually fired a Drone (or found an
  immune ship), since a droneRevealed cell's background is otherwise
  identical to a plain visible cell's.

  This went through several attempts at recoloring just the *letter*
  first - plain `text-green-400` (matching the weapon button's pulsing
  use-count dot), then the lighter `green-300` plus bold, then
  `text-yellow-300` plus bold once green itself wasn't standing out enough
  - all eventually judged too subtle. The real problem wasn't the specific
  hue: a color change on a single small glyph just doesn't carry much
  visual weight next to a whole cell's worth of background, so no amount
  of hue-picking on the text alone was ever going to fix it reliably.
  Shifting the cell's own *background* instead is the same trick oil
  already uses (`#404040` instead of blue) to make a state change
  unmissable - it colors the whole cell, not a few pixels of glyph.
  Deliberately not the same vivid `#00B200` `revealUntargetedShips()` uses
  for its own end-of-game reveal (see below): that green is a legitimate
  "shoot here" signal for a different moment entirely (ships that survived
  to the end of the game), and reusing it here would carry the same
  urgency for what's meant to be a much quieter "there's a live ship under
  this, FYI" cue.

  **Two shades, not one** (`exposedBackgroundClassName` /
  `exposedOilBackgroundClassName` in `cell-presentation.ts`): a plain
  exposed cell gets `border-[#0B7A5C] bg-[#0B7A5C]`, a noticeably green
  teal; an exposed cell that's *also* oil-covered gets the more muted
  `border-[#0B5D73] bg-[#0B5D73]` instead - both a real, noticeable step
  away from the ordinary `#0000FF` blue without leaving the blue family
  the way the vivid end-of-game green would, but the oil case is pulled
  back toward blue specifically so it doesn't compete for attention with
  oil's own `#404040` gray sitting right next to it on the board. Bold
  stays on in both cases as a second, non-color signal (useful for
  colorblind players, since this is a hue change rather than a brightness
  change). Either way, it only applies pre-targeting: once the cell is
  actually hit or sunk, the ordinary hit/sunk colors and white/semibold
  text take back over.

  This droneRevealed tint shipped with a bug that made it invisible in practice for
  a few commits: `GridCell` renders the cell's letter inside its own inner
  `<div>`, which had a hardcoded `text-white` class - completely
  overriding whatever color the outer cell element computed, `shipTextColorClass`
  included. The outer element's `className` (and its `getComputedStyle().color`)
  was correct the whole time, which is exactly why it initially looked
  fine under inspection - the bug only showed up by checking the color of
  the specific element the letter actually renders in. Fixed by dropping
  the inner `text-white` and letting it inherit color from the outer
  element instead, which every branch of `computeBaseCellPresentation()`
  already sets explicitly - no branch relied on the inner div's hardcoded
  default, so nothing else needed to change.

  **A cell's own `droneRevealed` flag, not its `exposure`, is what
  `getRevealedTargetIndexes()` checks** (see below) - and this distinction
  is load-bearing, not stylistic. `createNavy()`'s `known` parameter means
  a side's own fleet starts with `exposure: 'known'` on *every* cell from
  creation, Drone or no Drone, since there's no fog of war over your own
  ships. An earlier version of this feature used `exposure === 'known' &&
  effect === 'untargeted'` as the "Drone found this" signal, reasoning that
  no other code path produces that combination - true for the *enemy*
  navy (which genuinely starts fogged), but false for a navy's own fleet,
  which already satisfies that combination for every unsunk ship from turn
  one. The bug this caused: the computer's target selection treated *all*
  of the player's live ships as instantly known, hitting every shot with
  no misses until the whole fleet was sunk - the computer's Drone was never
  even fired. `droneRevealed` fixes this by recording the reveal directly,
  independent of whatever `exposure` happens to already be.

  This also leaves `ExposureState`'s third value, `'revealed'`, untouched
  by the Drone: `revealUntargetedShips()` in `Index.tsx` (see "End-of-game
  reveal sequence" under Turn economy below) uses `'revealed'` for its own
  distinct green highlight, shown only once, at the very end of the game.
  The Drone must never produce that color mid-game - a Drone-revealed ship
  should look like any other visible ship cell, not like a special
  end-of-game callout.

  **The computer takes drone-revealed information seriously.** A cell the
  computer's own Drone has revealed as an enemy ship (`droneRevealed` true,
  `effect` still `'untargeted'`) is a confirmed, cost-free kill sitting on
  the board - `getRevealedTargetIndexes()` finds any such cells, and
  `selectAppTargetIndex()` checks it first, ahead of even the
  hunt-adjacent-cells logic, returning one outright if any exist: ignoring
  a ship you can already see isn't "playing dumb," it's just not looking.
  The app-turn effect in `Index.tsx` goes a step further and
  checks for a revealed target *before* even rolling a weapon choice for
  the turn - if one exists, `appWeaponChoiceRef.current` is forced to
  `null` instead of calling `selectAppWeaponChoice()`, so the computer
  doesn't burn a MOAB or Mine hunting the rest of the board while a
  guaranteed kill sits unclaimed; the turn falls through to a plain shot,
  which then lands on the revealed cell via the priority check above. The
  player gets the equivalent benefit for free, just visually: a
  Drone-revealed enemy ship is simply no longer fogged on the Enemy Navy
  grid (and its cell shows the teal droneRevealed background described
  above), so there's nothing to build - the player already sees it and can
  just tap it.

**Some ships are immune to specific weapon types** (`isShipImmuneToWeapon()`
in `armada-game.ts`, per the About Ships reference guide's own per-ship
descriptions):
- **Ensign** (`E`): immune to Harpoon, Mine, Rocket, and Torpedo.
- **Helicopter** (`H`): immune to Harpoon, Mine, and Torpedo (not Rocket -
  the Helicopter flies too low to dodge a bomb dropped straight down on it,
  unlike the horizontal/diagonal weapons it can duck).
- **Submarine** (`S`): immune to MOAB and Rocket (too deep for either's
  reach).

A weapon that finds one of these anyway doesn't just pass over it like
empty water - it exposes it (`exposeCellWithoutDamage()`, sharing the exact
mechanism `fireDrone()` uses for its own reveals: `droneRevealed: true`,
`exposure` bumped from `'unknown'` to `'known'`), leaving `effect` at
`'untargeted'` rather than marking it a hit. The result reads identically
to a Drone find on both sides of the interaction: the same teal
`droneRevealed` background, the same `getRevealedTargetIndexes()`
AI-priority targeting (the computer's next plain shot goes straight for an
exposed immune ship, same as it would a Drone-found one), and the ship
stays fully vulnerable to a plain shot or to a weapon type it isn't immune
to - immunity blocks specific weapons, not damage outright, so a game can
never soft-lock on an unsinkable ship. Nothing animates as an explosion for
an exposure-only cell, matching a Drone reveal's own visual treatment.

**Silence is reserved for cost-free background events, not a real weapon
shrugged off.** This immunity mechanic is realism added deliberately in
service of fun (see the core philosophy above) - a Torpedo sinking a
Helicopter, or a MOAB reaching a submerged Submarine, felt silly enough to
fix, and "which weapon beats which target" is a genuine tactical layer, not
just flavor. But the first version of this feature exposed an immune ship
in total silence, matching a Drone reveal's own silence exactly - and that
turned out to be its own playability problem: dropping a MOAB and getting
back *nothing*, not even a sound, reads as "did that just not work, is this
broken?" rather than "the game blocked this on purpose." A Drone reveal
earns its silence (it's a free look, nothing was actually fired), and so
does a Mine's own passive per-turn wander (see Turn economy below) landing
on an immune ship - both are background events, not a turn's chosen action.
A real weapon the player (or computer) actually fired - MOAB, a direct Mine
drop, or a Torpedo/Rocket/Harpoon's launch or a cell it merely passes
through mid-flight - getting deflected by immunity now plays its own
`'deflect'` audio cue instead, so the moment reads as "that ship dodged it"
the instant it happens. `withDeflectCue()` in `armada-game.ts` is the single
seam every real-weapon call site routes through; a MOAB shot needed its own
distinct cue name rather than reusing `'splash'`, since `playMoabSequence()`
in `Index.tsx` already strips `'splash'`/`'explosion'` from a MOAB's own
sequence so they don't compete with its double-boom - reusing `'splash'`
would have silently un-fixed the exact MOAB case that motivated this. The
cue's actual sound file is the same `Splash.wav` `'splash'` already uses -
a "this cell didn't take damage" beat the player already recognizes, now
also reachable under a name a MOAB's own filter doesn't catch.

Immunity is checked per cell, independent of the rest of the shot: MOAB's
blast can expose a Submarine cell while still detonating every other cell
in its 3x3 footprint normally, and a Torpedo/Rocket/Harpoon's travel run
exposes an immune cell it crosses (launch cell included) and then keeps
travelling exactly as if that cell had been empty water, rather than
stopping the run or counting it as a hit. The Mine has two entry points -
`resolveMineHit()` (a direct drop) short-circuits to an exposure before
ever computing its usual same-ship bonus cell (moot anyway: both immune
ships are single-cell), while `moveMine()`'s passive wander exposes an
immune ship it drifts onto as a raw cell update, not routed through
`resolveTargetingSequence` - deliberately consistent with its sibling
silent-empty-water-reveal branch, since a passive wander step should never
tick the oil slick a second time on top of whatever action the player
actually took that turn. An exposed cell whose weapon was the thing that
pressed-and-held it (MOAB or Mine fired directly at it, or a travelling
weapon's own launch cell) still needs its `targeting` preview flag cleared
even though it was never marked `'targeted'` - easy to miss since every
other targeting path clears that flag as a side effect of setting `effect`,
which this path deliberately never does; `exposeCellWithoutDamage()` clears
it explicitly for exactly this reason.

A direct Mine drop that lands on an immune ship leaves the Mine live and
planted on that same cell, exactly as if it had landed on empty water -
`resolveMineIndexAfterDrop()` in `Index.tsx` decides this from
`ShotOutcome.dealtDamage`, not from the drop cell's raw occupancy. This
fixed a real bug: occupancy alone can't tell "detonated" apart from
"exposed an immune ship, survived" - the earlier logic treated an occupied
cell as always consuming the mine, so a drop on an Ensign or Helicopter
made the Mine vanish (no live mine left to render `MINE_GLYPH` on top of
the exposed ship's own letter, no mine planted anywhere else either)
instead of staying put for its usual wander to pick up next turn.

This shipped as a rules-only change: the AI doesn't yet know which ships
are immune to which weapon it's holding, so `selectAppWeaponChoice()` and
`selectAppWeaponTargetIndex()` can still spend a Rocket on a Submarine and
get nothing for it. Teaching the computer to route around a target's known
immunities (once revealed) is a reasonable future addition alongside the
oil-slick-aware play already proposed under Variable A.

### Turn economy

**Firing MOAB, Torpedo, Rocket, Harpoon, or the Drone replaces your regular
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

### Mobile swipe carousel: instant vs. animated view switches

On mobile, "My Navy" and "Enemy Navy" live side by side in a `w-[200%]`
flex row inside an `overflow-hidden` viewport, and `activeView` (`'player'`
| `'enemy'`) picks which one shows by translating that row by 0 or one full
panel width. Plenty of moments *drive* this - firing a shot, taking an AI
turn, the end-of-game reveal (below) all call `setActiveView()` to point the
player at whatever the game wants them looking at - and a full-second
`transition-transform` on the row turns each of those into a deliberate,
visible pan, the same visual language as the player's own manual swipe via
the arrow buttons. That's the point for gameplay-driven switches: a slide
reads as "look over here," not as an error.

It's the wrong behavior for a handful of *reset* moments that also call
`setActiveView()`, though: the very first render, restoring a saved game
from storage, and New Game. None of those are directing attention anywhere
- they're establishing a starting state - but without a fix they'd still
animate over the full second, because the transition class was applied
unconditionally. A user who glanced at the screen (or took a screenshot)
during that second could catch the carousel mid-slide, showing a sliver of
both grids at once - reported as "clicking New Game sometimes leaves the
grids offset, showing only the last couple columns of one navy and the
first few of the other." The fix, `instantViewSwitch` in `Index.tsx`, is a
one-render flag those three call sites set alongside `setActiveView()`: it
drops the transition class for that single update so the row jumps straight
to its target position, then re-arms itself via a double
`requestAnimationFrame` (one frame to let the untransitioned jump actually
paint, a second to be sure that paint has landed) so the very next
gameplay-driven switch or manual swipe animates normally again.

### End-of-game reveal sequence

`concludeGame()` in `Index.tsx` runs the instant the losing side's last
ship is sunk, and drives a fixed, choreographed sequence rather than
popping the win/lose dialog immediately:

1. The just-updated `GameState` (the losing navy now fully sunk) is
   applied right away, and the view is forced to the **losing** side -
   whichever navy just lost its last ship, the same one the fatal shot's
   own explosion is already animating on - regardless of whichever view
   happened to be active a moment before. This matters most on mobile,
   where only one navy panel is visible at a time (see "UI direction: arm,
   then tap" below): without forcing it, a computer-won game could pop the
   dialog while the player was still looking at their own screen mid
   swipe-transition, having never actually seen the finishing blow land.
2. That view holds for a fixed **two seconds** - enough room for the
   fatal shot's own audio and animation to finish, including the longer
   cues (an oil ignition or a MOAB kill queues a second/third "explosion"
   sound 300-600ms after the first, and that cue alone is a ~1.5s clip).
3. After the two seconds, `revealRemainingShipsInWinningNavy()` marks
   every still-untargeted, occupied cell in the **winning** side's own
   navy (the side that survived, not the side it defeated) with exposure
   `'revealed'` via `revealUntargetedShips()` — unconditionally, regardless
   of whether a cell had already been exposed earlier by a Drone (`'known'`
   exposure) or was still fully fogged (`'unknown'`); either way it becomes
   `'revealed'` here. `getCellPresentation()` renders an occupied
   `'revealed'` cell in its own distinct green, reserved solely for this
   moment - a Drone's own mid-game reveal deliberately never produces this
   color (see the Drone's entry under Variable D above) - so a green ship
   on screen always specifically means "this survived to the end of the
   game," never "a Drone found this."
4. The view then switches to the **winning** side to show that reveal,
   the win/lose dialog opens, and (if the player won) the `wingame` cue
   plays.

Winner and winning-navy-owner are the same side - "the winning navy" means
the fleet that belongs to whoever won, not the fleet they defeated. When
the player wins, that's the player's own board: any of their ships that
survived the game light up green, a small victory-lap detail. When the
computer wins, it's the enemy board: whatever the computer never lost
gets revealed, the classic "here's what was left standing" reveal. Either
way, the losing side's board - already either fully sunk (if the player
lost, every player cell is `'sunk'`) or fully sunk on the computer's
side - has nothing further to reveal, which is why only the winning side
needs this treatment.

**The winning shot must not hand the turn to the side it just defeated.**
`concludeGame()`'s two-second delay above runs entirely before
`gameOver.isOpen` flips true, and both the AI-turn effect and the player's
own cell-press handler gate purely on `GameState.currentTurn` - not on
`gameOver.isOpen` - to decide whether they're allowed to act. Every
shot-resolution branch (plain shot, MOAB, Mine, and the non-travelling
resolution of Torpedo/Rocket/Harpoon) used to flip `currentTurn` to the
other side unconditionally, in the same `nextState` object passed into
`concludeGame()`. The result: a player's winning shot correctly triggered
`concludeGame('player', ...)`, but that `nextState` already had
`currentTurn: 'app'` baked in, so the instant it was applied via
`setGameState(state)`, the AI-turn effect's `currentTurn !== 'app'` guard
was satisfied and it started previewing (and would go on to fire at) a
target - visibly, since the two-second reveal hold hadn't even started
counting down yet. The symmetric bug existed for a computer win: with
`currentTurn` wrongly flipped to `'player'`, the player's own
`handleEnemyCellPressEnd` guard (`state.currentTurn !== 'player'`) would
have let a real click through and fired a shot in the dead time before the
dialog opened, even though the game was already over.

Fixed with two small closures, `nextTurnAfterPlayerFire(updatedEnemy)` and
`nextTurnAfterAppFire(updatedPlayer)` (`Index.tsx`, defined next to
`concludeGame()`): each checks `areAllShipsSunk()` on the just-updated navy
and returns the *same* side instead of handing off whenever that's already
true. Every unconditional `currentTurn: 'app'`/`'player'` assignment at a
win-checkable point now routes through one of these instead, including the
non-travelling branch of Torpedo/Rocket/Harpoon (their ternary's `hasTravel
? player_or_app_unchanged : ...` else-branch). The Drone is the one
exception left alone - it never changes any cell's sunk/targeted state, so
it can never be the shot that ends the game, and doesn't need the check.
The travelling-weapon in-flight completion callback (`runWeaponTravelSteps`'s
`onComplete`) was already correct by construction: it checks
`areAllShipsSunk()` and calls `concludeGame()` with an *early return*
before ever reaching its own `currentTurn` flip, so a win found mid-flight
never got this bug in the first place.

**That fix has a second-order consequence the guards above didn't account
for: the winning side's own turn-effect can re-trigger on its own win.**
Keeping `currentTurn` pointed at the winner (rather than clearing it) means
that after the computer wins, `currentTurn` is still `'app'` - which is
*exactly* the condition the AI-turn effect's own guard
(`gameState.currentTurn !== 'app'`) requires to proceed. Since
`gameOver.isOpen` doesn't flip true until 2 seconds later, the effect would
re-run on the post-win `gameState`, pick a fresh target on the (already
irrelevant) losing navy, and start previewing it - visibly, as a cell
briefly highlighting again right after the win. The symmetric case exists
for a player win too: `currentTurn` stays `'player'`, which is exactly what
`handleEnemyCellPressEnd`'s guard requires, so a real click during the
2-second window could still fire a shot that means nothing.

Fixed with `isGameConcluded` (`Index.tsx`, derived from `gameOver.winner`):
`concludeGame()` now sets `gameOver.winner` immediately, via
`setGameOver({ isOpen: false, winner })`, rather than waiting for the same
call that flips `isOpen` true 2 seconds later. Every guard that used to
check `gameOver.isOpen` to decide "is it still safe to act" - the AI-turn
effect's top-level guard, both `armedWeapon`/`appArmedWeapon` safety-net
effects, `handleWeaponButtonClick`, `handleEnemyCellPressStart`,
`handleEnemyCellPressEnd`, and `isPlayerTurnActive` - now checks
`isGameConcluded` instead, catching the game's end the instant it happens
rather than 2 seconds later. `gameOver.isOpen` itself is untouched
everywhere else: the `<Dialog open={...}>` prop still needs the real,
delayed value, since the whole point of the 2-second hold is to *not* pop
the dialog immediately.

### Randomized weapon loadout

Each game draws only `ACTIVE_WEAPON_TYPE_COUNT` (3) of the 6 weapon types
into play, not all 6 — `pickActiveWeaponTypes()` in `armada-game.ts` picks
them uniformly at random and re-sorts the pick back into `ALL_WEAPON_TYPES`'s
canonical order — MOAB, Mine, Drone, Torpedo, Harpoon, Rocket — so *which*
3 show up varies game to game, but their left-to-right order in the
weapons bar never visually shuffles, and whichever 3 are active still
appear in this same relative order. The result
is stored once as `GameState.activeWeaponTypes`, re-rolled every time a new
`GameState` is created (New Game, the ship-set toggle, first load) — and
critically, **the same 3 types for both sides**, not independently
randomized per side. An asymmetric version (the computer stuck with a weak
draw, or the player facing one they can't match) was considered and
rejected: it would produce some games that are unwinnable-feeling rather
than harder, which cuts against variety without adding real challenge.

This is also why the weapons bar (`WeaponsBar` in `Index.tsx`) is
data-driven rather than one hardcoded button per weapon type: it renders
exactly `weapons: Array<{ type, count, isArmed, disabled, onClick }>`,
built from whichever types are in `activeWeaponTypes` for both the
interactive "My Weapons" bar and the mirrored read-only "Enemy Weapons"
one, via a small `WEAPON_DISPLAY` icon/label lookup keyed by `WeaponType`.
Six named prop groups (one per type) couldn't express "render only these
3 of 6" without either duplicating JSX across all 20 possible combinations
or heavy conditional rendering — the array-of-active-weapons shape scales
to however many types are active without per-type plumbing.

### Per-game weapon quota

Ads make the standing inventory effectively unlimited over enough sessions,
which would otherwise let a patient player wallpaper most of the enemy
grid for free. The fix is a hard, separate cap: **`SPECIAL_WEAPON_QUOTA`
(5) total special weapon shots per side per game, across all active weapon
types combined** — independent of how many charges are sitting in
inventory. `playerWeaponsUsed` tracks this on `GameState` itself (unlike
the standing inventory), so it resets to 0 every New Game while the
inventory carries over untouched. This is what decouples "grind ads to
build a deep reserve" (fine, that's the intended monetization loop) from
"grind ads to win this particular match" (not fine — capped regardless of
reserve size).

On top of that shared total, **`WEAPON_TYPE_USE_CAP` (2) limits every
individual weapon type to 2 uses per side per game** — this applies
uniformly now, including MOAB (see "Loosening the MOAB cap" below).
Combined with only 3 weapon types being active per game, this has a
deliberate side effect: spending all 5 shots is only reachable as 2+2+1,
which forces at least one shot into every active type rather than letting
a player (or the computer) dump all 5 into a single favorite — variety
within a single game, not just across games.

The player's own per-game count lives in `GameState.playerWeaponUseCounts`
(a `Record<WeaponType, number>`, reset to all-zero every New Game) since
the player's standing inventory itself is *not* reset per game and can
exceed 2 via ad refills — count-exhaustion alone can't enforce the cap for
them. The computer needs no equivalent field: its own per-type standing
counts (`appMoabCount` etc., starting at `APP_MOAB_STARTING_COUNT` (2) and
five siblings, all already exactly 2) never reset mid-game, so their own
exhaustion at 0 already *is* a working 2-per-game cap, for every type,
for free.

Implemented for the player: each active weapon's button (and the same
per-cell targetability check) disables once either cap is hit — the
5-shot total or that type's own 2-use cap — even with standing-inventory
charges left, and a row of `SPECIAL_WEAPON_QUOTA` (5) dots in a "My
Weapons" bar tracks the total — solid green per unused shot, turning red
as each is spent, no text needed. Every button also carries its own
`WEAPON_TYPE_USE_CAP` (2) corner dots, same green/red idiom, one turning
red per use of that specific type — a smaller-scale echo of the quota row,
giving "1 more shot left" advance warning per weapon type instead of only
finding out the moment a button disables. (An earlier pass judged this
per-type indicator not worth the complexity once every type shared one
cap and dropped it in favor of relying on `disabled` alone — reinstated
because at-a-glance per-type feedback turned out to matter more than the
minor visual clutter of a second dot; disabling the button is still the
actual enforcement, this is purely an earlier-warning affordance on top
of it.) The button's own `count` badge still shows standing inventory,
independent of these use-count dots - see "Loosening the MOAB cap" below
for the cap's own history.

The next-to-spend dot (index `useCount`, still green) also **pulses**
(`animate-pulse`) the moment that weapon type is armed, and keeps pulsing
straight through firing until its animation has actually finished, at
which point it settles into solid red rather than stopping mid-color.
While pulsing it also switches to a brighter shade (`bg-green-400` instead
of the other dots' `bg-green-500`) and a quicker cycle than Tailwind's
`animate-pulse` default (an inline `animationDuration: '0.6s'` override,
vs. the default 2s) - both purely to read as "this one's active" at a
glance, distinct from the plain unused-charge green used everywhere else.
This
applies symmetrically to both sides: `firingWeaponType`/`appFiringWeaponType`
(`Index.tsx`) track "fired, still animating" separately from `armedWeapon`
("selected, not yet released") - `armedWeapon` alone would stop the pulse
the instant a shot is released, well before its explosion/travel animation
actually plays out. For an instant weapon (MOAB/Mine/Drone) the pulse
simply continues for `WEAPON_FIRE_ANIMATION_MS` (380ms, the same constant
`triggerCellExplosions()` uses for its own explosion duration) after
firing; for a traveling weapon (Torpedo/Rocket/Harpoon) it continues for
that same 380ms if the shot resolved without traveling, or all the way
until `runWeaponTravelSteps()`'s completion callback for one that did -
exact signals already available in the firing code, not new bespoke
timers. The computer gets the identical treatment on the "Enemy Weapons"
bar: `appArmedWeapon` is set the moment `selectAppWeaponChoice()` decides
on a type (visibly "thinking" during the several-second delay before it
actually fires - see the app-turn effect's `previewDelay`/
`executeTargetingDelay`), and handed off to `appFiringWeaponType` at the
same point its firing branch runs, clearing the same way as the player's
own weapons.

The weapons bar is split into two (`WeaponsBar` in `Index.tsx`, one per
side) precisely so this display is symmetric: a matching "Enemy Weapons"
bar shows the computer's own counts and its own quota dots
(`appWeaponsUsed`). Every button on that bar is wired permanently disabled
— it's display-only, information for the player about what the computer
*could* still use, not a control.

The computer's side of actually *firing* weapons is implemented
(`selectAppWeaponChoice()` in `armada-game.ts`): once a target cell is
chosen for its turn, if it hasn't hit `SPECIAL_WEAPON_QUOTA` yet, there's
a flat 25% chance (`APP_WEAPON_USE_CHANCE`) it fires a special weapon
instead of a plain shot, picked from whatever's currently active,
in-charge, and (for Mine) not already placed. Within that pool, MOAB gets
a soft priority (see below) rather than a purely uniform pick; every other
type is still uniform random. *Where* it fires is always the weapon-aware
target that maximizes the weapon's blast zone (see Variable A's
"weapon-aware play").

### Loosening the MOAB cap, and MOAB-aware computer play

MOAB used to be capped at **one** use per side per game, stricter than
every other weapon, because a single MOAB already reveals up to 9 cells.
That stricter cap is gone: MOAB now shares the same `WEAPON_TYPE_USE_CAP`
(2) as every other type. The reasoning changed because the roster changed
— Torpedo, Rocket, and Harpoon's up-to-5-cell travel footprints have
closed most of the gap with MOAB's 9-cell blast, so MOAB no longer
dominates clearly enough to deserve a uniquely tighter leash. This also
simplified the code: the old `playerMoabUsedThisGame`/`appMoabUsedThisGame`
booleans are gone entirely, folded into the generic per-type cap described
above. MOAB's old single "used this game" corner dot is also gone as a
MOAB-specific thing, but not lost - every weapon type now carries the
same two-dot indicator described above, generalizing rather than dropping
the affordance.

Separately, the computer is now mildly "MOAB-aware": whenever it's already
decided to fire *some* weapon this turn (the 25% roll above) and MOAB
happens to be in that turn's eligible pool, there's a further 50%
(`APP_MOAB_PRIORITY_CHANCE`) chance it fires MOAB outright rather than
falling into the uniform pick among whatever else is available. This
mirrors the expectation that a deliberate human player would rarely sit on
an available MOAB — but it's a soft bias, not a guarantee: the computer's
first weapon use of a game isn't reliably MOAB, and there's no scenario
where MOAB is forced to fire the instant it's available. This is a
"which weapon" decision inside the existing 25% "fire at all" roll,
entirely separate from — and unaffected by — the blast-zone-maximizing
"where to fire" logic used once a weapon's already chosen.

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

For the Torpedo, Rocket, and Harpoon specifically, both the cursor and the
mobile preview icon are direction-aware, not a single fixed asset: the
Torpedo's arrow points right over columns 0-4 and left over columns 5-9
(`torpedo-cursor.svg`/`torpedo-cursor-left.svg`), the Rocket's points down
over rows 0-4 and up over rows 5-9 (`rocket-cursor.svg`/
`rocket-cursor-up.svg`) - mirroring exactly which direction that weapon
would actually travel from the hovered/pressed cell (see
`getWeaponTravelIndexes()`'s own column/row <= 4 split). Harpoon needs four
variants, not two, one per quadrant
(`harpoon-cursor-down-right.svg`/`harpoon-cursor-up-left.svg`/
`harpoon-cursor-down-left.svg`/`harpoon-cursor-up-right.svg`), so the
original two-way `{ default, flipped }` asset structure built for
Torpedo/Rocket was generalized into `getWeaponDirectionKey(weapon,
cellIndex)`, returning one of `'none' | 'right' | 'left' | 'down' | 'up' |
'down-right' | 'up-left' | 'down-left' | 'up-right'`; `WEAPON_CURSOR_FILES`
and `WEAPON_PREVIEW_ICONS` (`Index.tsx`) key off that string instead of a
fixed `{ default, flipped }` shape - MOAB, Mine, and Drone have no
direction, so they only ever use `'none'`. The weapons bar's own button
icons are unaffected (still the plain bidirectional
`ArrowRightLeft`/`ArrowUpDown`/`MoveDiagonal`/`Radar`), since a button has
no cell position to point a direction at - only `GridCell`'s cursor and
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
while armed, rather than showing an error after the fact. None of the
Torpedo, Rocket, or Harpoon needed this in the end: all three can launch
from anywhere on the board, so none of them ever restricts
`isCellTargetable`.

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
of where its regular shot would land. Variable A's "weapon-aware play" has
since closed that gap: it now picks *where* to fire a chosen weapon based
on maximizing that weapon's blast zone, rather than firing wherever its
regular shot happened to land.

## Reference guides: About Ships / About Weapons

Two static, in-Settings reference dialogs (`Index.tsx`) list every ship and
weapon type, alphabetically by name, each tagged with its identifying
character (ship code) or button icon (weapon). `SHIP_REFERENCE` is always
built from the full roster including Singles (`getShips({ includeSingles:
true })`), independent of the current game's own ship-set toggle, since
it's a standing reference, not a reflection of the active round.

**Deliberately characteristics-only, not a how-to-play guide**: these
describe what a ship or weapon *is* (size, blast shape, travel pattern),
not when or why to use it tactically. That line gets blurry for the Oil
Tanker and the Mine specifically, since their defining characteristic *is*
a piece of gameplay mechanics (the spreading/ignitable slick; the
drift-then-detonate behavior) - those two get a little more mechanical
detail than a plain warship's "3-cell ship" entry, but still stop short of
strategy advice (e.g. no mention of *when* it's good to sink the tanker).
An interactive "Getting Started" tutorial is the intended home for actual
play instruction and strategy; these two dialogs exist so a player can look
up "what does this icon mean" without launching that heavier sequence.

## Statistics

A lifetime record, entirely separate from any single game's `GameState`:
persisted as `SessionStats` (`armada-game.ts`) under the single
`armada:session-stats` localStorage key, surfaced two places - the full
list in a scrollable Settings > Statistics dialog, and a "what changed this
game" callout on the Victory/Defeat dialog (see below). Ten categories,
thirteen tracked values (Hit Streak and Oil Detonation are each tracked
once per side; Win Streak and Daily Win Streak are each a Current/Best
pair):

- **Wins** - ratio and percentage. The only one that predates this feature
  (previously two standalone `games-played`/`games-won` counters); an
  install that already has those gets them folded into its first
  `SessionStats` blob the first time `loadSessionStats()` runs (`Index.tsx`)
  rather than silently resetting to zero.
- **Current Daily Win Streak / Best Daily Win Streak** - see "The Daily Win
  Streak" below. Placed right under Wins in the dialog (and, per the
  request that shipped it, ahead of the per-game stats below) since it's
  meant to be the one players actually watch day to day.
- **Quickest Win / Quickest Loss** - fewest turns (any action - a plain
  shot or any weapon, Drone included) the player has ever needed to win, or
  the computer has ever needed to beat the player. Needed a new counter
  that didn't exist before this feature: `GameState.playerTurnsTaken` /
  `appTurnsTaken`, incremented by `applyShotOutcome()` on every turn
  regardless of what else it did.
- **Margin of Victory / Margin of Defeat** - the winning side's own
  occupied-but-never-targeted cell count at the moment the game ends: how
  much of the winner's fleet never even took a hit. Margin of Victory reads
  the player's own navy on a win; Margin of Defeat reads the computer's on
  a loss - the same number either way, just whichever side actually won.
- **Current Win Streak / Best Win Streak** - consecutive wins right up to
  the most recent game, and the highest that's ever reached. Resets to 0
  the instant a loss happens; the Victory/Defeat dialog calls out either an
  extension, a new best, or the streak breaking (see below). Not to be
  confused with the Daily Win Streak above - this one is per-game, not
  per-calendar-day, and a loss resets it immediately rather than leaving it
  alone.
- **Longest Hit Streak (Me / Enemy)** - see "The Hit Streak" below.
- **Biggest Oil Detonation (Me / Enemy)** - the largest single oil-slick
  chain reaction (`resolveTargetingSequence`'s own `ignited`/
  `ignitedCellIndexes` - the 1-in-12 chain reaction, not the ordinary
  single-cell oil burn-off every hit on an oiled ship cell already causes
  regardless of that roll) either side has ever triggered, whether from a
  direct shot/weapon or their own Mine's passive wander landing on oil.
  Tracked for both sides every game, win or lose - even in a loss, the
  computer setting its own personal best is worth knowing about.

**The Daily Win Streak** exists for a different reason than every other
stat here - it's a retention mechanic, meant to give players a reason to
come back and play (and win) again tomorrow, not just a record of skill or
luck. That different purpose is exactly why it can't just reuse Current
Win Streak's own reset rule: a per-game streak that reset on every loss
would punish a player for losing a single game after already winning
earlier that same day, which defeats the point - so a loss never touches
it at all, only a win can change it, and only in three ways: no change (a
second win the same calendar day), +1 (a win on the calendar day right
after the last one), or reset to 1, not 0 (a win after skipping a whole
day, or the very first win ever - the win that "breaks" the streak also
immediately starts the next one).

`SessionStats.lastWinDate` (a `'YYYY-MM-DD'` string from
`getLocalDateString()`, always the *device's own local* calendar date, not
UTC - "did I already win today" has to agree with what day the player's
own clock says it is) is the only state this needs: on a win,
`computeSessionStatsUpdate()` compares it against the date it's handed for
"today" and decides which of the three cases above applies before updating
it. That comparison is deliberately lazy rather than proactive - a
client-only game with no server or background process has no way to
notice the moment a day rolls over while the app isn't even open, so
nothing "expires" the streak at midnight. It simply isn't recalculated
until the next time the player wins, whenever that turns out to be, and
resolves correctly regardless of how long that gap was.
`computeSessionStatsUpdate()` itself never calls `new Date()` - "today" is
passed in by its caller (`concludeGame()` in `Index.tsx`) precisely so the
function itself stays pure and testable against arbitrary dates, the same
reasoning `ShotOutcome` follows for keeping game-rule functions storage-
and clock-agnostic.

**The Hit Streak** is the one genuinely non-obvious stat, because "did this
turn count as a hit" isn't as simple as "did a ship take damage" once
Drone and Mine are in the mix. `ShotOutcome` (`armada-game.ts`) is the
single answer every weapon-fire call site in `Index.tsx` funnels through
(`shotOutcomeFromTargetingResult()` for MOAB/Mine/a plain shot,
`shotOutcomeFromTravelSteps()` for Torpedo/Rocket/Harpoon, the constant
`DRONE_SHOT_OUTCOME` for a Drone), then `applyShotOutcome()` folds into the
running streak:

- A turn counts as a hit only if it dealt real damage to at least one
  occupied, non-immune cell. Exposing a ship the weapon is immune to (see
  Variable D's ship-immunity rules) is not damage on its own - a MOAB that
  finds only an immune Submarine in its blast is a miss for streak
  purposes, same as splashing into empty water.
- A multi-cell action (MOAB's blast, a travelling weapon's whole run) is
  judged as one turn, one verdict: a hit if *any* cell in it actually took
  damage, a miss only if the whole thing whiffed.
- **A Drone never counts either way** - not a hit (it can't deal damage by
  design; see Variable D), but deliberately not a miss either. It's
  excluded from the sequence entirely, so scouting with a Drone can never
  cost a streak in progress.
- **A Mine drop that lands on empty water is also excluded**, for a
  different reason: the mine stays armed and pending, and its outcome
  isn't decided yet (see the Mine's passive per-turn wander, Variable D). A
  drop that lands on any occupied cell - a real hit, or an immune ship
  merely exposed - fully resolves that turn either way, so it always
  counts, as a hit or a miss respectively. This was a deliberate call: the
  first design (miss = miss, no exception for the Mine) would have made
  using the Mine at all a streak risk for a payoff that might not land for
  another ten turns, which felt like it would just teach players to avoid
  the weapon.
- **A Mine's own passive wander is excluded too**, on both counts - it's
  not a turn action at all, just something that happens alongside whatever
  the player actually chose to do that turn (see the Turn economy section
  above). Its damage still counts everywhere else (Margin of Victory/
  Defeat, etc.) - it's only invisible to this one streak, since there's no
  clean single turn to credit it to. Rejected alternative: crediting a
  wander-hit retroactively back to the turn the mine was originally
  dropped, so a delayed payoff could still "redeem" that turn's miss. Ruled
  out as disproportionate - it would mean replaying the streak's entire
  history forward from that point every time a mine finally connects,
  since un-breaking an old miss can cascade into merging or resurrecting
  streaks the player already saw reported as final.

**The Victory/Defeat dialog's callout** (`concludeGame()` in `Index.tsx`)
shows the standing Wins line plus a plain-English line for every record or
streak `computeSessionStatsUpdate()` reports as having changed *this*
game - a new Quickest Win, a Margin of Defeat record, a streak extending,
or a streak breaking - computed by diffing the previous `SessionStats`
against the numbers this just-concluded `GameState` produced, before the
new values are persisted. Nothing is shown for a value that didn't move
(an ordinary win that doesn't beat any personal best just shows the Wins
line and, if applicable, the plain win-streak count).

This list has no upper bound - a single game can set all nine records at
once (a first-ever win sets nearly all of them simultaneously, having
nothing yet on the books to compare against) - which fixed a real bug on
mobile: the dialog used to be vertically centered on a fixed point
(`top-[75%]`/`translate-y-[-50%]`), so a long enough list grew the dialog
downward past the bottom of the screen with no way to reach it - `position:
fixed` isn't page-scrollable, so whatever fell past the edge (usually the
OK button, and the dialog's own X) was simply gone. It's anchored from the
bottom edge instead now (`bottom-6`, growing upward only), and the record
list itself is a separately capped, scrollable box (`max-h-40
overflow-y-auto`) between the header and the footer - so the OK button and
the dialog's own close button stay put and reachable no matter how many
records a single game manages to break. The dialog's close button needed
its own fix alongside this: `Dialog` here is fully externally controlled
via `gameOver.isOpen` with no `onOpenChange`, so the built-in X (from
`DialogContent`'s own `DialogPrimitive.Close`) had nothing wired to call
and did nothing when clicked - it's now wired to `handleNewGame()`, same as
OK, since there's no sensible "cancel" once a game has already concluded.

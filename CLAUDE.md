# Working on Armada

See [GAME_DESIGN.md](GAME_DESIGN.md) for design philosophy and the reasoning
behind existing mechanics — read it before making gameplay changes.

## Test suite

This project maintains a real, persistent test suite, not throwaway
scratch tests:

- **Keep every test you write.** If you write a test during a session to
  verify a change — even a quick one — it stays in the repo afterward. Put
  game-logic tests in `src/lib/armada-game.test.ts` (create it if it
  doesn't exist yet); UI tests follow the existing pattern in
  `src/App.test.tsx` / `src/test/ErrorBoundary.test.tsx`. Don't invent a
  `__temp_*` or scratch naming convention — a test that was worth writing
  is worth keeping.
- **Run the full suite before every commit.** `npm test` runs type-check,
  lint, the full vitest suite, and a production build in one shot; a plain
  `npx vitest run` is enough for a quick check mid-task, but always run the
  full `npm test` before committing.
- **A failing test blocks the commit.** Fix the failure (or the test, if
  the test itself turns out to be wrong) before committing — don't commit
  past a red suite.

No backfill obligation: tests deleted in past sessions (before this policy)
don't need to be reconstructed unless you're touching that code anyway.

# Architecture

This document explains how Pirate Battle is put together and why. For setup, controls and the
network scenarios see [README.md](README.md).

## 1. Overview

```text
            React (menus, forms, HUD, dialogs)                 PixiJS (arena)
        ┌──────────────────────────────────────┐      ┌─────────────────────────┐
        │ features/*   state/*   api/queries   │      │ render/GameRenderer     │
        └───────▲──────────────┬───────────────┘      └────────────▲────────────┘
   HUD snapshot │              │ pause / resume / touch intent     │ reads state + events
 (useSyncExternalStore)        ▼                                   │
        ┌──────────────────────────────────────────────────────────┴────────────┐
        │ game/GameSession: frame loop, fixed-step accumulator, pause, teardown │
        └───────▲──────────────────────────────┬────────────────────────────────┘
                │ InputState                   │ step()
        ┌───────┴─────────┐          ┌─────────▼─────────────────────────────────┐
        │ input/          │          │ sim/Simulation: rules only (pure TS)      │
        │ InputController │          │ movement, combat, collisions, AI, spawns  │
        └─────────────────┘          └───────────────────────────────────────────┘
```

Four responsibilities are kept apart, each in its own folder with one-way dependencies:

| Layer | Folder | Knows about | Never touches |
|---|---|---|---|
| Game rules | `src/game/sim`, `src/game/config` | numbers and geometry | DOM, PixiJS, React, wall-clock time |
| Rendering | `src/game/render` | simulation state (read only), PixiJS | rules, React |
| Input | `src/game/input` | DOM key events, touch intent | rules, rendering |
| Interface state | `src/features`, `src/state`, `src/api` | React, TanStack Query | per-frame game state |

`GameSession` is the only place where these meet.

## 2. React / PixiJS integration

- **PixiJS draws** the arena, ships, projectiles, effects and the health bars above ships.
  **React draws** menus, forms, the HUD panels, touch buttons and dialogs as DOM on top of
  the canvas.
- `MatchScreen` loads the textures, then mounts `Match`, whose effect calls
  `GameSession.create({ host, assets, config, ... })` and destroys the session on cleanup.
- **No React render per frame.** The continuous combat state stays inside the simulation.
  The session publishes a small `HudState` snapshot (phase, score, whole seconds left, health)
  and replaces it only when one of those values changes; React reads it with
  `useSyncExternalStore`. In practice the HUD re-renders about once per second plus on hits
  and kills.
- **Strict Mode / fast navigation.** Creating the renderer is asynchronous. The effect keeps a
  `disposed` flag: a session that finishes initialising after its effect was cleaned up is
  destroyed immediately, so double-invoked effects never leave two canvases or two loops.
- **Restart** is a React `key` change on `Match`: the old session is torn down completely and
  a new one is built, which guarantees a clean state instead of trying to reset in place.
- **Settings snapshot.** The match reads the options once at start and freezes a `GameConfig`
  (`createMatchConfig`); later option changes only affect new matches.
- The match screen (PixiJS + game code) is a lazily loaded chunk, so the menus load fast.

## 3. Simulation cycle

- **Fixed time step** of 1/60 s (`FIXED_STEP_SEC`). The session accumulates real frame time
  and runs as many steps as fit, so movement, cooldowns, damage and spawns do not depend on
  the display refresh rate. Elapsed time is `tick * step`, which avoids floating point drift.
- **Interpolation.** Entities keep their previous transform; the renderer draws
  `prev + (current - prev) * alpha`, so motion stays smooth on 120/144 Hz displays.
- **Stall protection.** A frame gap is capped at 100 ms and at 6 steps per frame; longer
  stalls are dropped instead of being replayed as a burst.
- **Order of a step:** player (turn, thrust, weapons) → enemy AI and movement → ship
  separation → projectiles (move, collide, expire) → spawner → end conditions.
- **Events.** The simulation emits one-shot events (`shot`, `shipHit`, `enemyDestroyed`,
  `matchEnded`, ...) that the renderer and audio consume. They never flow back into the rules.
- **Determinism.** All gameplay randomness comes from a seeded PRNG (mulberry32). The same
  seed and inputs reproduce the same match, which the tests rely on.
- **Pause.** While paused no step runs: clock, cooldowns, AI and spawns are all part of the
  simulation and therefore frozen together. Pausing clears held inputs; resuming zeroes the
  accumulator and the frame timestamp, so paused time is never added or replayed. Automatic
  pause listens to `visibilitychange` and window `blur`; only a player action resumes.
- **End of match.** `step()` is a no-op once the match has ended, which stops movement,
  attacks, damage, spawns and scoring in one place. The session then reports the result once.

### Enemy behaviour

- **Chaser**: steers towards the player at its turn rate, slows down in sharp turns, and on
  contact damages the player and destroys itself without awarding a point.
- **Shooter**: approaches until `holdDistancePx`, then holds position and fires its front
  cannon when the player is within `attackRangePx`, inside its aim tolerance, in line of sight
  and the cooldown allows.
- **Navigation**: when an island blocks the straight line, enemies follow a breadth-first
  distance field towards the player over a 32 px grid (`NavGrid`). The field is rebuilt only
  when the player enters another cell and does not cut island corners.
- **Spawning**: every `spawn.intervalSec` an enemy appears on the arena border, at a point that
  is outside islands, reachable, not on top of another enemy and at least
  `minDistanceFromPlayerPx` away from the player. The first two spawns are one chaser and one
  shooter, so both types show up in every match; later spawns use the configured weights.

## 4. Collisions

- Ships are circles; islands are axis-aligned rectangles derived from the tile layout and
  inset by the soft shore of the art.
- **Ship vs island / arena**: the circle is pushed out along the shortest path and clamped to
  the arena bounds. Scraping bleeds a little speed.
- **Ship vs ship**: overlapping ships are pushed apart. A chaser touching the player triggers
  its ram instead.
- **Projectiles**: checked each step against arena bounds, islands, then the ships of the
  opposing side. A projectile is removed in the same step it resolves, so it can only ever
  apply damage once. It also expires by travelled distance or lifetime. With a 1/60 s step
  the fastest projectile moves under 9 px per step, well below the smallest ship radius, so
  no tunnelling occurs and swept tests are unnecessary.
- **Destroyed enemies** are removed from the enemy list in the step they die, which takes
  them out of AI, shooting and every collision check at once.

## 5. Rendering and resource management

- **Textures are loaded once** (`loadGameAssets`) through PixiJS `Assets` and reused by every
  match. The loader reports progress, has a timeout, and a failed attempt is not cached, so
  "Try Again" really retries. Combat cannot start before loading succeeds.
- The ship atlas ships as a Starling XML; `scripts/convert-atlas.mjs` converts it into a typed
  frame table. The UI atlas (`ui_sheet.json`) is loaded as a PixiJS spritesheet and its
  metadata (`alpha_bounds`) positions the health bar fill. Retina sheets are used when the
  device pixel ratio is above 1.25.
- **Static map baking**: water, islands and props never change, so they are flattened into a
  single render texture when the renderer is created (also removing tile seams when scaled).
- **Pooling**: effect sprites, projectile sprites and ship views are pooled and reused.
  Projectile sprite *i* simply mirrors projectile *i*.
- **Feedback**: muzzle flash and smoke, cannonball trails, water splashes, hit sparks and
  debris, hit tint, screen shake and a brief red flash on player damage, explosion and a
  sinking wreck on destruction. Hull art degrades in three stages and fires break out as
  health drops.
- **Canvas sizing**: the arena is a fixed 1600x896 logical space. CSS keeps `.arena-frame` at
  that aspect ratio inside the viewport; a `ResizeObserver` resizes the renderer and scales
  the world container. Resolution follows `devicePixelRatio` (capped at 2). HUD and touch
  controls are laid out inside the same frame with container-query units, so they scale with
  the arena and are never cropped. Resizing changes presentation only, never the rules.
- **Draw on demand**: the session owns a private `Ticker`. A frozen scene (paused match) is
  not redrawn every frame.
- **Teardown** (`GameSession.destroy`): clears the end timer, disconnects the
  `ResizeObserver`, removes the visibility, blur and key listeners, destroys the ticker,
  destroys pooled display objects and the textures generated by this renderer, and destroys
  the PixiJS application and its canvas. Shared atlas textures are kept for the next match.

## 6. Input

`InputController` merges two sources into one `InputState`: keyboard (`keydown`/`keyup` on
`window`) and touch (`setAction`, called by the on-screen buttons, each tracking its own
pointer with pointer capture). Keys are only handled, and their default prevented, while the
controller is enabled, which is only during unpaused gameplay. Disabling clears all held
actions.

## 7. Local persistence

Everything is namespaced under `pirate-battle:` in `localStorage`, read through validating
guards (`src/lib/storage.ts`); corrupt or missing data falls back to defaults.

| Key | Content |
|---|---|
| `options` | Session time, spawn time, sound toggle |
| `player` | Generated player id and name |
| `last-match` | Result of the last completed match (shown on the result screen after a refresh) |
| `outbox` | Completed matches whose registration is not confirmed yet |
| `mock:matches`, `mock:scenario`, `mock:lost-responses` | State of the mocked server |

A match in progress is not persisted: reloading on the combat route returns to the menu and
the match is discarded.

## 8. Ranking and match history

### Contracts (`src/api/contracts.ts`, shared by client and mocks)

| Method | Route | Response |
|---|---|---|
| `GET` | `/api/ranking?sessionTimeSec&enemySpawnTimeSec&page&pageSize` | `Paginated<RankingEntry>` |
| `GET` | `/api/players/:playerId/matches?page&pageSize` | `Paginated<MatchRecord>` |
| `POST` | `/api/matches` (body `MatchSubmission`) | `SubmitMatchResponse`, `201` created or `200` existing |

A `MatchSubmission` carries match id, player id and name, date, score, effective duration,
end reason and the settings used. The **match id is generated by the client** and is the
idempotency key of the `POST`.

### Client

- `src/api/http.ts`: one Axios instance (base URL, timeout) and an interceptor that turns
  every failure into an `ApiError` with a `kind` (`timeout`, `network`, `http`, `canceled`)
  and a `retryable` flag (4xx is not retried, except 408/429).
- `src/api/queries.ts`: TanStack Query hooks.
  - Query keys include the page (and, for ranking, the settings), so each page has its own
    cache entry; `keepPreviousData` avoids flicker while paginating.
  - Every request receives the query's `AbortSignal`. A superseded request is cancelled, and
    a late answer can only ever land in its own cache entry, so stale responses never
    overwrite newer data.
  - `staleTime` 15 s, `gcTime` 5 min, up to 2 retries with exponential backoff for retryable
    errors, `refetchOnMount: 'always'` (tabs revalidate whenever they are shown again),
    refetch on focus and reconnect. The UI distinguishes first load, background update,
    empty, error without data and error with cached data.

### Registering a match and recovering pending ones

1. When a match ends, the result is stored as `last-match` and appended to the `outbox`
   before any network call.
2. `usePendingMatchSync` (mounted at the app root, on every screen) sends queued matches
   with a TanStack `useMutation`. It also runs on start-up, so matches left pending by a
   refresh are picked up, and again when the browser comes back online.
3. On success the match leaves the outbox and the `ranking` and `history` queries are
   invalidated, so both tabs show the new record.
4. On failure the match stays in the outbox with its error; the result screen and the main
   menu offer a manual retry. Playing again is never blocked.

Duplicates are prevented at three levels: a match already being sent is not sent again
(status guard), concurrent calls for the same id share one in-flight request, and the server
returns the existing record for a known id. This also covers the "timeout after the server
stored the match" case: the retry simply receives the existing record.

Failures of these APIs never affect gameplay or options: they are only reached from the
Captain's Log tabs and from the background registration.

## 9. Mocking with MSW

- `src/mocks/handlers.ts` implements the three routes on top of a small in-browser database
  (`db.ts`, persisted in `localStorage`) and deterministic fixtures (`fixtures.ts`).
- `scenarios.ts` defines the reproducible network conditions. The active scenario is read on
  every request, so it can be switched at runtime from the Network Lab, the URL or
  `window.__pbMock`. Latency sequences are deterministic (fixed lists or a seeded PRNG).
- The worker is started before React renders, in every environment including the published
  build. If it cannot start, the app still boots and only the API calls fail.

## 10. Testing approach

- Tests run against the production build with a fresh context per test.
- `window.__PB_E2E__` (set by the tests before boot) enables instrumentation:
  a seeded scenario, optional config overrides and a manual clock. `window.__pb` exposes
  `getState()` and `advance(ms)`. `advance` runs the normal `stepOnce` path with the live
  input state, so real key and touch events drive the real rules.
- Asset tests block the service worker because requests routed through a service worker are
  not visible to Playwright's router.

## 11. Balancing decisions

- Arena 1600x896 with five islands leaving channels at least three tiles wide.
- Player: 100 health, 190 px/s. Front cannon 20 damage every 0.45 s (precise, long range);
  broadside 3 x 16 damage every 1.1 s per side (burst, shorter range).
- Chaser: 40 health, 140 px/s, 18 ram damage. Slower than the player, so it can be outrun
  but punishes standing still.
- Shooter: 60 health, 95 px/s, 10 damage every 1.8 s from up to 400 px, with slower
  projectiles (330 px/s) that can be dodged.
- Enemies spawn at least 420 px away, so damage is never immediate.

## 12. Known limitations

- Island collision uses rectangles, slightly smaller than the art; ship collision uses
  circles, so bows can visually overlap a shore by a few pixels.
- Enemies avoid islands but do not predict each other's paths; they are only separated when
  they overlap.
- `spawn.maxAliveEnemies` (40) skips spawns while that many enemies are alive, as a safety
  cap for extreme settings.
- Portrait orientation is not playable on phones by design (the match pauses).
- Audio uses the original WAV files; they are loaded lazily and are not required to play.
- Visual baselines are platform specific (font rasterisation differs between systems).
- The ranking board shown is the one of the currently selected options; there is no selector
  for other settings.

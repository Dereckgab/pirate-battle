# Pirate Battle

A single-player, top-down naval shooter that runs entirely in the browser. Sail between
islands, sink enemy ships and score as many points as you can before the timer runs out.

Built with **React 19**, **TypeScript (strict)** and **PixiJS 8**. Ranking and match history are
REST APIs mocked at the network layer with **MSW**, consumed through **Axios** and
**TanStack Query**, and covered end to end with **Playwright**.

- Live demo: _add the deployed URL here_
- Architecture and design decisions: [ARCHITECTURE.md](ARCHITECTURE.md)
- Performance evidence: [docs/performance/PROFILE.md](docs/performance/PROFILE.md) and
  [docs/performance/MEMORY-INVESTIGATION.md](docs/performance/MEMORY-INVESTIGATION.md)

## Requirements

- Node.js 20.19+ or 22.12+ (developed on Node 24)
- npm 10+

## Setup

```bash
npm install
npx playwright install chromium   # only needed to run the E2E tests
npm run dev                       # http://localhost:5173
```

The project runs from a clean checkout and does not depend on any private service.

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Type-check and build the optimised bundle into `dist/` |
| `npm run preview` | Serve the production build on http://localhost:4173 |
| `npm run lint` | Lint with oxlint |
| `npm run typecheck` | Type-check app, tooling and tests |
| `npm run test:e2e` | Build, serve and run the Playwright suite (desktop + mobile Chromium) |
| `npm run test:e2e:ui` | Playwright UI mode |
| `npm run test:e2e:update` | Re-generate the visual regression baselines |
| `npm run test:report` | Open the last HTML test report |
| `npm run perf` | Profile the production build (run `npm run build` first) |
| `node scripts/retained-instances.mjs` | Count live game/PixiJS instances after match cycles (needs `npm run dev` running) |
| `npm run atlas` | Re-generate the ship atlas frame table from the XML atlas |

## Environment variables

All variables are optional. Create a `.env.local` to override them at build time.

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE_URL` | `/api` | Base URL of the ranking / match history API (served by MSW) |
| `VITE_API_TIMEOUT_MS` | `4000` | Axios request timeout in milliseconds |

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Sail forward | `W` or `↑` | Up arrow button (bottom left) |
| Turn left / right | `A` `D` or `←` `→` | Curved arrow buttons (bottom left) |
| Front cannon (1 projectile) | `Space` | Middle cannon button (bottom right) |
| Left broadside (3 projectiles) | `Q` | Left cannon button (bottom right) |
| Right broadside (3 projectiles) | `E` | Right cannon button (bottom right) |
| Pause / resume | `P` or `Esc` | Pause button (top right) |

Moving, turning and firing can be combined freely, with several keys or several fingers.
Game keys are only captured while a match is running; menus and forms keep normal keyboard
behaviour. The controls are listed on the main menu and in the pause dialog.

On phones the game is played in **landscape**. In portrait the match pauses and asks for the
device to be rotated; menus work in both orientations.

The match pauses automatically when the window loses focus or the tab is hidden, and only
resumes on a player action.

## Gameplay configuration

Every tunable lives in one typed object: [`src/game/config/gameConfig.ts`](src/game/config/gameConfig.ts).
Balancing never requires touching the systems.

| Group | Parameters |
|---|---|
| `match` | `durationSec` |
| `spawn` | `intervalSec`, `weights.chaser` / `weights.shooter`, `minDistanceFromPlayerPx`, `maxAliveEnemies` |
| `player`, `chaser`, `shooter` | `maxHealth`, `maxSpeed`, `acceleration`, `drag`, `turnRate`, `radius` |
| `player.frontCannon`, `player.broadside`, `shooter.cannon` | `cooldownSec`, `damage`, `projectileSpeed`, `rangePx`, `lifetimeSec` (+ `projectileCount`, `spacingPx` for the broadside) |
| `chaser` | `ramDamage` |
| `shooter` | `attackRangePx`, `holdDistancePx`, `aimToleranceRad` |
| `projectile` | `radius` |

The **Options** screen exposes two of them, validated and persisted in `localStorage`:

| Option | Limits | Default |
|---|---|---|
| Game session time | 60 to 180 seconds (whole seconds) | 120 |
| Enemy spawn time | 0.5 to 10 seconds | 3 |

A match takes a frozen snapshot of the configuration when it starts; changing the options
afterwards only affects new matches.

## Ranking and match history

Both live in the **Captain's Log** (buttons *Ranking* and *Match History* on the main menu).

- The ranking compares matches played with the **same settings** (session time + spawn time)
  and shows the board for the options currently selected.
- Order: higher score first; ties go to the match played earlier, then to the smaller match id.
- Other players are deterministic fixtures generated per settings board.
- A finished match is queued on the device first and then registered. If registration fails
  it stays pending (across refreshes), is retried automatically on start-up and when the
  connection returns, and can be retried manually from the result screen or the main menu.
- An abandoned match (leaving or reloading during combat) is never registered.

## Mocked network: scenarios

The MSW handlers back development, tests **and the published build**. Open
**Main menu → Network lab** to pick a scenario, set the base latency and seed, and apply it.
**Reset Mocks** restores the default scenario and deletes every registered match.

| Scenario id | What it does |
|---|---|
| `success` | Every request succeeds after the base latency; lists span multiple pages |
| `empty` | Ranking and history answer with empty lists |
| `slow` | Every response takes 2.5 s |
| `variable-latency` | Seeded random latency between 100 ms and 2 s |
| `out-of-order` | Earlier requests answer later than newer ones (1.8 s, 0.2 s, 1.2 s, 0.1 s, ...) |
| `timeout` | Requests never answer, so the 4 s client timeout fires |
| `offline` | Network-level failure on every request |
| `http-400` / `http-500` | Every request answers with that status |
| `ranking-error` / `history-error` | Only that query fails with HTTP 500 |
| `submit-timeout-after-save` | The first registration of each match is stored but its response is lost |
| `submit-unavailable` | Registration answers HTTP 503 while queries keep working |

Other ways to select a scenario:

```text
# URL (shareable): applied on load and persisted
https://<host>/?scenario=http-500&latency=0&seed=1

# Browser console
__pbMock.setScenario({ id: 'out-of-order' })
__pbMock.getScenario()
__pbMock.getMatches()   // matches confirmed by the mock server
__pbMock.reset()        // default scenario, empty database
```

### Reproducing failures

| Goal | Steps |
|---|---|
| Ranking query fails | Network lab → *Ranking unavailable* → Apply → open Ranking. *Try again* after switching back to *Success* recovers. |
| History query fails | Same with *History unavailable*. |
| Timeout / offline / 4xx / 5xx | Pick *Timeout*, *Connection failure*, *HTTP 400* or *HTTP 500*, then open either tab. The game stays fully playable. |
| Timeout after registering, no duplicate | Pick *Timeout after registering*, play a match to the end. The result screen shows "Registering battle…" for ~4 s, then "Saved". `__pbMock.getMatches()` and the History tab show exactly one record. |
| API down at the end of the match | Pick *Registration unavailable*, finish a match: the result reports the failure and keeps the match. Refresh if you like, switch to *Success*, press *Retry registration*: it is registered once. |
| Stale response must not win | Open Ranking, apply *Out-of-order responses*, press *Next page* twice quickly: page 3 stays on screen when the slow page 2 answer arrives. |
| Asset loading failure | DevTools → Network → block `ships_miscellaneous_sheet.png`, press Play: an error with *Try Again* appears; unblock and retry. |

## Tests

```bash
npm run test:e2e        # builds, serves on :4173, runs both projects
npm run test:report     # HTML report (playwright-report/)
```

- Projects: `desktop-chromium` (1280x720, full suite) and `mobile-chromium`
  (Pixel 7 landscape, touch; the main flows tagged `@mobile`).
- Tests run against the **production build**. Each test gets a fresh browser context, so
  storage, service worker and mock database are isolated.
- Combat tests drive the real controls (keyboard events, real multi-touch through CDP) and use
  a seeded scenario with a manual simulation clock (`window.__pb.advance(ms)`), so results are
  identical on every run. The instrumentation only observes state and moves the clock; rules,
  input, collisions and rendering are the production code paths.
- Failures keep a Playwright trace and screenshot in `test-results/`.
- Visual baselines live in `e2e/visual.spec.ts-snapshots/` and are platform specific
  (generated on Windows). On another OS run `npm run test:e2e:update` once.
- A report of the last full run is committed in [`docs/test-report/`](docs/test-report/).

## Project structure

```text
src/
  game/            Framework-free game code
    config/        Typed gameplay configuration
    sim/           Rules: movement, combat, collisions, AI, spawning (no rendering, no DOM)
    render/        PixiJS renderer and asset loading
    input/         Keyboard + touch -> intent
    audio/         Web Audio wrapper
    GameSession.ts Frame loop, pause, HUD store, teardown
  features/        React screens (menu, options, match, result, log, network lab)
  api/             Contracts, Axios client, TanStack Query hooks
  mocks/           MSW handlers, fixtures, scenarios, in-browser database
  state/           Persisted options, last result and pending registrations
e2e/               Playwright tests and visual baselines
scripts/           Atlas conversion and profiling
public/assets/     Sprites, tiles, UI and sounds from the challenge kit
```

## Assets and licences

All art and audio comes from the asset kit supplied with the challenge
(`junglegaming/game-developer-challenge`), copied unmodified into `public/assets/`.
No third-party art, fonts or sounds were added; the UI uses system fonts.
The only derived file is `src/game/render/shipAtlasFrames.ts`, generated from
`ships_miscellaneous_sheet.xml` by `scripts/convert-atlas.mjs`.

## Deployment

The app is a static site (`npm run build` → `dist/`). On Vercel, Netlify or Cloudflare Pages
use the build command `npm run build` and the output directory `dist`. Routing is hash based,
so no rewrite rules are needed and reloading any URL works. `public/mockServiceWorker.js` must
be served from the site root, which those hosts do by default.

# Memory investigation: start / play / exit cycles

Goal: check that leaving a match releases what the match created, and look into any resource
that keeps growing. Numbers come from the environment described in [PROFILE.md](PROFILE.md).

## Method

1. `npm run perf` plays five cycles (start a match, fight for 8 s, pause, back to the main
   menu) on the production build and samples, after a forced garbage collection, the JS heap,
   DOM node count, event listener count and number of canvases (Chrome DevTools Protocol
   `Performance.getMetrics`).
2. `node scripts/retained-instances.mjs` (with `npm run dev` running) plays six cycles and then
   counts the **live instances per class** after a garbage collection
   (`Runtime.queryObjects`). The development server is used because class prototypes can be
   imported by module URL there. Note that Strict Mode doubles the sessions in development:
   six cycles create twelve sessions and twelve renderers.

## Findings

### A false positive first

The first version of the profiling script reported +100 DOM nodes and +32 event listeners per
cycle. The cause was the script itself: `page.waitForSelector` returns an element handle that
keeps the arena element, and through it the whole detached match DOM, alive. After switching
to `locator.waitFor()` the growth disappeared. No change to the game was needed.

### DOM nodes, listeners and canvases: flat

See the table in [PROFILE.md](PROFILE.md): the node and listener counts on the main menu are
identical after every cycle, and no canvas is left behind.

### Game and renderer objects: none retained

Live instances after six cycles (twelve sessions) and a garbage collection:

| Class | Live instances |
|---|---|
| `GameSession`, `Simulation`, `GameRenderer`, `InputController` | 0 |
| PixiJS `Application`, `WebGLRenderer`, `RenderTexture`, `GraphicsContext` | 0 |
| `HTMLCanvasElement`, `WebGL2RenderingContext` | 0 |
| PixiJS `Ticker` | 1 (the library's shared ticker) |
| PixiJS `Texture` / `TextureSource` | 178 / 13 (the atlases shared by all matches, by design) |
| PixiJS `Container` / `Sprite` / `Graphics` | 25 / 1 / 1 (library internals) |

So every match, its renderer, its WebGL context, its canvas, its listeners and its generated
textures are released on exit; only the shared atlas textures stay, as intended.

### JS heap: small residual growth

Over twenty short cycles the heap measured on the menu went from 6.8 MB to 8.9 MB: about
0.2 MB per cycle for the first cycles, flattening to roughly 0.05 MB per cycle afterwards.

With no game, renderer or DOM object retained, this residue could not be attributed to
objects owned by the game. The likely sources are caches inside the libraries and the engine
(PixiJS object pools that grow to their high-water mark, compiled shader and program
caches, V8 code and inline-cache metadata), but that was **not confirmed** with a heap
snapshot diff. It is recorded here as an open observation rather than a solved one. At the
measured rate, a hundred consecutive matches would add about 5 MB.

## Limitations

- GPU memory is not visible to these measurements; it is covered indirectly by the fact that
  no WebGL context or render texture survives a match.
- The instance census runs on the development build; the heap and DOM numbers come from the
  production build.

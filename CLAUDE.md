# Orbits — Orbital Mechanics Simulator

## Session bootstrap

- **Repo:** `github.com/mrkahler/orbits`
- **Active branch:** `claude/orbital-mechanics-simulator-iMjEH`
- **Live URL:** `https://mrkahler.github.io/orbits/` (GitHub Pages, auto-deploys on push)
- **Stack:** Pure HTML + CSS + ES6 modules. No build step, no bundler, no dependencies.
- **Always commit and push at the end of every session.**

---

## Architecture

```
index.html          Entry point. Loads src/main.js as type="module".
style.css           All styles. Dark space theme. Base font 14px monospace.
src/
  Vector2.js        2D vector math (add, sub, mul, norm, perp, cross, rot, etc.)
  Constants.js      G constant, PRESETS (Earth/Moon/Mars/Sun masses/radii/colours),
                    SIM_CONFIG (step sizes, prediction limits).
  Bodies.js         Body class (planets/moons) and Spacecraft class.
                    Both have .type ('body' | 'spacecraft'), .position, .velocity,
                    .trail[], .addTrail(). Spacecraft has .predictedPath[], .pathDirty.
  Physics.js        gravAccel(), rk4Step(), stepBodies(), stepSpacecraft(),
                    predictPath() — shadow-simulates N-body forward for trajectory preview.
  OrbitalMath.js    orbitalElements(r, v, mu) → {a, e, h, energy, rPe, rAp, period, omega, nu}
                    hohmannTransfer(r1, r2, mu) → {dv1, dv2, totalDv, transferTime, aT}
                    getDominantBody(pos, bodies), orbitEllipsePoints(), apPePositions()
  Camera.js         Pan/zoom. worldToScreen() flips Y so +Y is up on screen.
                    screenToWorld() is the inverse. zoomAt() keeps world point fixed.
  Renderer.js       All canvas drawing. render(sim) is the single entry point.
                    Draws: stars, scale rings, SOI circle (Moon), body trails+glow,
                    spacecraft trails, predicted path (solid), Keplerian ellipse (dashed),
                    Ap/Pe markers, velocity arrow, Hohmann overlay, free-return overlay.
  Simulation.js     Game loop owner. Holds bodies[], spacecraft[], simTime, timeWarp.
                    update(ts) runs RK4 sub-steps, executes scheduled burns, updates trails,
                    triggers path predictions when craft.pathDirty=true.
                    setupHohmannTransfer(altKm), executeHohmannBurn1(), cancelHohmann()
                    calculateFreeReturn(), executeFreeReturn(), cancelFreeReturn()
                    _scheduledBurns[] handles timed burn 2 for Hohmann.
  UI.js             Event handling, HUD, right panel. Mode: 'select'|'placeBody'|'placeCraft'.
                    _updateInfoPanel() drives right panel + vessel HUD visibility.
                    _placeBody() and _placeCraft() both auto-compute circular orbit velocity.
                    _selectAt() hit-tests bodies then spacecraft.
  main.js           Creates Camera, Simulation, Renderer, UI. Seeds Earth + Moon.
                    Runs requestAnimationFrame loop: ui.update() → sim.update(ts) → renderer.render(sim).
```

---

## Coordinate system

- World units: **km** for distance, **km/s** for velocity, **seconds** for time.
- Physics constants: `G = 6.674e-20` km³/(kg·s²).
- World origin: Earth starts at (0, 0).
- Y-axis: **+Y is up** in world space. `Camera.worldToScreen()` negates Y for canvas.
- All orbital math uses standard right-hand conventions (CCW orbits are positive h).

---

## Key values

| Body  | Mass (kg)    | Radius (km) | μ (km³/s²)       |
|-------|-------------|-------------|------------------|
| Earth | 5.972 × 10²⁴ | 6 371       | 3.986 × 10⁵      |
| Moon  | 7.342 × 10²² | 1 737       | 4.905 × 10³      |
| LEO   | —           | 6 771       | v ≈ 7.67 km/s    |
| Moon orbit | —      | 384 400     | v ≈ 1.022 km/s   |
| Moon SOI | —        | 66 100 km from Moon | —          |

---

## UI layout

```
┌─────────────────── toolbar (mode buttons, presets, sim time) ───────────────┐
│                                                      │                       │
│                    canvas                            │   right panel         │
│                                                      │   - object info       │
│                                                      │   - maneuvers         │
│                                                      │     (Hohmann,         │
│                                                      │      free return)     │
│                                                      │   - tips              │
├─── vessel HUD (shown when spacecraft selected) ──────┤                       │
│  name + alt + speed  │  Δv input + PRO/RET/NML/ANT  │  Pe/Ap/Period/ecc    │
└──────────────────────────────────────────────────────┴───────────────────────┘
┌─────────────────── bottom bar (pause, time warp 0.1×–100k×) ────────────────┘
```

Keyboard shortcuts: `Space` pause, `F` focus camera, `Esc` deselect, `Del` delete.

---

## Rendering layers (draw order)

1. Black background
2. Stars (screen-fixed random dots)
3. Scale rings (concentric dashed circles around most massive body)
4. Body trails → SOI circle → atmospheric glow → body disc → label
5. Keplerian reference ellipse (dashed, `rgba(80,160,255,0.45)`) + Ap/Pe markers
6. Hohmann transfer overlay (yellow arc + target orbit circle)
7. Free-return overlay (green path)
8. Spacecraft trails → predicted path (solid, `rgba(130,220,255,0.90)`) → triangle → velocity arrow

---

## Physics pipeline per frame

```
realDt = min(frameDelta, 100ms)
simDt  = realDt × timeWarp
steps  = ceil(simDt / 10s)          // max 10s per sub-step
for each sub-step:
  stepBodies(bodies, stepDt)         // RK4, N-body, non-fixed only
  for each spacecraft:
    stepSpacecraft(craft, bodies, dt) // RK4
    collision check vs all bodies
  simTime += stepDt
  fire any scheduledBurns whose executeTime ≤ simTime
update trails
if craft.pathDirty: predictPath() and cache in craft.predictedPath
```

---

## Maneuver implementations

**Hohmann transfer**
- `setupHohmannTransfer(altKm)` — finds dominant body, computes r1/r2, calls `hohmannTransfer()`,
  simulates the transfer arc by replaying burn1 then integrating for transferTime.
- `executeHohmannBurn1()` — applies dv1 prograde immediately, pushes burn2 onto `_scheduledBurns`
  to fire automatically after `transferTime` seconds.

**Free-return trajectory**
- Binary search (28 iterations) over TLI burn magnitude 2.6–4.5 km/s.
- Each trial: full N-body simulation up to 11 days at dt=120s, Moon moves.
- Success criteria: passes within Moon SOI (66 100 km), then returns within
  Earth radius + 2 000 km after exiting SOI.
- Result stored in `sim.freeReturnPath` (drawn green) and `sim.freeReturnDv`.

---

## Known issues / future work

- [ ] Free-return search can fail if Moon is in an unfavourable position — needs
      a smarter injection-angle search, not just magnitude bisection.
- [ ] No maneuver nodes — burns are immediate, not placeable on the orbit.
- [ ] No inclination (2D only) — a 3D upgrade would need quaternions and a z-axis.
- [ ] Spacecraft selection is hard at default zoom (LEO craft is only ~4px outside
      Earth's rendered disc). Consider a zoom-to-LEO button or larger click target.
- [ ] Time warp above ~10 000× can cause numerical drift for tight Moon orbits.
- [ ] No save/load of simulation state.

---

## Workflow for future sessions

1. Read this file first — do not ask the user to re-explain the project.
2. Make the requested changes to the specific files listed above.
3. Commit with a descriptive message and push to the branch.
4. Update the "Known issues / future work" section if items are resolved or added.

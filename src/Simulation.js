import { Vector2 } from './Vector2.js';
import { stepBodies, stepSpacecraft, predictPath, rk4Step } from './Physics.js';
import { orbitalElements, getDominantBody, hohmannTransfer } from './OrbitalMath.js';
import { SIM_CONFIG } from './Constants.js';

export class Simulation {
  constructor() {
    this.bodies     = [];
    this.spacecraft = [];
    this.simTime    = 0;      // seconds elapsed in simulation
    this.timeWarp   = 1;
    this.paused     = false;
    this.selected   = null;
    this._lastTs    = null;

    // Maneuver overlays
    this.hohmannData     = null;
    this.freeReturnPath  = null;
    this.freeReturnDv    = null;
    this.freeReturnAngle = null;
    this.freeReturnWait  = null;  // seconds until scheduled TLI burn

    // Timed burns: [{ spacecraft, dvMag, executeTime, onExecute }]
    this._scheduledBurns = [];
  }

  // ------------------------------------------------------------------
  // Object management
  // ------------------------------------------------------------------

  addBody(body)       { this.bodies.push(body); return body; }
  addSpacecraft(s)    { this.spacecraft.push(s); return s; }

  removeObject(id) {
    this.bodies     = this.bodies.filter(b => b.id !== id);
    this.spacecraft = this.spacecraft.filter(s => s.id !== id);
    if (this.selected?.id === id) this.selected = null;
    this.hohmannData     = null;
    this.freeReturnPath  = null;
    this.freeReturnDv    = null;
    this.freeReturnAngle = null;
    this.freeReturnWait  = null;
    this._scheduledBurns = this._scheduledBurns.filter(b => !b.isFreeReturn);
  }

  // ------------------------------------------------------------------
  // Main update — called every animation frame
  // ------------------------------------------------------------------

  update(ts) {
    if (this._lastTs === null) { this._lastTs = ts; return; }
    if (this.paused) {
      this._lastTs = ts;
      // Still recompute predictions while paused so burn previews update.
      for (const craft of this.spacecraft) {
        if (craft.pathDirty && !craft.crashed) {
          this._updatePrediction(craft);
          craft.pathDirty = false;
        }
      }
      return;
    }

    let realDt = Math.min((ts - this._lastTs) / 1000, 0.1); // cap at 100 ms
    this._lastTs = ts;

    const simDt   = realDt * this.timeWarp;
    const maxStep = SIM_CONFIG.MAX_PHYS_STEP;
    const nSteps  = Math.max(1, Math.ceil(simDt / maxStep));
    const stepDt  = simDt / nSteps;

    for (let i = 0; i < nSteps; i++) {
      stepBodies(this.bodies, stepDt);

      for (const craft of this.spacecraft) {
        if (!craft.crashed) {
          stepSpacecraft(craft, this.bodies, stepDt);

          // Collision detection
          for (const b of this.bodies) {
            if (b.radius > 0 && craft.position.distTo(b.position) < b.radius) {
              craft.crashed = true;
              craft.velocity = b.velocity.clone();
              break;
            }
          }
        } else {
          // Crashed — move with the body it hit
          craft.position = craft.position.add(craft.velocity.mul(stepDt));
        }
      }

      this.simTime += stepDt;

      // Execute any scheduled burns
      this._scheduledBurns = this._scheduledBurns.filter(burn => {
        if (this.simTime >= burn.executeTime) {
          const dir = burn.spacecraft.velocity.norm();
          burn.spacecraft.applyBurn(dir.mul(burn.dvMag));
          burn.onExecute?.();
          return false;
        }
        return true;
      });
    }

    // Trails
    for (const b  of this.bodies)     b.addTrail();
    for (const s  of this.spacecraft) s.addTrail();

    // Path prediction (lazy — only when dirty)
    for (const craft of this.spacecraft) {
      if (craft.pathDirty && !craft.crashed) {
        this._updatePrediction(craft);
        craft.pathDirty = false;
      }
    }
  }

  // ------------------------------------------------------------------
  // Orbital path prediction
  // ------------------------------------------------------------------

  _updatePrediction(craft) {
    const dom = getDominantBody(craft.position, this.bodies);
    const dt  = SIM_CONFIG.PRED_DT;
    let steps = 2000;

    if (dom) {
      const relPos = craft.position.sub(dom.position);
      const relVel = craft.velocity.sub(dom.velocity);
      try {
        const el = orbitalElements(relPos, relVel, dom.mu);
        if (el && isFinite(el.period) && el.period > 0) {
          // Show 2 full orbits, capped at max
          steps = Math.min(SIM_CONFIG.PRED_MAX_STEPS, Math.ceil(2 * el.period / dt));
        }
      } catch { /* ignore */ }
    }

    craft.predictedPath = predictPath(craft, this.bodies, steps, dt);
  }

  // ------------------------------------------------------------------
  // Hohmann Transfer
  // ------------------------------------------------------------------

  setupHohmannTransfer(targetAltitudeKm) {
    const craft = this.selected;
    if (!craft || craft.type !== 'spacecraft') return null;

    const dom = getDominantBody(craft.position, this.bodies);
    if (!dom) return null;

    const r1 = craft.position.distTo(dom.position);
    const r2 = dom.radius + targetAltitudeKm;
    if (r2 <= dom.radius || Math.abs(r1 - r2) < 1) return null;

    const params = hohmannTransfer(r1, r2, dom.mu);
    const transferPath = this._simTransferArc(craft, dom, params);

    this.hohmannData = {
      spacecraft: craft,
      centralBody: dom,
      targetRadius: r2,
      params,
      transferPath,
      burn1Executed: false,
      burn2Executed: false,
    };
    return this.hohmannData;
  }

  _simTransferArc(craft, dom, params) {
    // Simulate the transfer orbit after burn 1 is applied
    let pos = craft.position.clone();
    let vel = craft.velocity.add(craft.velocity.norm().mul(params.dv1));
    const path = [pos.clone()];
    const dt   = 30;
    const steps = Math.ceil(params.transferTime / dt);
    for (let i = 0; i < steps; i++) {
      const { pos: np, vel: nv } = rk4Step(pos, vel, this.bodies, dt);
      pos = np; vel = nv;
      path.push(pos.clone());
    }
    return path;
  }

  executeHohmannBurn1() {
    if (!this.hohmannData || this.hohmannData.burn1Executed) return;
    const { spacecraft: craft, params } = this.hohmannData;
    craft.burnPrograde(params.dv1);
    this.hohmannData.burn1Executed = true;
    craft.pathDirty = true;

    // Schedule burn 2
    const burn2At = this.simTime + params.transferTime;
    this._scheduledBurns.push({
      spacecraft: craft,
      dvMag: params.dv2,
      executeTime: burn2At,
      onExecute: () => {
        this.hohmannData && (this.hohmannData.burn2Executed = true);
        craft.pathDirty = true;
      },
    });
  }

  cancelHohmann() {
    this.hohmannData = null;
    this._scheduledBurns = this._scheduledBurns.filter(b =>
      this.hohmannData && b.spacecraft !== this.hohmannData?.spacecraft
    );
  }

  // ------------------------------------------------------------------
  // Free-Return Trajectory
  // ------------------------------------------------------------------

  calculateFreeReturn() {
    const craft = this.selected;
    if (!craft || craft.type !== 'spacecraft') return null;

    const earth = this.bodies.find(b => b.name === 'Earth') || this.bodies[0];
    const moon  = this.bodies.find(b => b.name === 'Moon')  || this.bodies[1];
    if (!earth || !moon) return null;

    const result = this._searchFreeReturn(craft, earth, moon);
    if (result) {
      this.freeReturnPath  = result.path;
      this.freeReturnDv    = result.dv;
      this.freeReturnAngle = result.angle;
      this.freeReturnWait  = result.waitTime;
    }
    return result;
  }

  _searchFreeReturn(craft, earth, moon) {
    const COARSE_DT = 600;        // s per step during search
    const FINE_DT   = 120;        // s per step for final display path
    const MAX_TIME  = 9 * 86400;  // 9-day simulation window

    // TLI dv search range: from just below Hohmann to slightly above escape.
    // vTLI ≈ 99.1% of vEsc for LEO — do NOT cap at 0.97×vEsc (too low).
    const r1     = craft.position.distTo(earth.position);
    const rMoon  = moon.position.distTo(earth.position);
    const vCraft = craft.velocity.sub(earth.velocity).mag();
    const vTLI   = Math.sqrt(2 * earth.mu * rMoon / (r1 * (r1 + rMoon)));
    const vEsc   = Math.sqrt(2 * earth.mu / r1);
    const dvLo   = Math.max(0.05, vTLI - vCraft - 0.1);
    const dvHi   = vEsc - vCraft + 0.5;

    // Scan one full orbit worth of departure times so the spacecraft reaches
    // the right orbital phase to intercept the Moon regardless of current angle.
    // (Default scene: Moon at 0°, craft at 0° heading +y → ideal TLI is ~56 min
    //  later when craft is at ~226° in its orbit.  Angle sweep alone won't fix
    //  this because a 75° off-prograde burn reduces effective speed below vTLI.)
    const orbPeriod  = 2 * Math.PI * Math.sqrt(r1 ** 3 / earth.mu);
    const N_DEP      = 32;   // departure samples per orbit (~11° spacing for LEO)
    const stepTime   = orbPeriod / N_DEP;
    const advSubDt   = 30;   // sub-step for advancing between departure points

    // Shadow copies: advance spacecraft + bodies to each departure time
    let cPos = craft.position.clone();
    let cVel = craft.velocity.clone();
    const bSnaps = this.bodies.map(b => ({
      position: b.position.clone(),
      velocity: b.velocity.clone(),
      mu: b.mu, radius: b.radius, fixed: b.fixed,
      isEarth: b === earth, isMoon: b === moon,
    }));

    let best = null;

    for (let dep = 0; dep < N_DEP; dep++) {
      const waitTime = dep * stepTime;

      // At each departure point try 3 fine-angle offsets (±15°) to handle
      // the Moon approach geometry without requiring large off-prograde burns.
      for (const angleDeg of [-15, 0, 15]) {
        const angle = angleDeg * Math.PI / 180;
        let lo = dvLo, hi = dvHi;

        for (let iter = 0; iter < 20; iter++) {
          const mid = (lo + hi) / 2;
          // Deep-copy body snaps so _simFR doesn't corrupt the advance state
          const bc = bSnaps.map(b => ({
            ...b, position: b.position.clone(), velocity: b.velocity.clone(),
          }));
          const res = this._simFR(cPos, cVel, bc, mid, angle, COARSE_DT, MAX_TIME);

          if (res.passedMoon && res.returnedEarth) {
            // Found a complete free-return — regenerate with fine dt and return
            const bc2 = bSnaps.map(b => ({
              ...b, position: b.position.clone(), velocity: b.velocity.clone(),
            }));
            const fine = this._simFR(cPos, cVel, bc2, mid, angle, FINE_DT, MAX_TIME);
            return { dv: mid, angle, waitTime, path: fine.path };
          }

          if (!res.passedMoon) {
            lo = mid;  // need more energy to reach Moon
          } else {
            if (!best || res.earthDistAfterMoon < best.earthDistAfterMoon) {
              best = { dv: mid, angle, waitTime, path: res.path,
                       earthDistAfterMoon: res.earthDistAfterMoon };
            }
            hi = mid;  // passed Moon, reduce dv for more gravity assist
          }
        }
      }

      // Advance spacecraft and bodies to the next departure point
      if (dep < N_DEP - 1) {
        let t = 0;
        while (t < stepTime) {
          const dt = Math.min(advSubDt, stepTime - t);
          const upd = [];
          for (const bs of bSnaps) {
            if (bs.fixed) continue;
            const others = bSnaps.filter(o => o !== bs);
            const { pos, vel } = rk4Step(bs.position, bs.velocity, others, dt);
            upd.push({ bs, pos, vel });
          }
          for (const u of upd) { u.bs.position = u.pos; u.bs.velocity = u.vel; }
          const { pos, vel } = rk4Step(cPos, cVel, bSnaps, dt);
          cPos = pos; cVel = vel;
          t += dt;
        }
      }
    }

    // No full free-return found — return best partial (passed Moon closest)
    if (best) {
      const bc = bSnaps.map(b => ({
        ...b, position: b.position.clone(), velocity: b.velocity.clone(),
      }));
      const fine = this._simFR(cPos, cVel, bc, best.dv, best.angle, FINE_DT, MAX_TIME);
      return { dv: best.dv, angle: best.angle, waitTime: best.waitTime, path: fine.path };
    }

    return null;
  }

  // Simulate a free-return trajectory from given spacecraft state.
  // bSnaps is mutated (body positions advance) — pass a copy if re-using.
  _simFR(cPos0, cVel0, bSnaps, burnMag, burnAngle, dt, maxTime) {
    const burnDir = cVel0.norm().rot(burnAngle);
    let cPos = cPos0.clone();
    let cVel = cVel0.add(burnDir.mul(burnMag));

    const eSnap = bSnaps.find(b => b.isEarth);
    const mSnap = bSnaps.find(b => b.isMoon);

    const path               = [cPos.clone()];
    let passedMoon           = false;
    let returnedEarth        = false;
    let pastMoonSOI          = false;
    let earthDistAfterMoon   = Infinity;
    let simTime              = 0;
    let sampleTick           = 0;
    const sampleEvery        = Math.max(1, Math.round(3600 / dt));

    while (simTime < maxTime) {
      const upd = [];
      for (const bs of bSnaps) {
        if (bs.fixed) continue;
        const others = bSnaps.filter(o => o !== bs);
        const { pos, vel } = rk4Step(bs.position, bs.velocity, others, dt);
        upd.push({ bs, pos, vel });
      }
      for (const u of upd) { u.bs.position = u.pos; u.bs.velocity = u.vel; }

      const { pos, vel } = rk4Step(cPos, cVel, bSnaps, dt);
      cPos = pos; cVel = vel;
      simTime += dt;
      sampleTick++;

      if (sampleTick % sampleEvery === 0) path.push(cPos.clone());

      const moonDist  = cPos.distTo(mSnap.position);
      const earthDist = cPos.distTo(eSnap.position);

      if (!passedMoon && moonDist < 66100)         passedMoon = true;
      if (passedMoon && !pastMoonSOI && moonDist > 80000) pastMoonSOI = true;

      if (pastMoonSOI) {
        earthDistAfterMoon = Math.min(earthDistAfterMoon, earthDist);
        if (earthDist < eSnap.radius + 2000) {
          returnedEarth = true;
          path.push(cPos.clone());
          break;
        }
      }

      // Early exit: clearly not heading to Moon and too far out
      if (!passedMoon && simTime > 5 * 86400 && earthDist > 700000) break;
    }

    path.push(cPos.clone());
    return { passedMoon, returnedEarth, earthDistAfterMoon, path };
  }

  executeFreeReturn() {
    if (!this.selected || this.selected.type !== 'spacecraft') return;
    if (this.freeReturnDv == null) return;

    const craft    = this.selected;
    const dv       = this.freeReturnDv;
    const angle    = this.freeReturnAngle ?? 0;
    const waitTime = this.freeReturnWait  ?? 0;

    if (waitTime <= 5) {
      // Departure is now (or negligible wait) — fire immediately
      craft.applyBurn(craft.velocity.norm().rot(angle).mul(dv));
      this._clearFreeReturn();
    } else {
      // Schedule the TLI burn at the right orbital phase
      const burnAt = this.simTime + waitTime;
      this._scheduledBurns.push({
        spacecraft:  craft,
        dvMag:       0,          // actual burn handled in onExecute
        executeTime: burnAt,
        isFreeReturn: true,
        onExecute: () => {
          craft.applyBurn(craft.velocity.norm().rot(angle).mul(dv));
          craft.pathDirty = true;
          this._clearFreeReturn();
        },
      });
      // Null out trigger fields so Execute can't be double-scheduled,
      // but keep freeReturnPath overlay showing as a preview.
      this.freeReturnDv    = null;
      this.freeReturnAngle = null;
    }
  }

  cancelFreeReturn() {
    this._clearFreeReturn();
  }

  _clearFreeReturn() {
    this.freeReturnPath  = null;
    this.freeReturnDv    = null;
    this.freeReturnAngle = null;
    this.freeReturnWait  = null;
    this._scheduledBurns = this._scheduledBurns.filter(b => !b.isFreeReturn);
  }
}

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
    this.hohmannData    = null;
    this.freeReturnPath = null;
    this.freeReturnDv   = null;

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
    this.hohmannData    = null;
    this.freeReturnPath = null;
    this.freeReturnDv   = null;
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
      this.freeReturnPath = result.path;
      this.freeReturnDv   = result.dv;
    }
    return result;
  }

  _searchFreeReturn(craft, earth, moon) {
    const DT       = 120;             // s per step during search
    const MAX_TIME = 11 * 86400;      // 11 days

    // TLI magnitude range (km/s added prograde on top of current velocity)
    let dvMin = 2.6, dvMax = 4.5;
    let best = null;

    for (let iter = 0; iter < 28; iter++) {
      const dvMid = (dvMin + dvMax) / 2;
      const res   = this._simFreeReturn(craft, earth, moon, dvMid, DT, MAX_TIME);

      if (res.passedMoon && res.returnedEarth) {
        best = { dv: dvMid, path: res.path };
        break;
      }

      if (!res.passedMoon) {
        dvMin = dvMid; // too slow — didn't reach Moon
      } else if (!res.returnedEarth) {
        // Passed Moon but didn't return — either too fast (overshot) or too slow
        // Try swapping bracket intelligently
        // If minDist after Moon passage is trending away, go faster
        if (res.earthDistAfterMoon < 50000) {
          best = { dv: dvMid, path: res.path }; // close enough, accept it
          break;
        }
        // Try lowering dvMax to bring the trajectory back
        dvMax = dvMid;
      }
    }

    // Last resort: return whatever we found
    if (!best) {
      const dvMid = (dvMin + dvMax) / 2;
      const res   = this._simFreeReturn(craft, earth, moon, dvMid, DT, MAX_TIME);
      if (res.passedMoon) best = { dv: dvMid, path: res.path };
    }

    return best;
  }

  _simFreeReturn(craft, earth, moon, burnMag, dt, maxTime) {
    // Initial spacecraft state after TLI burn
    let cPos = craft.position.clone();
    let cVel = craft.velocity.add(craft.velocity.norm().mul(burnMag));

    // Clone body states
    const bSnaps = this.bodies.map(b => ({
      position: b.position.clone(),
      velocity: b.velocity.clone(),
      mu: b.mu, radius: b.radius, fixed: b.fixed,
      isEarth: b === earth, isMoon: b === moon,
    }));
    const eSnap = bSnaps.find(b => b.isEarth);
    const mSnap = bSnaps.find(b => b.isMoon);

    const path          = [cPos.clone()];
    let passedMoon      = false;
    let returnedEarth   = false;
    let pastMoonSOI     = false;
    let earthDistAfterMoon = Infinity;
    let simTime         = 0;
    const sampleEvery   = Math.max(1, Math.round(3600 / dt)); // ~1 sample per hour

    while (simTime < maxTime) {
      // Step bodies
      const upd = [];
      for (const bs of bSnaps) {
        if (bs.fixed) continue;
        const { pos, vel } = rk4Step(bs.position, bs.velocity, bSnaps.filter(o => o !== bs), dt);
        upd.push({ bs, pos, vel });
      }
      for (const u of upd) { u.bs.position = u.pos; u.bs.velocity = u.vel; }

      // Step spacecraft
      const { pos, vel } = rk4Step(cPos, cVel, bSnaps, dt);
      cPos = pos; cVel = vel;
      simTime += dt;

      if (simTime % (dt * sampleEvery) < dt) path.push(cPos.clone());

      const moonDist  = cPos.distTo(mSnap.position);
      const earthDist = cPos.distTo(eSnap.position);

      if (!passedMoon && moonDist < 66100) passedMoon = true;

      if (passedMoon && !pastMoonSOI && moonDist > 80000) pastMoonSOI = true;

      if (pastMoonSOI) {
        earthDistAfterMoon = Math.min(earthDistAfterMoon, earthDist);
        if (earthDist < earth.radius + 2000) {
          returnedEarth = true;
          path.push(cPos.clone());
          break;
        }
      }

      // Early out if we're way off course
      if (!passedMoon && simTime > 4 * 86400 && earthDist > 600000) break;
    }

    path.push(cPos.clone());
    return { passedMoon, returnedEarth, earthDistAfterMoon, path };
  }

  executeFreeReturn() {
    if (!this.selected || this.selected.type !== 'spacecraft') return;
    if (this.freeReturnDv == null) return;
    this.selected.burnPrograde(this.freeReturnDv);
    this.freeReturnPath = null;
    this.freeReturnDv   = null;
  }

  cancelFreeReturn() {
    this.freeReturnPath = null;
    this.freeReturnDv   = null;
  }
}

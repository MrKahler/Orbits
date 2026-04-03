import { Vector2 } from './Vector2.js';

/**
 * Net gravitational acceleration at `pos` from an array of gravity sources.
 * Each source needs { position: Vector2, mu: number }.
 */
export function gravAccel(pos, sources) {
  let ax = 0, ay = 0;
  for (const s of sources) {
    const dx = s.position.x - pos.x;
    const dy = s.position.y - pos.y;
    const r2 = dx * dx + dy * dy;
    if (r2 < 1) continue;
    const a = s.mu / r2;
    const r = Math.sqrt(r2);
    ax += a * dx / r;
    ay += a * dy / r;
  }
  return new Vector2(ax, ay);
}

/**
 * Classic 4th-order Runge-Kutta integrator for a single particle.
 */
export function rk4Step(pos, vel, sources, dt) {
  const f = (p, v) => ({ dp: v.clone(), dv: gravAccel(p, sources) });

  const k1 = f(pos, vel);
  const k2 = f(pos.add(k1.dp.mul(dt / 2)), vel.add(k1.dv.mul(dt / 2)));
  const k3 = f(pos.add(k2.dp.mul(dt / 2)), vel.add(k2.dv.mul(dt / 2)));
  const k4 = f(pos.add(k3.dp.mul(dt)),     vel.add(k3.dv.mul(dt)));

  const factor = dt / 6;
  return {
    pos: pos.add(k1.dp.add(k2.dp.mul(2)).add(k3.dp.mul(2)).add(k4.dp).mul(factor)),
    vel: vel.add(k1.dv.add(k2.dv.mul(2)).add(k3.dv.mul(2)).add(k4.dv).mul(factor)),
  };
}

/** Advance all non-fixed bodies by dt (N-body, each attracted by the others). */
export function stepBodies(bodies, dt) {
  const updates = [];
  for (const b of bodies) {
    if (b.fixed) continue;
    const others = bodies.filter(o => o !== b);
    const { pos, vel } = rk4Step(b.position, b.velocity, others, dt);
    updates.push({ b, pos, vel });
  }
  for (const u of updates) {
    u.b.position = u.pos;
    u.b.velocity = u.vel;
  }
}

/** Advance a single spacecraft by dt under gravity from bodies. */
export function stepSpacecraft(craft, bodies, dt) {
  const { pos, vel } = rk4Step(craft.position, craft.velocity, bodies, dt);
  craft.position = pos;
  craft.velocity = vel;
}

/**
 * Shadow-simulate the spacecraft forward and return the predicted path.
 * Body positions are also evolved so Moon motion is captured.
 */
export function predictPath(craft, bodies, steps, dt) {
  // Lightweight snapshot — only what we need
  let cPos = craft.position.clone();
  let cVel = craft.velocity.clone();

  // Clone body states as plain objects
  const bSnaps = bodies.map(b => ({
    position: b.position.clone(),
    velocity: b.velocity.clone(),
    mu: b.mu,
    radius: b.radius,
    fixed: b.fixed,
  }));

  const path = [cPos.clone()];

  for (let i = 0; i < steps; i++) {
    // Step bodies
    const upd = [];
    for (const bs of bSnaps) {
      if (bs.fixed) continue;
      const others = bSnaps.filter(o => o !== bs);
      const { pos, vel } = rk4Step(bs.position, bs.velocity, others, dt);
      upd.push({ bs, pos, vel });
    }
    for (const u of upd) { u.bs.position = u.pos; u.bs.velocity = u.vel; }

    // Step spacecraft
    const { pos, vel } = rk4Step(cPos, cVel, bSnaps, dt);
    cPos = pos;
    cVel = vel;

    path.push(cPos.clone());

    // Stop if the spacecraft has hit a body
    for (const bs of bSnaps) {
      if (bs.radius > 0 && cPos.distTo(bs.position) < bs.radius) return path;
    }
  }

  return path;
}

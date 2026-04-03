import { Vector2 } from './Vector2.js';

/**
 * Two-body orbital elements from state vectors relative to the central body.
 * @param {Vector2} r  position (km) relative to central body
 * @param {Vector2} v  velocity (km/s) relative to central body
 * @param {number}  mu standard gravitational parameter (km³/s²)
 */
export function orbitalElements(r, v, mu) {
  const rMag = r.mag();
  const vMag = v.mag();
  if (rMag < 1e-6 || mu <= 0) return null;

  // Specific orbital energy
  const energy = (vMag * vMag) / 2 - mu / rMag;

  // Semi-major axis (negative means hyperbolic)
  const a = -mu / (2 * energy);

  // Specific angular momentum (scalar, positive = CCW)
  const h = r.cross(v);

  // Eccentricity vector — points from focus toward periapsis
  const ex = (v.y * h) / mu - r.x / rMag;
  const ey = (-v.x * h) / mu - r.y / rMag;
  const eVec = new Vector2(ex, ey);
  const e = eVec.mag();

  // Periapsis / apoapsis distances from focus
  const rPe = a * (1 - e);
  const rAp = energy < 0 ? a * (1 + e) : Infinity;

  // Orbital period (elliptical only)
  const period = energy < 0
    ? 2 * Math.PI * Math.sqrt(Math.pow(Math.abs(a), 3) / mu)
    : Infinity;

  // Argument of periapsis: angle from +x to periapsis direction
  const omega = eVec.angle();

  // True anomaly: angle from periapsis to current position
  const nu = Math.atan2(eVec.cross(r), eVec.dot(r));

  return { a, e, h, energy, rPe, rAp, period, omega, nu, eVec };
}

/**
 * Returns the body whose gravitational pull dominates at `pos`.
 */
export function getDominantBody(pos, bodies) {
  let dominant = null;
  let maxG = 0;
  for (const b of bodies) {
    const r2 = pos.distTo(b.position) ** 2;
    const g = b.mu / Math.max(r2, 1);
    if (g > maxG) { maxG = g; dominant = b; }
  }
  return dominant;
}

/**
 * Hohmann transfer parameters between two circular orbits.
 * @param {number} r1  current orbit radius (km)
 * @param {number} r2  target orbit radius (km)
 * @param {number} mu  gravitational parameter (km³/s²)
 */
export function hohmannTransfer(r1, r2, mu) {
  const v1 = Math.sqrt(mu / r1);   // circular speed at r1
  const v2 = Math.sqrt(mu / r2);   // circular speed at r2
  const aT = (r1 + r2) / 2;        // semi-major axis of transfer ellipse
  const vt1 = Math.sqrt(mu * (2 / r1 - 1 / aT)); // speed at r1 on transfer
  const vt2 = Math.sqrt(mu * (2 / r2 - 1 / aT)); // speed at r2 on transfer
  const dv1 = vt1 - v1;
  const dv2 = v2 - vt2;
  const transferTime = Math.PI * Math.sqrt(aT ** 3 / mu); // half-period
  return { dv1, dv2, totalDv: Math.abs(dv1) + Math.abs(dv2), transferTime, aT, v1, v2 };
}

/**
 * Generate world-space points along the Keplerian orbital ellipse.
 */
export function orbitEllipsePoints(focalPos, el, n = 200) {
  if (!el) return [];
  const { a, e, omega, energy } = el;
  if (energy >= 0) return hyperbolaPoints(focalPos, el, n);

  const pts = [];
  const p = a * (1 - e * e); // semi-latus rectum
  for (let i = 0; i <= n; i++) {
    const nu = (i / n) * 2 * Math.PI;
    const r  = p / (1 + e * Math.cos(nu));
    pts.push(new Vector2(
      focalPos.x + r * Math.cos(nu + omega),
      focalPos.y + r * Math.sin(nu + omega),
    ));
  }
  return pts;
}

function hyperbolaPoints(focalPos, el, n) {
  const { a, e, omega } = el;
  const nuMax = Math.acos(-1 / e) - 0.03;
  const p = a * (1 - e * e); // positive for hyperbola (a < 0, e > 1 → p > 0)
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const nu = -nuMax + (i / n) * 2 * nuMax;
    const r  = p / (1 + e * Math.cos(nu));
    if (r <= 0 || r > 8e6) continue;
    pts.push(new Vector2(
      focalPos.x + r * Math.cos(nu + omega),
      focalPos.y + r * Math.sin(nu + omega),
    ));
  }
  return pts;
}

/**
 * Returns world positions of periapsis and apoapsis markers.
 */
export function apPePositions(focalPos, el) {
  const { rPe, rAp, omega, energy } = el;
  const pe = new Vector2(
    focalPos.x + rPe * Math.cos(omega),
    focalPos.y + rPe * Math.sin(omega),
  );
  if (energy >= 0) return { pe, ap: null };
  const ap = new Vector2(
    focalPos.x + rAp * Math.cos(omega + Math.PI),
    focalPos.y + rAp * Math.sin(omega + Math.PI),
  );
  return { pe, ap };
}

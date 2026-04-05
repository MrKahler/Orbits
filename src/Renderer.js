import { Vector2 } from './Vector2.js';
import { orbitalElements, getDominantBody, orbitEllipsePoints, apPePositions } from './OrbitalMath.js';

const SCALE_RINGS = [500, 1000, 5000, 10000, 50000, 100000, 200000, 384400, 1000000];
const MOON_SOI    = 66100; // km

export class Renderer {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.camera = camera;
    this.stars  = this._genStars(350);
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  _genStars(n) {
    const s = [];
    for (let i = 0; i < n; i++) {
      s.push({
        sx: Math.random(),   // normalised screen coords (stable w.r.t. canvas size)
        sy: Math.random(),
        r: 0.5 + Math.random() * 1.2,
        a: 0.25 + Math.random() * 0.75,
      });
    }
    return s;
  }

  w2s(wx, wy) { return this.camera.worldToScreen(wx, wy); }

  // ------------------------------------------------------------------
  // Drawing primitives
  // ------------------------------------------------------------------

  _clear() {
    const ctx = this.ctx;
    ctx.fillStyle = '#06060f';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _drawStars() {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    for (const s of this.stars) {
      ctx.beginPath();
      ctx.arc(s.sx * W, s.sy * H, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${s.a})`;
      ctx.fill();
    }
  }

  _drawScaleRings(bodies) {
    const ctx = this.ctx;
    // Draw rings around the most massive body (usually Earth)
    const anchor = bodies.reduce((a, b) => (b.mass > a.mass ? b : a), bodies[0]);
    if (!anchor) return;
    const sp = this.w2s(anchor.position.x, anchor.position.y);

    for (const r of SCALE_RINGS) {
      const pr = this.camera.worldRadiusPx(r);
      if (pr < 15 || pr > this.canvas.width * 3) continue;

      ctx.beginPath();
      ctx.arc(sp.x, sp.y, pr, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(40,60,120,0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 6]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label
      const label = r >= 1000 ? `${(r / 1000).toFixed(0)} Mm` : `${r} km`;
      ctx.fillStyle = 'rgba(70,100,180,0.5)';
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(label, sp.x + pr + 3, sp.y + 3);
    }
  }

  _drawSOI(body) {
    if (body.name !== 'Moon') return;
    const ctx = this.ctx;
    const sp  = this.w2s(body.position.x, body.position.y);
    const pr  = this.camera.worldRadiusPx(MOON_SOI);
    if (pr < 5 || pr > this.canvas.width * 4) return;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, pr, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(200,200,200,0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 8]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(200,200,200,0.3)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SOI', sp.x, sp.y - pr - 4);
  }

  _drawBodyTrail(body) {
    if (body.trail.length < 2) return;
    const ctx = this.ctx;
    ctx.beginPath();
    const p0 = this.w2s(body.trail[0].x, body.trail[0].y);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < body.trail.length; i++) {
      const p = this.w2s(body.trail[i].x, body.trail[i].y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = body.color + '33';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  _drawBody(body) {
    const ctx = this.ctx;
    const sp  = this.w2s(body.position.x, body.position.y);
    const r   = Math.max(this.camera.worldRadiusPx(body.radius), 7);

    this._drawBodyTrail(body);
    this._drawSOI(body);

    // Atmospheric glow for large bodies
    if (r > 8) {
      const grad = ctx.createRadialGradient(sp.x, sp.y, r * 0.85, sp.x, sp.y, r * 1.5);
      grad.addColorStop(0, body.color + '55');
      grad.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // Body disc
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
    ctx.fillStyle = body.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Label
    ctx.fillStyle = 'rgba(200,220,255,0.95)';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(body.name, sp.x, sp.y + r + 17);
  }

  _drawCraftTrail(craft) {
    if (craft.trail.length < 2) return;
    const ctx = this.ctx;
    ctx.beginPath();
    const p0 = this.w2s(craft.trail[0].x, craft.trail[0].y);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < craft.trail.length; i++) {
      const p = this.w2s(craft.trail[i].x, craft.trail[i].y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = craft.color + '55';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  _drawPolyline(points) {
    if (points.length < 2) return;
    const ctx = this.ctx;
    ctx.beginPath();
    const p0 = this.w2s(points[0].x, points[0].y);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < points.length; i++) {
      const p = this.w2s(points[i].x, points[i].y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  _drawPredictedPath(craft, selected) {
    const ctx = this.ctx;

    if (craft.pausedSnapshot?.path?.length > 1) {
      // ── Paused burn-preview mode ──────────────────────────────────────
      // Original orbit (before burns) in bright cyan
      ctx.strokeStyle = 'rgba(80,210,255,0.85)';
      ctx.lineWidth = 2.5;
      this._drawPolyline(craft.pausedSnapshot.path);

      // Proposed orbit (after burns) in vivid orange — high contrast
      if (craft.predictedPath.length > 1) {
        ctx.strokeStyle = 'rgba(255,165,30,0.95)';
        ctx.lineWidth = 3;
        this._drawPolyline(craft.predictedPath);
      }
    } else {
      // ── Normal mode ───────────────────────────────────────────────────
      if (craft.predictedPath.length < 2) return;
      ctx.strokeStyle = selected ? 'rgba(130,220,255,0.90)' : 'rgba(100,190,255,0.65)';
      ctx.lineWidth = selected ? 2.5 : 1.5;
      this._drawPolyline(craft.predictedPath);
    }
  }

  _drawSpacecraft(craft, selected) {
    const ctx = this.ctx;
    const sp  = this.w2s(craft.position.x, craft.position.y);
    const vel = craft.velocity;
    const spd = vel.mag();

    this._drawCraftTrail(craft);
    this._drawPredictedPath(craft, selected);

    // Triangle pointing in velocity direction
    // In world space: atan2(vy, vx). Canvas has Y flipped, so negate y component.
    const worldAngle = spd > 1e-10 ? Math.atan2(vel.y, vel.x) : 0;
    const size = selected ? 8 : 5;

    ctx.save();
    ctx.translate(sp.x, sp.y);
    ctx.rotate(-worldAngle); // negate because canvas Y is flipped
    ctx.beginPath();
    ctx.moveTo(size * 1.4, 0);
    ctx.lineTo(-size, size * 0.6);
    ctx.lineTo(-size, -size * 0.6);
    ctx.closePath();
    ctx.fillStyle = craft.crashed ? '#ff2222' : (selected ? '#ffffff' : craft.color);
    ctx.fill();
    ctx.restore();

    // Selection ring
    if (selected) {
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 14, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Velocity arrow (prograde)
    if (selected && spd > 1e-10) {
      const dir = vel.norm();
      const arrowLen = 45;
      const ex = sp.x + dir.x * arrowLen;
      const ey = sp.y - dir.y * arrowLen; // flip Y
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = '#ffaa00';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Arrowhead
      const a = Math.atan2(-(ey - sp.y), ex - sp.x);
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - 9 * Math.cos(a - 0.35), ey - 9 * Math.sin(a - 0.35));
      ctx.lineTo(ex - 9 * Math.cos(a + 0.35), ey - 9 * Math.sin(a + 0.35));
      ctx.closePath();
      ctx.fillStyle = '#ffaa00';
      ctx.fill();
    }
  }

  _drawOrbitalEllipse(craft, bodies) {
    const dom = getDominantBody(craft.position, bodies);
    if (!dom) return;
    const relPos = craft.position.sub(dom.position);
    const relVel = craft.velocity.sub(dom.velocity);
    let el;
    try { el = orbitalElements(relPos, relVel, dom.mu); } catch { return; }
    if (!el || isNaN(el.a)) return;

    const ctx = this.ctx;

    // Keplerian reference ellipse — dashed, clearly visible
    if (el.energy < 0) {
      const pts = orbitEllipsePoints(dom.position, el, 200);
      if (pts.length > 1) {
        ctx.beginPath();
        const p0 = this.w2s(pts[0].x, pts[0].y);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < pts.length; i++) {
          const p = this.w2s(pts[i].x, pts[i].y);
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.strokeStyle = 'rgba(80,160,255,0.55)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Ap / Pe markers
    const { pe, ap } = apPePositions(dom.position, el);
    if (pe) this._drawMarker(pe.x, pe.y, 'Pe', '#44ff88');
    if (ap) this._drawMarker(ap.x, ap.y, 'Ap', '#ff4455');
  }

  _drawMarker(wx, wy, label, color) {
    const ctx = this.ctx;
    const sp  = this.w2s(wx, wy);
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = color;
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(label, sp.x + 7, sp.y + 5);
  }

  // ------------------------------------------------------------------
  // Overlay: Hohmann transfer
  // ------------------------------------------------------------------

  _drawHohmannOverlay(data) {
    if (!data) return;
    const { centralBody, targetRadius, transferPath } = data;
    const ctx = this.ctx;

    // Target orbit circle
    const csp = this.w2s(centralBody.position.x, centralBody.position.y);
    const pr  = this.camera.worldRadiusPx(targetRadius);
    if (pr > 5 && pr < this.canvas.width * 3) {
      ctx.beginPath();
      ctx.arc(csp.x, csp.y, pr, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,200,60,0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Transfer arc
    if (transferPath && transferPath.length > 1) {
      ctx.beginPath();
      const p0 = this.w2s(transferPath[0].x, transferPath[0].y);
      ctx.moveTo(p0.x, p0.y);
      for (const pt of transferPath) {
        const p = this.w2s(pt.x, pt.y);
        ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = 'rgba(255,200,60,0.75)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // ------------------------------------------------------------------
  // Overlay: Free-return trajectory
  // ------------------------------------------------------------------

  _drawFreeReturnOverlay(path) {
    if (!path || path.length < 2) return;
    const ctx = this.ctx;
    ctx.beginPath();
    const p0 = this.w2s(path[0].x, path[0].y);
    ctx.moveTo(p0.x, p0.y);
    for (const pt of path) {
      const p = this.w2s(pt.x, pt.y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = 'rgba(80,255,140,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // ------------------------------------------------------------------
  // Main render call
  // ------------------------------------------------------------------

  render(sim) {
    this._clear();
    this._drawStars();

    if (sim.bodies.length > 0) this._drawScaleRings(sim.bodies);

    // Bodies
    for (const b of sim.bodies) this._drawBody(b);

    // Orbital ellipse for selected spacecraft
    const sel = sim.selected;
    if (sel && sel.type === 'spacecraft') {
      this._drawOrbitalEllipse(sel, sim.bodies);
    }

    // Overlays
    this._drawHohmannOverlay(sim.hohmannData);
    this._drawFreeReturnOverlay(sim.freeReturnPath);

    // Spacecraft
    for (const craft of sim.spacecraft) {
      this._drawSpacecraft(craft, sel && sel.id === craft.id);
    }
  }
}

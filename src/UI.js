import { Vector2 } from './Vector2.js';
import { Body, Spacecraft } from './Bodies.js';
import { orbitalElements, getDominantBody } from './OrbitalMath.js';
import { PRESETS } from './Constants.js';

export class UI {
  constructor(sim, renderer, canvas) {
    this.sim      = sim;
    this.renderer = renderer;
    this.camera   = renderer.camera;
    this.canvas   = canvas;

    this.mode             = 'select';   // 'select' | 'placeBody' | 'placeCraft'
    this.pendingPreset    = 'EARTH';
    this._isDragging      = false;
    this._dragStart       = null;
    this._lastMouse       = null;
    this._infoUpdateTimer = 0;

    this._setupCanvas();
    this._setupControls();
    this._resize();
    this._refreshModeButtons();
  }

  // ------------------------------------------------------------------
  // Canvas event wiring
  // ------------------------------------------------------------------

  _setupCanvas() {
    const cv = this.canvas;
    cv.addEventListener('mousedown',    e => this._onDown(e));
    cv.addEventListener('mousemove',    e => this._onMove(e));
    cv.addEventListener('mouseup',      e => this._onUp(e));
    cv.addEventListener('wheel',        e => this._onWheel(e), { passive: false });
    cv.addEventListener('contextmenu',  e => e.preventDefault());
    window.addEventListener('keydown',  e => this._onKey(e));
    window.addEventListener('resize',   () => this._resize());
  }

  _resize() {
    this.canvas.width  = this.canvas.clientWidth;
    this.canvas.height = this.canvas.clientHeight;
    this.camera.resize(this.canvas.width, this.canvas.height);
  }

  _clientXY(e) {
    const r = this.canvas.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }

  _onDown(e) {
    const { sx, sy } = this._clientXY(e);
    this._dragStart  = { sx, sy };
    this._lastMouse  = { sx, sy };
    this._isDragging = false;
  }

  _onMove(e) {
    if (!this._lastMouse) return;
    const { sx, sy } = this._clientXY(e);
    const dsx = sx - this._lastMouse.sx;
    const dsy = sy - this._lastMouse.sy;
    const moved = Math.hypot(sx - this._dragStart.sx, sy - this._dragStart.sy);
    if (moved > 4) this._isDragging = true;

    if (e.buttons && this._isDragging) {
      this.camera.pan(dsx, dsy);
    }
    this._lastMouse = { sx, sy };
  }

  _onUp(e) {
    const { sx, sy } = this._clientXY(e);
    if (!this._isDragging) {
      const wp = this.camera.screenToWorld(sx, sy);
      if (this.mode === 'select') {
        this._selectAt(sx, sy);
      } else if (this.mode === 'placeBody') {
        this._placeBody(wp.x, wp.y);
        this.mode = 'select';
        this._refreshModeButtons();
      } else if (this.mode === 'placeCraft') {
        this._placeCraft(wp.x, wp.y);
        this.mode = 'select';
        this._refreshModeButtons();
      }
    }
    this._isDragging = false;
  }

  _onWheel(e) {
    e.preventDefault();
    const { sx, sy } = this._clientXY(e);
    this.camera.zoomAt(sx, sy, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }

  _onKey(e) {
    switch (e.key) {
      case ' ':
        e.preventDefault();
        this.sim.paused = !this.sim.paused;
        this._el('btn-pause').textContent = this.sim.paused ? '▶ Resume' : '⏸ Pause';
        break;
      case 'Escape':
        this.sim.selected = null;
        this._updateInfoPanel();
        break;
      case 'Delete': case 'Backspace':
        if (this.sim.selected && !e.target.matches('input')) {
          this.sim.removeObject(this.sim.selected.id);
          this.sim.hohmannData = null;
          this.sim.freeReturnPath = null;
          this._updateInfoPanel();
        }
        break;
      case 'f': case 'F':
        this.camera.centerOn(
          this.sim.selected ? this.sim.selected.position.x : 0,
          this.sim.selected ? this.sim.selected.position.y : 0,
        );
        break;
    }
  }

  // ------------------------------------------------------------------
  // Control panel wiring
  // ------------------------------------------------------------------

  _setupControls() {
    // Mode buttons
    this._q('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.mode = btn.dataset.mode;
        if (btn.dataset.preset) this.pendingPreset = btn.dataset.preset;
        this._refreshModeButtons();
      });
    });

    // Time warp
    this._q('[data-warp]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.sim.timeWarp = parseFloat(btn.dataset.warp);
        this._q('[data-warp]').forEach(b =>
          b.classList.toggle('active', b.dataset.warp === btn.dataset.warp));
      });
    });

    // Pause
    this._el('btn-pause')?.addEventListener('click', () => {
      this.sim.paused = !this.sim.paused;
      this._el('btn-pause').textContent = this.sim.paused ? '▶ Resume' : '⏸ Pause';
    });

    // Burn buttons
    this._q('[data-burn]').forEach(btn => {
      btn.addEventListener('click', () => {
        const craft = this.sim.selected;
        if (!craft || craft.type !== 'spacecraft' || craft.crashed) return;
        const mag = parseFloat(this._el('burn-amount')?.value || '0.1');
        const dir = btn.dataset.burn;
        if (dir === 'pro')   craft.burnPrograde( mag);
        if (dir === 'retro') craft.burnPrograde(-mag);
        if (dir === 'norm')  craft.burnNormal( mag);
        if (dir === 'anti')  craft.burnNormal(-mag);
        this._updateInfoPanel();
      });
    });

    // Preset actions
    this._el('btn-preset-leo')?.addEventListener('click', () => this._spawnLEOCraft());
    this._el('btn-preset-moon')?.addEventListener('click', () => this._spawnMoon());
    this._el('btn-center')?.addEventListener('click', () => {
      const s = this.sim.selected;
      this.camera.centerOn(s ? s.position.x : 0, s ? s.position.y : 0);
    });
    this._el('btn-delete')?.addEventListener('click', () => {
      if (this.sim.selected) {
        this.sim.removeObject(this.sim.selected.id);
        this._updateInfoPanel();
      }
    });

    // Zoom to show Earth-Moon system
    this._el('btn-view-moon')?.addEventListener('click', () => {
      this.camera.centerOn(192200, 0);
      this.camera.zoom = 0.0011;
    });
    this._el('btn-view-earth')?.addEventListener('click', () => {
      this.camera.centerOn(0, 0);
      this.camera.zoom = 0.01;
    });

    // Hohmann transfer
    this._el('btn-hohmann')?.addEventListener('click', () => {
      const craft = this.sim.selected;
      if (!craft || craft.type !== 'spacecraft') {
        this._setStatus('hohmann-status', 'Select a spacecraft first.');
        return;
      }
      const alt = parseFloat(this._el('hohmann-alt')?.value || '10000');
      const data = this.sim.setupHohmannTransfer(alt);
      this._updateHohmannPanel(data);
    });
    this._el('btn-exec-hohmann')?.addEventListener('click', () => {
      this.sim.executeHohmannBurn1();
      this._updateHohmannPanel(this.sim.hohmannData);
    });
    this._el('btn-cancel-hohmann')?.addEventListener('click', () => {
      this.sim.cancelHohmann();
      this._updateHohmannPanel(null);
    });

    // Free return
    this._el('btn-free-return')?.addEventListener('click', () => {
      const craft = this.sim.selected;
      if (!craft || craft.type !== 'spacecraft') {
        this._setStatus('fr-status', 'Select a spacecraft first.');
        return;
      }
      this._setStatus('fr-status', 'Calculating… (may take a moment)');
      setTimeout(() => {
        const res = this.sim.calculateFreeReturn();
        if (res) {
          this._setStatus('fr-status', `TLI Δv: ${res.dv.toFixed(3)} km/s`);
          this._show('btn-exec-fr');
        } else {
          this._setStatus('fr-status', 'No trajectory found. Try LEO orbit near Moon.');
        }
      }, 20);
    });
    this._el('btn-exec-fr')?.addEventListener('click', () => {
      this.sim.executeFreeReturn();
      this._setStatus('fr-status', 'TLI burn executed!');
      this._hide('btn-exec-fr');
    });
    this._el('btn-cancel-fr')?.addEventListener('click', () => {
      this.sim.cancelFreeReturn();
      this._setStatus('fr-status', '');
      this._hide('btn-exec-fr');
    });
  }

  // ------------------------------------------------------------------
  // Object placement helpers
  // ------------------------------------------------------------------

  _spawnLEOCraft() {
    const earth = this.sim.bodies.find(b => b.name === 'Earth') || this.sim.bodies[0];
    if (!earth) return;
    const alt = 400; // km
    const r   = earth.radius + alt;
    const v   = Math.sqrt(earth.mu / r);
    const craft = new Spacecraft({
      name: `Vessel-${Date.now() % 9999}`,
      position: new Vector2(earth.position.x + r, earth.position.y),
      velocity: new Vector2(earth.velocity.x, earth.velocity.y + v),
      color: this._randomColor(),
    });
    this.sim.addSpacecraft(craft);
    this.sim.selected = craft;
    this._updateInfoPanel();
  }

  _spawnMoon() {
    const earth = this.sim.bodies.find(b => b.name === 'Earth') || this.sim.bodies[0];
    if (!earth) return;
    if (this.sim.bodies.find(b => b.name === 'Moon')) return;
    const md  = PRESETS.MOON;
    const r   = md.orbitRadius;
    const v   = Math.sqrt(earth.mu / r);
    const moon = new Body({
      name: 'Moon', mass: md.mass, radius: md.radius, color: md.color,
      position: new Vector2(earth.position.x + r, earth.position.y),
      velocity: new Vector2(earth.velocity.x, earth.velocity.y + v),
    });
    this.sim.addBody(moon);
  }

  _selectAt(sx, sy) {
    let closest = null, bestD = 18;
    const check = obj => {
      const sp = this.camera.worldToScreen(obj.position.x, obj.position.y);
      const d  = Math.hypot(sp.x - sx, sp.y - sy);
      const r  = Math.max(obj.radius ? this.camera.worldRadiusPx(obj.radius) : 0, 8);
      if (d < r + 12 && d < bestD + r) { bestD = d; closest = obj; }
    };
    for (const b of this.sim.bodies)     check(b);
    for (const s of this.sim.spacecraft) check(s);
    this.sim.selected = closest;
    this._updateInfoPanel();
  }

  _placeBody(wx, wy) {
    const pr = PRESETS[this.pendingPreset];
    if (!pr) return;
    const body = new Body({
      name: pr.name, mass: pr.mass, radius: pr.radius, color: pr.color,
      position: new Vector2(wx, wy),
    });
    this.sim.addBody(body);
    this.sim.selected = body;
    this._updateInfoPanel();
  }

  _placeCraft(wx, wy) {
    // Give it a circular orbit velocity around the nearest body
    let nearest = null, nearD = Infinity;
    for (const b of this.sim.bodies) {
      const d = Math.hypot(b.position.x - wx, b.position.y - wy);
      if (d < nearD) { nearD = d; nearest = b; }
    }
    let vel = Vector2.zero();
    if (nearest) {
      const v     = Math.sqrt(nearest.mu / nearD);
      const angle = Math.atan2(wy - nearest.position.y, wx - nearest.position.x);
      vel = new Vector2(
        nearest.velocity.x - Math.sin(angle) * v,
        nearest.velocity.y + Math.cos(angle) * v,
      );
    }
    const craft = new Spacecraft({
      name: `Vessel-${Date.now() % 9999}`,
      position: new Vector2(wx, wy),
      velocity: vel,
      color: this._randomColor(),
    });
    this.sim.addSpacecraft(craft);
    this.sim.selected = craft;
    this._updateInfoPanel();
  }

  _randomColor() {
    const hue = Math.random() * 360;
    return `hsl(${hue},90%,65%)`;
  }

  // ------------------------------------------------------------------
  // UI refresh
  // ------------------------------------------------------------------

  update() {
    this._infoUpdateTimer++;
    if (this._infoUpdateTimer % 6 === 0) { // ~10 Hz at 60 fps
      this._updateInfoPanel();
      this._updateTimeBar();
    }
  }

  _updateInfoPanel() {
    const infoEl     = this._el('info-panel');
    const burnEl     = this._el('burn-panel');
    const maneuverEl = this._el('maneuver-panel');
    const sel        = this.sim.selected;

    if (!sel) {
      if (infoEl) infoEl.innerHTML = '<div class="hint">Click to select an object<br><small>Scroll: zoom · Drag: pan</small></div>';
      this._hide('burn-panel'); this._hide('maneuver-panel');
      return;
    }

    if (sel.type === 'body') {
      infoEl.innerHTML = `
        <div class="info-name">${sel.name}</div>
        <div class="info-row"><span>Mass</span><span>${sel.mass.toExponential(3)} kg</span></div>
        <div class="info-row"><span>Radius</span><span>${sel.radius.toLocaleString()} km</span></div>
        <div class="info-row"><span>μ</span><span>${sel.mu.toExponential(4)} km³/s²</span></div>
        <div class="info-row"><span>Speed</span><span>${sel.velocity.mag().toFixed(3)} km/s</span></div>
      `;
      this._hide('burn-panel'); this._hide('maneuver-panel');
      return;
    }

    // Spacecraft
    if (sel.type === 'spacecraft') {
      const dom  = getDominantBody(sel.position, this.sim.bodies);
      let elHtml = '';
      if (dom) {
        const relPos = sel.position.sub(dom.position);
        const relVel = sel.velocity.sub(dom.velocity);
        try {
          const el  = orbitalElements(relPos, relVel, dom.mu);
          if (el && !isNaN(el.a)) {
            const alt = (relPos.mag() - dom.radius).toFixed(0);
            const pe  = (el.rPe - dom.radius).toFixed(0);
            const ap  = el.energy < 0 ? (el.rAp - dom.radius).toFixed(0) : '∞ (escape)';
            const spd = relVel.mag().toFixed(3);
            elHtml = `
              <div class="info-subtitle">↻ ${dom.name}</div>
              <div class="info-row"><span>Altitude</span><span>${Number(alt).toLocaleString()} km</span></div>
              <div class="info-row"><span>Periapsis</span><span>${Number(pe).toLocaleString()} km</span></div>
              <div class="info-row"><span>Apoapsis</span><span>${ap}</span></div>
              <div class="info-row"><span>Eccentricity</span><span>${el.e.toFixed(5)}</span></div>
              <div class="info-row"><span>Period</span><span>${el.energy < 0 ? fmtTime(el.period) : '—'}</span></div>
              <div class="info-row"><span>Speed</span><span>${spd} km/s</span></div>
            `;
          }
        } catch { /* ignore */ }
      }
      infoEl.innerHTML = `
        <div class="info-name">${sel.name}${sel.crashed ? ' 💥' : ''}</div>
        ${elHtml}
      `;
      this._show('burn-panel');
      this._show('maneuver-panel');
      if (sel.crashed) {
        burnEl.style.opacity = '0.4';
        burnEl.style.pointerEvents = 'none';
      } else {
        burnEl.style.opacity = '';
        burnEl.style.pointerEvents = '';
      }
    }
  }

  _updateHohmannPanel(data) {
    const status  = this._el('hohmann-status');
    const execBtn = this._el('btn-exec-hohmann');
    if (!status || !execBtn) return;
    if (!data) {
      status.innerHTML = ''; execBtn.style.display = 'none'; return;
    }
    const { params } = data;
    status.innerHTML = `
      <div>Δv₁: <b>${params.dv1.toFixed(3)}</b> km/s</div>
      <div>Δv₂: <b>${params.dv2.toFixed(3)}</b> km/s</div>
      <div>Total: <b>${params.totalDv.toFixed(3)}</b> km/s</div>
      <div>Transfer: ${fmtTime(params.transferTime)}</div>
    `;
    execBtn.style.display = data.burn1Executed ? 'none' : 'block';
  }

  _updateTimeBar() {
    const el = this._el('sim-time');
    if (el) el.textContent = `T+ ${fmtTime(this.sim.simTime)}  ×${this.sim.timeWarp}`;
  }

  _refreshModeButtons() {
    this._q('[data-mode]').forEach(btn => {
      btn.classList.toggle('active',
        btn.dataset.mode === this.mode &&
        (!btn.dataset.preset || btn.dataset.preset === this.pendingPreset)
      );
    });
  }

  // ------------------------------------------------------------------
  // Tiny DOM helpers
  // ------------------------------------------------------------------

  _el(id) { return document.getElementById(id); }
  _q(sel) { return Array.from(document.querySelectorAll(sel)); }
  _show(id) { const e = this._el(id); if (e) e.style.display = ''; }
  _hide(id) { const e = this._el(id); if (e) e.style.display = 'none'; }
  _setStatus(id, txt) { const e = this._el(id); if (e) e.innerHTML = txt; }
}

// ------------------------------------------------------------------
// Helper: format seconds as human-readable string
// ------------------------------------------------------------------
function fmtTime(s) {
  if (!isFinite(s) || isNaN(s)) return '—';
  s = Math.abs(Math.round(s));
  const d  = Math.floor(s / 86400);
  const h  = Math.floor((s % 86400) / 3600);
  const m  = Math.floor((s % 3600) / 60);
  const sc = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sc}s`;
  return `${m}m ${sc}s`;
}

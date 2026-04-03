export class Camera {
  constructor(width, height) {
    this.x    = 0;     // world-x at screen centre (km)
    this.y    = 0;     // world-y at screen centre (km)
    this.zoom = 0.01;  // pixels per km
    this.width  = width;
    this.height = height;
  }

  /** World → canvas pixel.  Y is flipped so +Y is "up" on screen. */
  worldToScreen(wx, wy) {
    return {
      x:  (wx - this.x) * this.zoom + this.width  / 2,
      y: -(wy - this.y) * this.zoom + this.height / 2,
    };
  }

  /** Canvas pixel → world km. */
  screenToWorld(sx, sy) {
    return {
      x:  (sx - this.width  / 2) / this.zoom + this.x,
      y: -((sy - this.height / 2) / this.zoom) + this.y,
    };
  }

  /** Pan by a screen-space delta (pixels). */
  pan(dsx, dsy) {
    this.x -= dsx / this.zoom;
    this.y += dsy / this.zoom; // flip Y
  }

  /** Zoom keeping the world point under the cursor fixed. */
  zoomAt(sx, sy, factor) {
    const before = this.screenToWorld(sx, sy);
    this.zoom = Math.max(1e-7, Math.min(2, this.zoom * factor));
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  /** World-space radius → screen pixels. */
  worldRadiusPx(r) { return r * this.zoom; }

  centerOn(wx, wy) { this.x = wx; this.y = wy; }

  resize(w, h) { this.width = w; this.height = h; }
}

export class Vector2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }

  add(v) { return new Vector2(this.x + v.x, this.y + v.y); }
  sub(v) { return new Vector2(this.x - v.x, this.y - v.y); }
  mul(s) { return new Vector2(this.x * s, this.y * s); }
  div(s) { return new Vector2(this.x / s, this.y / s); }
  neg()  { return new Vector2(-this.x, -this.y); }

  dot(v)   { return this.x * v.x + this.y * v.y; }
  cross(v) { return this.x * v.y - this.y * v.x; } // scalar (2D)

  mag()   { return Math.sqrt(this.x * this.x + this.y * this.y); }
  magSq() { return this.x * this.x + this.y * this.y; }

  norm() {
    const m = this.mag();
    return m > 1e-15 ? this.div(m) : new Vector2(0, 0);
  }

  angle() { return Math.atan2(this.y, this.x); }

  rot(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Vector2(this.x * c - this.y * s, this.x * s + this.y * c);
  }

  // 90° CCW — "normal" direction for a prograde-moving spacecraft
  perp() { return new Vector2(-this.y, this.x); }

  distTo(v) { return this.sub(v).mag(); }
  clone()   { return new Vector2(this.x, this.y); }

  static polar(angle, r = 1) {
    return new Vector2(Math.cos(angle) * r, Math.sin(angle) * r);
  }
  static zero() { return new Vector2(0, 0); }
}

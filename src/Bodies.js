import { Vector2 } from './Vector2.js';
import { G } from './Constants.js';

let _nextId = 1;

export class Body {
  constructor({ name, mass, radius, position, velocity = null, color = '#ffffff', fixed = false }) {
    this.id = _nextId++;
    this.type = 'body';
    this.name = name;
    this.mass = mass;
    this.radius = radius;
    this.position = toVec(position);
    this.velocity = velocity ? toVec(velocity) : Vector2.zero();
    this.color = color;
    this.fixed = fixed;
    this.mu = G * mass;
    this.trail = [];
    this.maxTrail = 300;
  }

  addTrail() {
    this.trail.push(this.position.clone());
    if (this.trail.length > this.maxTrail) this.trail.shift();
  }
}

export class Spacecraft {
  constructor({ name, mass = 1000, position, velocity = null, color = '#ff8800' }) {
    this.id = _nextId++;
    this.type = 'spacecraft';
    this.name = name || `Vessel-${_nextId}`;
    this.mass = mass;
    this.radius = 0;
    this.position = toVec(position);
    this.velocity = velocity ? toVec(velocity) : Vector2.zero();
    this.color = color;
    this.trail = [];
    this.maxTrail = 600;
    this.predictedPath = [];
    this.pathDirty = true;
    this.crashed = false;
  }

  applyBurn(dv) {
    this.velocity = this.velocity.add(dv);
    this.pathDirty = true;
  }

  burnPrograde(mag) {
    if (this.velocity.mag() < 1e-10) return;
    this.applyBurn(this.velocity.norm().mul(mag));
  }

  burnNormal(mag) {
    if (this.velocity.mag() < 1e-10) return;
    this.applyBurn(this.velocity.norm().perp().mul(mag));
  }

  addTrail() {
    this.trail.push(this.position.clone());
    if (this.trail.length > this.maxTrail) this.trail.shift();
  }
}

function toVec(v) {
  return v instanceof Vector2 ? v.clone() : new Vector2(v.x, v.y);
}

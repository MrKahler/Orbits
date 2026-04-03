import { Simulation } from './Simulation.js';
import { Camera }     from './Camera.js';
import { Renderer }   from './Renderer.js';
import { UI }         from './UI.js';
import { Body }       from './Bodies.js';
import { Vector2 }    from './Vector2.js';
import { PRESETS }    from './Constants.js';

// ------------------------------------------------------------------
// Bootstrap
// ------------------------------------------------------------------

const canvas = document.getElementById('sim-canvas');

const camera   = new Camera(canvas.clientWidth, canvas.clientHeight);
const sim      = new Simulation();
const renderer = new Renderer(canvas, camera);
const ui       = new UI(sim, renderer, canvas);

// ------------------------------------------------------------------
// Default scene: Earth + Moon
// ------------------------------------------------------------------

const EP = PRESETS.EARTH;
const earth = new Body({
  name: EP.name, mass: EP.mass, radius: EP.radius, color: EP.color,
  position: new Vector2(0, 0),
  velocity: new Vector2(0, 0),
});
sim.addBody(earth);

const MP    = PRESETS.MOON;
const moonR = MP.orbitRadius;
const moonV = Math.sqrt(earth.mu / moonR);
const moon  = new Body({
  name: MP.name, mass: MP.mass, radius: MP.radius, color: MP.color,
  position: new Vector2(moonR, 0),
  velocity: new Vector2(0, moonV),
});
sim.addBody(moon);

// Default view: centred on Earth, zoom to see LEO
camera.zoom = 0.01;
camera.centerOn(0, 0);

// ------------------------------------------------------------------
// Animation loop
// ------------------------------------------------------------------

function loop(ts) {
  ui.update();
  sim.update(ts);
  renderer.render(sim);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

export const G = 6.674e-20; // km³ / (kg · s²)

export const PRESETS = {
  EARTH: {
    name: 'Earth',
    mass: 5.972e24,
    radius: 6371,
    color: '#3a8fff',
    mu: 3.986004418e5,   // km³/s²
  },
  MOON: {
    name: 'Moon',
    mass: 7.342e22,
    radius: 1737.4,
    color: '#cccccc',
    mu: 4.9048695e3,     // km³/s²
    orbitRadius: 384400, // km from Earth
    orbitVelocity: 1.022,// km/s
  },
  MARS: {
    name: 'Mars',
    mass: 6.39e23,
    radius: 3389.5,
    color: '#e05020',
    mu: 4.2828e4,
  },
  SUN: {
    name: 'Sun',
    mass: 1.989e30,
    radius: 696000,
    color: '#ffee44',
    mu: 1.32712440018e11,
  },
};

export const SIM_CONFIG = {
  MAX_PHYS_STEP: 10,      // s — max sub-step size
  PRED_DT: 30,            // s — prediction step size
  PRED_MAX_STEPS: 6000,   // upper limit on prediction steps
  TRAIL_MAX: 500,
  DEFAULT_ZOOM: 0.01,     // px/km — shows Earth + LEO nicely
};

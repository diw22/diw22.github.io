// State that changes every frame lives here rather than in React, so the render loop never causes re-renders.
export const world = {
  manifest: null,
  mixer: null,
  takes: {},
  take: null,
  stage: null,
  scene: null,
  playing: false,
  position: 0,
  hover: null,
  energy: 0,
  onEnded: null,
  onTick: null,
  time() {
    return this.playing && this.mixer ? this.mixer.time() : this.position;
  }
};

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// How busy the music is at take time t, 0..1: the kick and the robot's own part, from the take's envelopes.
export function musicEnergy(t) {
  const take = world.take, m = world.manifest;
  if (!take || !m) return 0;
  const i = Math.min(take.envelopes.kick.length - 1, Math.max(0, Math.floor(t * m.envelope_hz)));
  const kick = take.envelopes.kick[i] / 99, robot = take.envelopes.robot[i] / 99;
  return Math.min(1, kick * kick * .8 + robot * robot * .6);
}

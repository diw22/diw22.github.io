/* Continuous, time-based demo motion. UI formatting never quantises the model. */
'use strict';
globalThis.AeroMotion = {
  transition(seconds, duration, start, target) {
    const u=Math.max(0,Math.min(1,seconds/duration));
    const blend=u*u*u*(10+u*(-15+6*u));
    if(u===1)return {angles:[...target.angles],gripper:target.gripper};
    return {angles:start.angles.map((angle,i)=>angle+(target.angles[i]-angle)*blend),
      gripper:start.gripper+(target.gripper-start.gripper)*blend};
  },
  sample(seconds, start, joints) {
    const t=Math.max(0,seconds)*.35;
    const u=Math.min(1,Math.max(0,seconds)/2.5);
    // Quintic easing gives zero starting velocity and acceleration, and joins
    // the ongoing motion without an acceleration discontinuity.
    const blend=u*u*u*(10+u*(-15+6*u));
    const angles=joints.map((joint,i)=>{
      const wave=Math.sin(t+i*.65)*Math.min(Math.abs(joint.min),joint.max)*.35;
      return Math.max(joint.min,Math.min(joint.max,start.angles[i]+(wave-start.angles[i])*blend));
    });
    const opening=50+40*Math.sin(t*.7);
    return {angles,gripper:start.gripper+(opening-start.gripper)*blend};
  }
};

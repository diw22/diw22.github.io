import * as THREE from 'three';

// Midpoint of the two fingertip collision boxes, in the gripper base frame.
export const GRIP_CENTER = new THREE.Vector3(-.0003315, .0975975, .000043);
export const ARM_JOINTS = [
  'right_arm_shoulder_pan', 'right_arm_shoulder_lift', 'right_arm_elbow_flex',
  'right_arm_wrist_flex', 'right_arm_wrist_roll'
];
export const GRIPPER_JOINT = 'right_arm_rev_motor_08';

// Solve on a separate, geometry-free chain. IK iterations never traverse STL meshes
// or temporarily change the displayed robot. All limits come from the loaded URDF.
export function createCatchSolver(robot) {
  const incoming = new Map([...robot.joints.values()].map(joint => [joint.child, joint]));
  const chain = [];
  let link = 'right_arm_Gripper_Base_v1_1';
  while (incoming.has(link)) {
    const joint = incoming.get(link);
    chain.unshift(joint);
    link = joint.parent;
  }
  const root = new THREE.Object3D();
  root.matrixAutoUpdate = false;
  let parent = root;
  const nodes = chain.map(joint => {
    const frame = new THREE.Object3D();
    parent.add(frame);
    parent = frame;
    return { joint, frame, angle: 0 };
  });
  const tip = new THREE.Object3D();
  tip.position.copy(GRIP_CENTER);
  parent.add(tip);
  const moving = nodes.filter(node => ARM_JOINTS.slice(0, 4).includes(node.joint.name));
  const position = new THREE.Vector3(), pivot = new THREE.Vector3();
  const axis = new THREE.Vector3(), offset = new THREE.Vector3(), derivative = new THREE.Vector3();
  const direction = new THREE.Vector3(), rotation = new THREE.Quaternion(), worldRotation = new THREE.Quaternion();
  const inverse = new THREE.Matrix4(), error = new THREE.Vector4();
  const jacobian = Array.from({ length: 4 }, () => new Float64Array(4));
  const system = new Float64Array(16);

  function setAngle(node, angle) {
    node.angle = THREE.MathUtils.clamp(angle, node.joint.lower, node.joint.upper);
    node.frame.quaternion.copy(node.joint.quaternion)
      .multiply(rotation.setFromAxisAngle(node.joint.axis, node.angle));
  }

  function solve(target, seed) {
    root.matrix.copy(robot.root.matrixWorld);
    for (const node of nodes) {
      const { joint, frame } = node;
      frame.position.copy(joint.position);
      frame.quaternion.copy(joint.quaternion);
      if (joint.type === 'revolute' || joint.type === 'continuous') {
        setAngle(node, joint.name === 'right_arm_wrist_roll' ? 0 : seed[joint.name] ?? joint.value);
      } else if (joint.type === 'prismatic') {
        frame.position.add(axis.copy(joint.axis).applyQuaternion(joint.quaternion)
          .multiplyScalar(seed[joint.name] ?? joint.value));
      }
    }
    root.updateMatrixWorld(true);
    let iterations = 0;
    // Damped least squares: reach the ball while keeping the fingers level, so
    // the falling ball enters the open jaws instead of passing through the palm.
    for (; iterations < 90; iterations++) {
      tip.getWorldPosition(position);
      direction.set(0, 1, 0).applyQuaternion(parent.getWorldQuaternion(worldRotation));
      if (position.distanceTo(target) < .0015 && Math.abs(direction.z) < .015) break;
      error.set(target.x - position.x, target.y - position.y, target.z - position.z, -.12 * direction.z);
      for (let i = 0; i < moving.length; i++) {
        const node = moving[i];
        node.frame.getWorldPosition(pivot);
        axis.copy(node.joint.axis).applyQuaternion(node.frame.getWorldQuaternion(worldRotation));
        derivative.crossVectors(axis, offset.copy(position).sub(pivot));
        jacobian[0][i] = derivative.x;
        jacobian[1][i] = derivative.y;
        jacobian[2][i] = derivative.z;
        jacobian[3][i] = .12 * derivative.crossVectors(axis, direction).z;
      }
      for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
        let entry = row === col ? .000064 : 0;
        for (let i = 0; i < moving.length; i++) entry += jacobian[row][i] * jacobian[col][i];
        system[row * 4 + col] = entry;
      }
      inverse.set(...system).invert();
      error.applyMatrix4(inverse);
      for (let i = 0; i < moving.length; i++) {
        const step = jacobian[0][i] * error.x + jacobian[1][i] * error.y
          + jacobian[2][i] * error.z + jacobian[3][i] * error.w;
        setAngle(moving[i], moving[i].angle + THREE.MathUtils.clamp(step, -.18, .18));
      }
      root.updateMatrixWorld(true);
    }
    return {
      pose: { ...Object.fromEntries(moving.map(node => [node.joint.name, node.angle])), right_arm_wrist_roll: 0 },
      error: tip.getWorldPosition(position).distanceTo(target),
      iterations
    };
  }
  return { solve };
}

// Port of play-inUT-NSi.js 45893-45942: retarget clips of the shared animation rig onto a miner body.
import * as THREE from 'three';
import { trackNode } from './gearAttach';
import type { MinerBody } from './presets';

/**
 * Re-bases position tracks on the target's rest positions and scales them per limb (leg / arm / hand).
 * With arms set, turns the upper arms inward and relaxes the elbows (elbows only on Idle/Walking/Running/Jump/Spawn).
 */
export function retargetClip( // zE (45893)
  clips: THREE.AnimationClip[],
  animRig: THREE.Object3D,
  target: THREE.Object3D,
  clipK: NonNullable<MinerBody['clipK']>,
  arms?: MinerBody['arms'],
): THREE.AnimationClip[] {
  const restPositions = (root: THREE.Object3D) => {
    const map = new Map<string, THREE.Vector3>();
    root.traverse((node) => map.set(node.name, node.position.clone()));
    return map;
  };
  const from = restPositions(animRig);
  const to = restPositions(target);
  const inward = new Map<string, THREE.Quaternion>();
  const elbowRest = new Map<string, THREE.Quaternion>();
  if (arms) {
    animRig.updateMatrixWorld(true);
    for (const side of [`l`, `r`]) {
      const upper = animRig.getObjectByName(`upperarm${side}`);
      const lower = animRig.getObjectByName(`lowerarm${side}`);
      if (!upper?.parent || !lower) continue;
      const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(upper.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
      inward.set(
        upper.name,
        new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(arms.inward) * (side === `l` ? -1 : 1)),
      );
      elbowRest.set(lower.name, lower.quaternion.clone());
    }
  }
  const relaxed = /^(Idle|Walking|Running|Jump|Spawn)/;
  const q = new THREE.Quaternion();
  const rest = new THREE.Quaternion();
  return clips.map((clip) => {
    const tracks = clip.tracks.map((track) => {
      const node = trackNode(track);
      const a = from.get(node);
      const p = to.get(node);
      if (track.name.endsWith(`.quaternion`) && (inward.has(node) || (elbowRest.has(node) && relaxed.test(clip.name)))) {
        const out = track.clone();
        const values = out.values;
        for (let i = 0; i < values.length; i += 4) {
          q.fromArray(values, i);
          if (inward.has(node)) q.premultiply(inward.get(node)!);
          else q.copy(rest.copy(elbowRest.get(node)!).slerp(q, arms!.elbow));
          q.toArray(values, i);
        }
        return out;
      }
      if (!track.name.endsWith(`.position`) || !a || !p) return track;
      const k = node.startsWith(`upperarm`) ? clipK.arm : node.startsWith(`handslot`) ? clipK.hand : clipK.leg;
      const out = track.clone();
      const values = out.values;
      for (let i = 0; i < values.length; i += 3) {
        values[i] = p.x + (values[i] - a.x) * k;
        values[i + 1] = p.y + (values[i + 1] - a.y) * k;
        values[i + 2] = p.z + (values[i + 2] - a.z) * k;
      }
      return out;
    });
    return new THREE.AnimationClip(clip.name, clip.duration, tracks);
  });
}

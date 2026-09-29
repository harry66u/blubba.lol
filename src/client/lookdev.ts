import * as THREE from 'three';
import { PLAYER_COLORS } from '../shared/colors';
import type { Renderer } from './render/renderer';
import { type Look, TubeMan, defaultPose } from './render/tubeMan';

/**
 * Developer view (open the game with ?lookdev): a fixed camera on a lineup of tube men at
 * different inflation levels, for judging materials, lighting and shapes. Not reachable from
 * the UI.
 */
export function startLookdev(r: Renderer): (dt: number) => void {
  const men: { man: TubeMan; pose: ReturnType<typeof defaultPose>; infl: number }[] = [];
  const looks: Partial<Look>[] = [{}, { hat: 'cap', face: 'grin' }, { pattern: 'stripes', hat: 'party' }, { face: 'shades', hat: 'tophat' }, { pattern: 'dots', hat: 'beanie' }];
  const colors = [0, 5, 3, 8, 1];
  const infl = [0, 0.3, 0.6, 0.85, 1];
  for (let i = 0; i < 5; i++) {
    const man = new TubeMan(PLAYER_COLORS[colors[i]].hex, { physical: r.profile.physical, seed: i * 7.1, look: looks[i] });
    man.setWeapon('airCannon');
    man.group.position.set(-6 + i * 3, 0, -2);
    r.scene.add(man.group);
    men.push({ man, pose: defaultPose(), infl: infl[i] });
  }
  if (new URLSearchParams(location.search).get('lookdev') === 'close') {
    // Face-to-face with the middle one.
    r.camera.position.set(0, 1.9, 1.2);
    r.camera.lookAt(0, 1.6, -2);
  } else {
    r.camera.position.set(0, 2.6, 7.5);
    r.camera.lookAt(0, 1.4, -2);
  }
  // ?lookdev=ults: ult poses instead (plain, Juice's jab, Juice flexing, Crop Duster from the side, Robot Mode).
  const ults = new URLSearchParams(location.search).get('lookdev') === 'ults';
  let t = 0;
  let nextJab = 0;
  return (dt: number) => {
    t += dt;
    if (ults && t >= nextJab) {
      nextJab = t + 3;
      men[1].man.jab();
    }
    men.forEach((m, i) => {
      m.pose.time = t;
      m.pose.dt = dt;
      m.pose.inflation = ults ? 0.2 : m.infl;
      m.pose.yaw = ults && i === 3 ? Math.PI / 2 : Math.PI; // face the camera (+Z)
      if (ults) {
        m.pose.jacked = i === 1 || i === 2;
        m.pose.bentOver = i === 3;
        m.pose.robot = i === 4;
      }
      m.man.update(m.pose);
    });
  };
}

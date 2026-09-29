import * as THREE from 'three';

/**
 * Face scans on tube men: a photo on a disc bent to wrap the round head, with a thin dark rim so
 * it reads at a distance. Textures are loaded once per face version and shared by every tube man
 * wearing them (in the match, the locker preview and replays).
 */

function bentDisc(radius: number, bend: number): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(radius, 40);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setZ(i, Math.sqrt(Math.max(0, bend * bend - x * x)) - bend);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

const photoGeo = bentDisc(1, 1.25);
const rimGeo = (() => {
  const g = bentDisc(1.09, 1.3);
  g.translate(0, 0, -0.03);
  return g;
})();
const rimMat = new THREE.MeshBasicMaterial({ color: 0x1d1b3a });

/** A face photo on the unit disc (scale it to the head). The material is the caller's to dispose. */
export function buildFacePhoto(tex: THREE.Texture): THREE.Group {
  const g = new THREE.Group();
  const photo = new THREE.Mesh(photoGeo, new THREE.MeshBasicMaterial({ map: tex }));
  photo.name = 'photo';
  g.add(new THREE.Mesh(rimGeo, rimMat), photo);
  return g;
}

export function disposeFacePhoto(g: THREE.Group): void {
  const photo = g.getObjectByName('photo') as THREE.Mesh | undefined;
  (photo?.material as THREE.Material | undefined)?.dispose();
}

const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();

/** The texture for a player's face scan (loads in the background; shows once ready). */
export function faceTexture(account: number, version: number): THREE.Texture {
  const url = `/api/face/${account}?v=${version}`;
  let tex = cache.get(url);
  if (!tex) {
    tex = loader.load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    // Sharp up close, smooth far away (no pixel stair-steps).
    tex.anisotropy = 8;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    cache.set(url, tex);
    if (cache.size > 64) {
      const [oldUrl, old] = cache.entries().next().value!;
      cache.delete(oldUrl);
      old.dispose();
    }
  }
  return tex;
}

/** A texture from an image you just scanned (locker preview before it's saved). */
export function localFaceTexture(dataUrl: string): THREE.Texture {
  const tex = loader.load(dataUrl);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

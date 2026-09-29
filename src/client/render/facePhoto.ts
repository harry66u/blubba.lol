import * as THREE from 'three';

/**
 * Face scans on tube men: the photo on a patch curved around the round head, fading out at a
 * soft oval edge so it looks printed on the vinyl rather than stuck on (no hard rim). Lit like
 * the body with a little glow of its own so it still reads on the shady side. Textures are
 * loaded once per face version and shared by every tube man wearing them (in the match, the
 * locker preview and replays).
 */

/** A patch 2 wide and `tall` high, bent around a vertical axis `bend` behind it (unit: half-width). */
function curvedPatch(bend: number, tall = 2.3): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(2, tall, 24, 24);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const a = x / bend;
    pos.setX(i, Math.sin(a) * bend);
    pos.setZ(i, (Math.cos(a) - 1) * bend);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// Bent around the head's middle: the tube man sets it 0.86 head radii wide, 1.09 radii out, so
// 1.27 half-widths puts the bend's axis right down the middle of the head.
const photoGeo = curvedPatch(1.27);

/** Soft oval mask: opaque in the middle, fading to nothing at the edge (alpha maps read green). */
let featherTex: THREE.Texture | null = null;
function feather(): THREE.Texture {
  if (featherTex) return featherTex;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  g.save();
  g.translate(size / 2, size / 2);
  g.scale(1, 1.08);
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, size * 0.48);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.58, '#fff');
  grad.addColorStop(0.94, '#000');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(0, 0, size * 0.48, 0, Math.PI * 2);
  g.fill();
  g.restore();
  featherTex = new THREE.CanvasTexture(c);
  return featherTex;
}

/** A face photo on a unit-wide curved patch (scale it to the head). The material is the caller's to dispose. */
export function buildFacePhoto(tex: THREE.Texture): THREE.Group {
  const g = new THREE.Group();
  const photo = new THREE.Mesh(
    photoGeo,
    new THREE.MeshStandardMaterial({
      map: tex,
      alphaMap: feather(),
      transparent: true,
      depthWrite: false,
      roughness: 0.7,
      emissive: 0xffffff,
      emissiveMap: tex,
      emissiveIntensity: 0.35,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  photo.name = 'photo';
  photo.renderOrder = 1;
  g.add(photo);
  return g;
}

// --- Decals -------------------------------------------------------------------------------------
// A picture the player uploads, worn on the chest like a sticker: square, with slightly soft
// rounded corners, keeping the picture's own transparency (a PNG cut-out stays cut out).

// Bent to match the chest: the tube man sets it 0.62 radii wide, just outside the body.
const decalGeo = curvedPatch(1.65, 2);

let stickerTex: THREE.Texture | null = null;
function stickerMask(): THREE.Texture {
  if (stickerTex) return stickerTex;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  g.filter = 'blur(2px)';
  g.fillStyle = '#fff';
  g.beginPath();
  g.roundRect(5, 5, size - 10, size - 10, 18);
  g.fill();
  stickerTex = new THREE.CanvasTexture(c);
  return stickerTex;
}

/** A decal on a unit-wide curved square (scale it to the chest). Dispose with disposeFacePhoto. */
export function buildDecal(tex: THREE.Texture): THREE.Group {
  const g = new THREE.Group();
  const decal = new THREE.Mesh(
    decalGeo,
    new THREE.MeshStandardMaterial({
      map: tex,
      alphaMap: stickerMask(),
      transparent: true,
      alphaTest: 0.04,
      depthWrite: false,
      roughness: 0.55,
      emissive: 0xffffff,
      emissiveMap: tex,
      emissiveIntensity: 0.25,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  decal.name = 'photo';
  decal.renderOrder = 1;
  g.add(decal);
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
  return uploadedTexture('face', account, version);
}

/** The texture for a player's custom decal. */
export function decalTexture(account: number, version: number): THREE.Texture {
  return uploadedTexture('decal', account, version);
}

function uploadedTexture(kind: 'face' | 'decal', account: number, version: number): THREE.Texture {
  const url = `/api/${kind}/${account}?v=${version}`;
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

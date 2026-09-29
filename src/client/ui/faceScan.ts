import type { AccountClient } from '../net/account';
import { el } from './dom';

/** Saved face scans are this many pixels square (small enough to load instantly for everyone). */
const OUT = 384;
/** The on-screen framing area (CSS pixels). */
const VIEW = 240;

/**
 * Face scan: take a selfie with the camera (or pick a photo), frame your face in the circle, and
 * it goes on your tube man. Accounts only, your own face only; other players can report it and
 * moderators can remove it.
 */
export function buildFaceScan(account: AccountClient, onClose: () => void): { root: HTMLElement; dispose: () => void } {
  const canvas = el('canvas', { class: 'face-stage', attrs: { width: String(VIEW * 2), height: String(VIEW * 2) } }) as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const note = el('div', { class: 'small-note face-note' });
  const zoom = el('input', { attrs: { type: 'range', min: '1', max: '3', step: '0.01', value: '1.3', 'aria-label': 'Zoom' } }) as HTMLInputElement;
  const mine = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
  const file = el('input', { attrs: { type: 'file', accept: 'image/*' }, style: 'display:none' }) as HTMLInputElement;
  const snapBtn = el('button', { class: 'btn small blue hidden', text: '📸 Snap' });
  const camBtn = el('button', { class: 'btn small', text: '🎥 Use camera' });
  const upBtn = el('button', { class: 'btn small', text: '🖼️ Pick a photo' });
  const saveBtn = el('button', { class: 'btn big green', text: 'SAVE FACE' }) as HTMLButtonElement;
  const removeBtn = el('button', { class: 'btn small ghost', text: 'Remove my face scan' });

  let video: HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  let still: HTMLImageElement | HTMLCanvasElement | null = null;
  let mirror = false;
  let ox = 0;
  let oy = 0;
  let raf = 0;
  let drag: { x: number; y: number } | null = null;

  const source = (): { img: CanvasImageSource; w: number; h: number } | null => {
    if (still) return { img: still, w: still.width, h: still.height };
    if (video && video.videoWidth) return { img: video, w: video.videoWidth, h: video.videoHeight };
    return null;
  };

  /** Draws the current framing into a square of `size` pixels (the circle is what gets kept). */
  const drawFrame = (c: CanvasRenderingContext2D, size: number, guide: boolean) => {
    c.save();
    c.clearRect(0, 0, size, size);
    c.fillStyle = '#e9e6ff';
    c.fillRect(0, 0, size, size);
    const s = source();
    if (s) {
      const scale = (size / Math.min(s.w, s.h)) * Number(zoom.value);
      const k = size / (VIEW * 2);
      c.translate(size / 2 + ox * k, size / 2 + oy * k);
      if (mirror) c.scale(-1, 1);
      c.drawImage(s.img, (-s.w * scale) / 2, (-s.h * scale) / 2, s.w * scale, s.h * scale);
    }
    c.restore();
    if (guide) {
      // Dim everything outside the circle and draw a face-shaped guide.
      c.save();
      c.fillStyle = 'rgba(29, 27, 58, 0.55)';
      c.beginPath();
      c.rect(0, 0, size, size);
      c.arc(size / 2, size / 2, size * 0.46, 0, Math.PI * 2, true);
      c.fill();
      c.strokeStyle = '#ffffff';
      c.lineWidth = size * 0.012;
      c.setLineDash([size * 0.03, size * 0.02]);
      c.beginPath();
      c.ellipse(size / 2, size / 2, size * 0.3, size * 0.38, 0, 0, Math.PI * 2);
      c.stroke();
      c.restore();
    }
  };

  const loop = () => {
    drawFrame(ctx, VIEW * 2, true);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  const stopCamera = () => {
    for (const t of stream?.getTracks() ?? []) t.stop();
    stream = null;
    video = null;
    snapBtn.classList.add('hidden');
  };

  const status = () => {
    const f = account.face;
    if (!account.account) note.textContent = 'Make a free account to use a face scan.';
    else if (f?.banned) note.textContent = 'A moderator turned off face scans for your account.';
    else if (f?.hidden) note.textContent = 'Your face scan was reported, so it is hidden until a moderator checks it.';
    else if (f?.version) note.textContent = 'Your face scan is on. Take a new one any time.';
    else note.textContent = 'Frame your face in the circle. Only use a photo of yourself.';
    removeBtn.classList.toggle('hidden', !f?.version && !f?.hidden);
    saveBtn.disabled = !account.account || !!f?.banned;
  };
  status();

  camBtn.addEventListener('click', async () => {
    try {
      stopCamera();
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } }, audio: false });
      video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      still = null;
      mirror = true;
      ox = oy = 0;
      snapBtn.classList.remove('hidden');
      note.textContent = 'Line your face up with the dotted outline, then snap.';
    } catch {
      note.textContent = "Couldn't open the camera. You can pick a photo instead.";
    }
  });
  snapBtn.addEventListener('click', () => {
    const s = source();
    if (!s) return;
    // Freeze the frame (mirrored like the preview).
    const c = document.createElement('canvas');
    c.width = s.w;
    c.height = s.h;
    const cc = c.getContext('2d')!;
    cc.translate(s.w, 0);
    cc.scale(-1, 1);
    cc.drawImage(s.img, 0, 0);
    stopCamera();
    still = c;
    mirror = false;
    note.textContent = 'Drag to move, slide to zoom. Happy with it? Save!';
  });
  upBtn.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      stopCamera();
      still = img;
      mirror = false;
      ox = oy = 0;
      URL.revokeObjectURL(img.src);
      note.textContent = 'Drag to move, slide to zoom. Happy with it? Save!';
    };
    img.onerror = () => (note.textContent = "That file isn't a picture we can use.");
    img.src = URL.createObjectURL(f);
  });

  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = canvas.getBoundingClientRect();
    const k = (VIEW * 2) / r.width;
    ox += (e.clientX - drag.x) * k;
    oy += (e.clientY - drag.y) * k;
    drag = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', () => (drag = null));
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom.value = String(Math.max(1, Math.min(3, Number(zoom.value) - e.deltaY * 0.001)));
  });

  saveBtn.addEventListener('click', async () => {
    if (!source()) {
      note.textContent = 'Take a selfie or pick a photo first.';
      return;
    }
    if (!mine.checked) {
      note.textContent = 'Tick the box to confirm this is your own face.';
      return;
    }
    const out = document.createElement('canvas');
    out.width = out.height = OUT;
    drawFrame(out.getContext('2d')!, OUT, false);
    // WebP where the browser can make it, JPEG otherwise (older Safari); a little lower quality
    // only if a busy photo comes out too big to upload.
    let data = '';
    for (const q of [0.92, 0.85, 0.75, 0.6]) {
      data = out.toDataURL('image/webp', q);
      if (!data.startsWith('data:image/webp')) data = out.toDataURL('image/jpeg', q);
      if (data.length < 200_000) break;
    }
    saveBtn.disabled = true;
    try {
      await account.uploadFace(data);
      note.textContent = 'Saved! Everyone in your matches sees your face now.';
    } catch (err) {
      note.textContent = (err as Error).message;
    } finally {
      status();
    }
  });
  removeBtn.addEventListener('click', async () => {
    try {
      await account.removeFace();
      note.textContent = 'Face scan removed. Back to the classic face!';
    } catch (err) {
      note.textContent = (err as Error).message;
    }
    status();
  });

  const root = el(
    'div',
    { class: 'overlay interactive' },
    el(
      'div',
      { class: 'panel face-scan' },
      el('h2', { text: '📸 Face scan' }),
      el('div', { class: 'small-note', text: 'Put your own face on your tube man.' }),
      canvas,
      el('div', { class: 'row face-row' }, camBtn, snapBtn, upBtn, file),
      el('label', { class: 'row face-zoom' }, el('span', { text: 'Zoom' }), zoom),
      el('label', { class: 'row face-mine' }, mine, el('span', { text: 'This is my own face' })),
      note,
      saveBtn,
      el(
        'div',
        { class: 'small-note' },
        'Other players in your matches can see it. Faces that get reported are hidden until a moderator checks them, and moderators can remove any face.',
      ),
      el('div', { class: 'row', style: 'justify-content:space-between' }, removeBtn, el('button', { class: 'btn small ghost', text: 'Done', on: { click: onClose } })),
    ),
  );
  const off = account.onChange(status);
  return {
    root,
    dispose: () => {
      cancelAnimationFrame(raf);
      stopCamera();
      off();
    },
  };
}

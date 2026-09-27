import { BALANCE } from '../shared/balance';
import type { ModeId } from '../shared/game/modes';
import { randomGuestName } from '../shared/names';
import type { JoinRequest, ServerMessage } from '../shared/protocol';
import { Audio } from './audio/audio';
import { Music } from './audio/music';
import { ClientGame } from './game/clientGame';
import { InputManager } from './input/input';
import { PAD } from './input/gamepad';
import { Connection } from './net/connection';
import { type Quality, Renderer } from './render/renderer';
import { type Settings, loadIdentity, loadSettings, saveIdentity, saveSettings } from './settings';
import { clear } from './ui/dom';
import { Hud } from './ui/hud';
import { buildClickToPlay, buildHowTo, buildMainMenu, buildPause, buildReplayBanner, buildResults, buildRoomJoin, buildScoreboard, buildSettings } from './ui/menus';
import { buildLoadout, loadLoadout, saveLoadout } from './ui/loadout';

const settings = loadSettings();
const identity = loadIdentity(() => randomGuestName());
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

function qualityFor(s: Settings): Quality {
  if (s.quality !== 'auto') return s.quality;
  // Auto starts at medium; dynamic resolution handles the rest.
  return 'medium';
}

const renderer = new Renderer(canvas, qualityFor(settings));
renderer.baseFov = settings.fov;
const audio = new Audio(settings.volumes);
const music = new Music(() => audio.ctx, () => audio.musicBus);
// Browsers only allow sound after a user gesture; unlock on the first click or key.
const unlockAudio = () => audio.unlock();
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });
const input = new InputManager(canvas, settings);
const net = new Connection();
const hud = new Hud();
const game = new ClientGame(renderer, audio, hud, input, net, settings);
game.setLoadout(loadLoadout(), false);

// Layers: HUD at the bottom, then menus/overlays on top.
const menuLayer = document.createElement('div');
const overlayLayer = document.createElement('div');
const scoreLayer = document.createElement('div');
const fpsEl = document.createElement('div');
fpsEl.className = 'ping';
fpsEl.style.top = '24px';
uiRoot.append(hud.root, scoreLayer, menuLayer, overlayLayer, fpsEl);

type Screen = 'menu' | 'room-join' | 'connecting' | 'playing';
let screen: Screen = 'menu';
let overlay: 'none' | 'pause' | 'settings' | 'howto' | 'click' | 'results' | 'loadout' | 'replay' = 'none';
let pendingJoin: JoinRequest | null = null;
let scoreboardOpen = false;
/** Playing with a controller: no pointer lock needed. */
let padPlay = false;

// --- Routing ----------------------------------------------------------------------------------

/** Room links look like /r/CODE; 1v1 challenge links look like /c/CODE. */
function roomCodeFromPath(): { code: string; challenge: boolean } | null {
  const m = location.pathname.match(/^\/([rc])\/([A-Za-z0-9]{4,6})\/?$/);
  return m ? { code: m[2].toUpperCase(), challenge: m[1] === 'c' } : null;
}

const MODE_KEY = 'bubba.mode.v1';
function loadMode(): ModeId {
  try {
    const m = window.localStorage.getItem(MODE_KEY);
    if (m === 'knockout' || m === 'teamKnockout' || m === 'ball' || m === 'pump' || m === 'duel') return m;
  } catch {
    // Storage blocked: default mode.
  }
  return 'knockout';
}
let lastMode = loadMode();
function rememberMode(m: ModeId): void {
  lastMode = m;
  try {
    window.localStorage.setItem(MODE_KEY, m);
  } catch {
    // Not remembered; fine.
  }
}

function setPath(path: string): void {
  if (location.pathname !== path) history.replaceState(null, '', path);
}

// --- Screens -----------------------------------------------------------------------------------

function showMenu(notice?: string): void {
  screen = 'menu';
  setOverlay('none');
  clear(menuLayer);
  setPath('/');
  menuLayer.append(
    buildMainMenu(identity.name, {
      onLoadout: () => setOverlay('loadout'),
      onPlay: (name, mode) => startJoin(name, { kind: 'quick', mode }),
      onChallenge: (name) => startJoin(name, { kind: 'challenge' }),
      onModeChange: rememberMode,
      onCreate: (name) => startJoin(name, { kind: 'create' }),
      onJoinCode: (name, code) => startJoin(name, { kind: 'code', code }),
      onSettings: () => setOverlay('settings'),
      onHowTo: () => setOverlay('howto'),
      onNameChange: rememberName,
    }, notice, lastMode),
  );
}

function showRoomJoin(code: string, notice?: string, challenge = false): void {
  screen = 'room-join';
  clear(menuLayer);
  menuLayer.append(
    buildRoomJoin(code, identity.name, {
      onJoin: (name) => startJoin(name, { kind: 'code', code }),
      onBack: () => showMenu(),
      onNameChange: rememberName,
    }, notice, challenge),
  );
}

function rememberName(name: string): void {
  identity.name = name;
  saveIdentity(identity);
}

function startJoin(name: string, join: JoinRequest): void {
  rememberName(name);
  audio.unlock();
  audio.uiClick();
  // Request pointer lock inside the click so the browser allows it.
  input.requestLock();
  screen = 'connecting';
  pendingJoin = join;
  clear(menuLayer);
  net.join(name, identity.guestId, join, game.loadout).catch((err: Error) => {
    input.exitLock();
    showMenu(err.message || 'Could not connect. Check your Wi-Fi and try again.');
  });
}

function setOverlay(next: typeof overlay): void {
  overlay = next;
  clear(overlayLayer);
  switch (next) {
    case 'pause':
      overlayLayer.append(
        buildPause(game.room, game.room?.hostId === game.youId, {
          onLoadout: () => setOverlay('loadout'),
          onResume: resume,
          onLeave: leaveMatch,
          onSettings: () => setOverlay('settings'),
          onHowTo: () => setOverlay('howto'),
          onCopyLink: copyInvite,
          onHost: (action) => {
            if (action === 'restart') net.send({ type: 'host', action: 'restart' });
            else net.send({ type: 'host', action: 'settings', settings: action });
          },
        }),
      );
      break;
    case 'settings':
      overlayLayer.append(
        buildSettings(settings, {
          onChange: applySettings,
          onClose: () => setOverlay(screen === 'playing' ? 'pause' : 'none'),
          onRebind: (action, done) => {
            input.captureNext = (code) => {
              // A key can only do one thing: remove it from any other action first.
              for (const [k, v] of Object.entries(input.getBindings())) {
                if (k !== action && v.includes(code)) settings.bindings[k] = v.filter((c) => c !== code);
              }
              settings.bindings[action] = [code];
              applySettings(settings);
              done();
            };
          },
          padLabels: () => {
            const out: Record<string, string> = {};
            for (const k of Object.keys(input.getPadBindings())) out[k] = input.padLabel(k as keyof ReturnType<typeof input.getPadBindings>);
            return out;
          },
          onRebindPad: (action, done) => {
            input.capturePad = (button) => {
              settings.padBindings[action] = [button];
              applySettings(settings);
              done();
            };
          },
        }),
      );
      break;
    case 'loadout':
      overlayLayer.append(
        buildLoadout(
          game.loadout,
          (l) => {
            saveLoadout(l);
            game.setLoadout(l, true);
          },
          () => setOverlay(screen === 'playing' ? 'pause' : 'none'),
          undefined,
          screen === 'playing' ? 'Changes apply the next time you respawn.' : '',
        ),
      );
      break;
    case 'howto':
      overlayLayer.append(
        buildHowTo(
          () => setOverlay(screen === 'playing' ? 'pause' : 'none'),
          input.getBindings(),
          Object.fromEntries(Object.keys(input.getPadBindings()).map((k) => [k, input.padLabel(k as keyof ReturnType<typeof input.getPadBindings>)])),
        ),
      );
      break;
    case 'click':
      overlayLayer.append(buildClickToPlay(game.alive ? 'READY?' : 'WAITING...', resume));
      break;
    case 'replay': {
      const rp = game.match.result?.replay;
      if (rp) {
        const name = (id: number) => game.roster.get(id)?.name ?? '?';
        overlayLayer.append(
          buildReplayBanner(name(rp.victim), name(rp.by), rp.distance, rp.ko, () => {
            game.stopReplay();
            setOverlay('results');
          }),
        );
      }
      break;
    }
    case 'results':
      if (game.match.result) {
        const secondsLeft = Math.max(0, (game.match.endsAtTick - game.clock.tickAt(performance.now())) / 60);
        overlayLayer.append(buildResults(game.match.result, game.roster, game.youId, secondsLeft, game.teamView()));
      }
      break;
    default:
      break;
  }
  input.enabled = screen === 'playing' && (next === 'none' || next === 'results' || next === 'replay') && (input.locked || padPlay);
}

function applySettings(s: Settings): void {
  saveSettings(s);
  input.applySettings(s);
  audio.setVolumes(s.volumes);
  game.announcer.setVolume(s.volumes.muted ? 0 : s.volumes.master * s.volumes.announcer);
  const q = qualityFor(s);
  if (q !== renderer.quality) renderer.setQuality(q);
  fpsEl.classList.toggle('hidden', !s.showFps);
  game.refreshTeamColors();
}

function resume(): void {
  audio.unlock();
  if (padPlay) setOverlay('none');
  else input.requestLock();
}

// Controller: Menu toggles pause, any button starts playing without a mouse, B closes menus.
input.onMenuButton = () => {
  if (screen !== 'playing') return;
  if (overlay === 'none') {
    padPlay = true;
    setOverlay('pause');
  } else if (overlay === 'pause' || overlay === 'click') {
    padPlay = true;
    setOverlay('none');
  }
};
input.onPadButton = (b) => {
  audio.unlock();
  if (screen === 'menu' && overlay === 'none' && b === PAD.A) {
    const play = document.querySelector<HTMLButtonElement>('.menu .btn.big');
    play?.click();
    padPlay = true;
    return;
  }
  if (screen === 'playing' && overlay === 'click' && b === PAD.A) {
    padPlay = true;
    setOverlay('none');
    return;
  }
  if (b === PAD.B && (overlay === 'settings' || overlay === 'howto' || overlay === 'loadout')) setOverlay(screen === 'playing' ? 'pause' : 'none');
};

function leaveMatch(): void {
  net.close();
  game.leave();
  input.exitLock();
  showMenu();
  net.warm().catch(() => undefined);
}

function inviteLink(): string {
  return `${location.origin}/${game.room?.challenge ? 'c' : 'r'}/${game.room?.code ?? ''}`;
}

function copyInvite(): void {
  if (!game.room) return;
  const link = inviteLink();
  const done = () => hud.toast(game.room?.challenge ? 'Challenge link copied! Send it to your rival.' : 'Invite link copied! Paste it to your friends.');
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(done, () => prompt('Copy this link:', link));
  else prompt('Copy this link:', link);
}

function renderScoreboard(): void {
  clear(scoreLayer);
  if (!scoreboardOpen || screen !== 'playing') return;
  const isHost = !!game.room?.isPrivate && game.room.hostId === game.youId;
  scoreLayer.append(
    buildScoreboard(
      [...game.roster.values()],
      game.youId,
      game.room?.hostId ?? -1,
      !!game.room?.isPrivate,
      isHost && !input.locked ? (id) => net.send({ type: 'host', action: 'kick', id }) : null,
      game.teamView(),
    ),
  );
}

// --- Wiring ----------------------------------------------------------------------------------

input.onLockChange = (locked) => {
  if (screen !== 'playing') return;
  if (locked) padPlay = false;
  if (padPlay) return;
  if (locked) {
    if (overlay !== 'results') setOverlay('none');
    input.enabled = true;
  } else if (overlay === 'none' || overlay === 'click') {
    setOverlay('pause');
  } else {
    input.enabled = false;
  }
};

input.onScoreboard = (show) => {
  scoreboardOpen = show;
  renderScoreboard();
};

net.handlers = {
  onSnapshot: (snap) => game.onSnapshot(snap),
  onMessage: (msg: ServerMessage) => {
    if (msg.type === 'welcome') {
      screen = 'playing';
      clear(menuLayer);
      game.enter(msg);
      if (msg.room.isPrivate) setPath(`/${msg.room.challenge ? 'c' : 'r'}/${msg.room.code}`);
      else setPath('/');
      if (msg.name !== identity.name) rememberName(msg.name);
      setOverlay(input.locked ? 'none' : 'click');
      if (msg.room.isPrivate && pendingJoin?.kind === 'create') {
        hud.callout('ROOM ' + msg.room.code, 'Press Esc to copy the invite link', 4);
      } else if (pendingJoin?.kind === 'challenge') {
        // The click that created the challenge usually still counts as a user gesture for the clipboard.
        const link = inviteLink();
        const shown = () => hud.callout('1v1 CHALLENGE', 'Link copied! Send it to a friend. Warm up on the bot until they join.', 5);
        const manual = () => hud.callout('1v1 CHALLENGE', `Press Esc to copy your challenge link (${msg.room.code})`, 5);
        if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(shown, manual);
        else manual();
      } else if (msg.room.challenge) {
        hud.callout('1v1!', `First to ${BALANCE.modes.duel.target} knockouts. Good luck!`, 3);
      }
      return;
    }
    if (msg.type === 'error') {
      if (msg.code === 'kicked' || screen !== 'playing') {
        const link = roomCodeFromPath();
        game.leave();
        input.exitLock();
        if (msg.code === 'not_found' && link) showRoomJoin(link.code, msg.message, link.challenge);
        else showMenu(msg.message);
        return;
      }
    }
    game.onMessage(msg);
    if (msg.type === 'roster' && scoreboardOpen) renderScoreboard();
  },
  onClose: (reason) => {
    if (screen === 'playing' || screen === 'connecting') {
      game.leave();
      input.exitLock();
      showMenu(`Disconnected: ${reason}`);
    }
  },
};

game.onMatchChange = (m) => {
  if (m.phase === 'results') {
    if (m.result?.replay && overlay !== 'replay') {
      game.startReplay(m.result.replay, () => {
        game.stopReplay();
        if (overlay === 'replay') setOverlay('results');
      });
      setOverlay('replay');
    } else if (overlay !== 'replay') {
      setOverlay('results');
    }
    input.enabled = false;
  } else if (overlay === 'results' || overlay === 'replay') {
    game.stopReplay();
    setOverlay(input.locked ? 'none' : 'click');
    if (m.phase === 'playing') hud.callout('GO!', 'Blast them off the map!', 1.6);
  }
};

game.onKicked = (message) => {
  game.leave();
  input.exitLock();
  showMenu(message);
};

// Warn before closing the tab mid-match (Command+W sits right next to the space bar).
window.addEventListener('beforeunload', (e) => {
  if (screen === 'playing') {
    e.preventDefault();
    e.returnValue = '';
  }
});

// --- Main loop -------------------------------------------------------------------------------

/** CPU time spent per frame (exposed for performance testing). */
const perf = { update: 0, render: 0, frames: 0 };
let last = performance.now();
let fpsFrames = 0;
let fpsTime = 0;
function loop(now: number): void {
  const dtMs = Math.min(100, now - last);
  last = now;
  const dt = dtMs / 1000;
  input.pollGamepad(dt);
  const t0 = performance.now();
  game.frame(dt);
  const t1 = performance.now();
  renderer.render();
  const t2 = performance.now();
  perf.update += t1 - t0;
  perf.render += t2 - t1;
  perf.frames++;
  if (audio.ctx) music.setMood(screen === 'playing' ? (game.match.phase === 'results' ? 'menu' : game.inFinal ? 'final' : 'match') : 'menu');
  renderer.trackFrame(dtMs, now);
  fpsFrames++;
  fpsTime += dtMs;
  if (fpsTime > 500) {
    fpsEl.textContent = `${Math.round((fpsFrames * 1000) / fpsTime)} fps · ${Math.round(renderer.renderScale * 100)}% res`;
    fpsFrames = 0;
    fpsTime = 0;
  }
  if (overlay === 'results' && fpsFrames === 0) setOverlay('results');
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// --- Boot --------------------------------------------------------------------------------------

applySettings(settings);
net.warm().catch(() => undefined);
const link = roomCodeFromPath();
if (link) showRoomJoin(link.code, undefined, link.challenge);
else showMenu();

// Fade out the HTML splash now that the game is ready.
const splash = document.getElementById('splash');
if (splash) {
  splash.style.opacity = '0';
  window.setTimeout(() => splash.remove(), 350);
}

// Expose for debugging and automated tests.
(window as unknown as { bubba: unknown }).bubba = { game, net, input, renderer, settings, perf };

import { randomGuestName } from '../shared/names';
import type { JoinRequest, ServerMessage } from '../shared/protocol';
import { Audio } from './audio/audio';
import { ClientGame } from './game/clientGame';
import { InputManager } from './input/input';
import { Connection } from './net/connection';
import { type Quality, Renderer } from './render/renderer';
import { type Settings, loadIdentity, loadSettings, saveIdentity, saveSettings } from './settings';
import { clear } from './ui/dom';
import { Hud } from './ui/hud';
import { buildClickToPlay, buildHowTo, buildMainMenu, buildPause, buildResults, buildRoomJoin, buildScoreboard, buildSettings } from './ui/menus';
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
let overlay: 'none' | 'pause' | 'settings' | 'howto' | 'click' | 'results' | 'loadout' = 'none';
let pendingJoin: JoinRequest | null = null;
let scoreboardOpen = false;

// --- Routing ----------------------------------------------------------------------------------

function roomCodeFromPath(): string | null {
  const m = location.pathname.match(/^\/r\/([A-Za-z0-9]{4,6})\/?$/);
  return m ? m[1].toUpperCase() : null;
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
      onPlay: (name) => startJoin(name, { kind: 'quick' }),
      onCreate: (name) => startJoin(name, { kind: 'create' }),
      onJoinCode: (name, code) => startJoin(name, { kind: 'code', code }),
      onSettings: () => setOverlay('settings'),
      onHowTo: () => setOverlay('howto'),
      onNameChange: rememberName,
    }, notice),
  );
}

function showRoomJoin(code: string, notice?: string): void {
  screen = 'room-join';
  clear(menuLayer);
  menuLayer.append(
    buildRoomJoin(code, identity.name, {
      onJoin: (name) => startJoin(name, { kind: 'code', code }),
      onBack: () => showMenu(),
      onNameChange: rememberName,
    }, notice),
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
              const list = [code];
              settings.bindings[action] = list;
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
      overlayLayer.append(buildHowTo(() => setOverlay(screen === 'playing' ? 'pause' : 'none'), input.getBindings()));
      break;
    case 'click':
      overlayLayer.append(buildClickToPlay(game.alive ? 'READY?' : 'WAITING...', resume));
      break;
    case 'results':
      if (game.match.result) {
        const secondsLeft = Math.max(0, (game.match.endsAtTick - game.clock.tickAt(performance.now())) / 60);
        overlayLayer.append(buildResults(game.match.result, game.roster, game.youId, secondsLeft));
      }
      break;
    default:
      break;
  }
  input.enabled = screen === 'playing' && (next === 'none' || next === 'results') && input.locked;
}

function applySettings(s: Settings): void {
  saveSettings(s);
  input.applySettings(s);
  audio.setVolumes(s.volumes);
  const q = qualityFor(s);
  if (q !== renderer.quality) renderer.setQuality(q);
  fpsEl.classList.toggle('hidden', !s.showFps);
}

function resume(): void {
  audio.unlock();
  input.requestLock();
}

function leaveMatch(): void {
  net.close();
  game.leave();
  input.exitLock();
  showMenu();
  net.warm().catch(() => undefined);
}

function copyInvite(): void {
  if (!game.room) return;
  const link = `${location.origin}/r/${game.room.code}`;
  const done = () => hud.toast('Invite link copied! Paste it to your friends.');
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(done, () => prompt('Copy this link:', link));
  else prompt('Copy this link:', link);
}

function renderScoreboard(): void {
  clear(scoreLayer);
  if (!scoreboardOpen || screen !== 'playing') return;
  const isHost = !!game.room?.isPrivate && game.room.hostId === game.youId;
  scoreLayer.append(
    buildScoreboard([...game.roster.values()], game.youId, game.room?.hostId ?? -1, !!game.room?.isPrivate, isHost && !input.locked ? (id) => net.send({ type: 'host', action: 'kick', id }) : null),
  );
}

// --- Wiring ----------------------------------------------------------------------------------

input.onLockChange = (locked) => {
  if (screen !== 'playing') return;
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
      if (msg.room.isPrivate) setPath(`/r/${msg.room.code}`);
      else setPath('/');
      if (msg.name !== identity.name) rememberName(msg.name);
      setOverlay(input.locked ? 'none' : 'click');
      if (msg.room.isPrivate && pendingJoin?.kind === 'create') {
        hud.callout('ROOM ' + msg.room.code, 'Press Esc to copy the invite link', 4);
      }
      return;
    }
    if (msg.type === 'error') {
      if (msg.code === 'kicked' || screen !== 'playing') {
        const code = roomCodeFromPath();
        game.leave();
        input.exitLock();
        if (msg.code === 'not_found' && code) showRoomJoin(code, msg.message);
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
    setOverlay('results');
    input.enabled = false;
  } else if (overlay === 'results') {
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

let last = performance.now();
let fpsFrames = 0;
let fpsTime = 0;
function loop(now: number): void {
  const dtMs = Math.min(100, now - last);
  last = now;
  const dt = dtMs / 1000;
  game.frame(dt);
  renderer.render();
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
const code = roomCodeFromPath();
if (code) showRoomJoin(code);
else showMenu();

// Expose for debugging and automated tests.
(window as unknown as { bubba: unknown }).bubba = { game, net, input, renderer, settings };

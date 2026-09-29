import { BALANCE } from '../shared/balance';
import { QUICK_CHAT, unlockedAt } from '../shared/economy';
import { sanitizeLoadout } from '../shared/loadout';
import { randomGuestName } from '../shared/names';
import type { ModeId } from '../shared/game/modes';
import type { JoinRequest, ServerMessage } from '../shared/protocol';
import { Audio } from './audio/audio';
import { Music } from './audio/music';
import { ClientGame } from './game/clientGame';
import { InputManager } from './input/input';
import { PAD } from './input/gamepad';
import { TouchControls, isTouchDevice } from './input/touch';
import { Connection } from './net/connection';
import { installErrorReports } from './net/errorReport';
import { AccountClient } from './net/account';
import { type Quality, Renderer } from './render/renderer';
import { isWeakGpu } from './render/gpu';
import { type Settings, loadIdentity, loadSettings, saveIdentity, saveSettings } from './settings';
import { clear } from './ui/dom';
import { buildReconnecting } from './ui/reconnect';
import { type AccountTab, buildAccountChip, buildAccountPanel, buildDailyCard, buildProfile, buildQueue } from './ui/accountUi';
import { buildFaceScan } from './ui/faceScan';
import { buildLocker } from './ui/locker';
import { Hud } from './ui/hud';
import { type PlayMode, buildClickToPlay, buildHowTo, buildMainMenu, buildPause, buildReplayBanner, buildResults, buildRoomJoin, buildScoreboard, buildSettings } from './ui/menus';
import { buildLoadout, loadLoadout, saveLoadout } from './ui/loadout';

const settings = loadSettings();
installErrorReports();
const identity = loadIdentity(() => randomGuestName());
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

/** Phones and tablets: on-screen controls instead of mouse and keyboard. */
const touchMode = isTouchDevice();
if (touchMode) document.body.classList.add('touch');

/** Checked once: weak and software GPUs (many school Chromebooks) start on Low. */
const weakGpu = isWeakGpu();

function qualityFor(s: Settings): Quality {
  if (s.quality !== 'auto') return s.quality;
  // Phones run hot and on battery, and weak GPUs can't hold Medium: start them light. Elsewhere
  // Medium; dynamic resolution and the automatic drop handle the rest.
  return touchMode || weakGpu ? 'low' : 'medium';
}

const renderer = new Renderer(canvas, qualityFor(settings));
/** Auto quality already stepped down this session (don't undo it on a settings change). */
let autoDropped = false;
renderer.onAutoDrop = (q) => {
  autoDropped = true;
  hud.toast(`Switched to ${q === 'low' ? 'Low' : 'Medium'} graphics to keep things smooth.`, 3500);
};
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
const touch = touchMode ? new TouchControls(input) : null;
game.touch = touch;
if (touchMode) input.lastDevice = 'touch';
game.setLoadout(loadLoadout(), false);
const account = new AccountClient(identity.guestId);
hud.setChatLabels(QUICK_CHAT);
/** Players you reported this session (one report each). */
const reported = new Set<number>();

// Layers: HUD at the bottom, then menus/overlays on top.
const menuLayer = document.createElement('div');
const overlayLayer = document.createElement('div');
const scoreLayer = document.createElement('div');
const fpsEl = document.createElement('div');
fpsEl.className = 'ping';
fpsEl.style.top = '24px';
uiRoot.append(hud.root, ...(touch ? [touch.root] : []), scoreLayer, menuLayer, overlayLayer, fpsEl);

type Screen = 'menu' | 'room-join' | 'connecting' | 'queue' | 'playing' | 'reconnecting';
let screen: Screen = 'menu';
let overlay: 'none' | 'pause' | 'settings' | 'howto' | 'click' | 'results' | 'loadout' | 'replay' | 'locker' | 'profile' | 'account' | 'face' = 'none';
let accountTab: AccountTab = 'signup';
let lockerDispose: (() => void) | null = null;
let pendingJoin: JoinRequest | null = null;
/** The room you were last playing in, so a dropped connection can put you back. */
let lastRoom: { code: string; isPrivate: boolean; mode: ModeId; ranked: boolean } | null = null;
let reconnectTimer: number | null = null;
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
function loadMode(): PlayMode {
  try {
    const m = window.localStorage.getItem(MODE_KEY);
    if (m === 'knockout' || m === 'teamKnockout' || m === 'ball' || m === 'pump' || m === 'duel' || m === 'ranked') return m;
  } catch {
    // Storage blocked: default mode.
  }
  return 'knockout';
}
let lastMode = loadMode();
function rememberMode(m: PlayMode): void {
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
  stopReconnecting();
  screen = 'menu';
  setOverlay('none');
  setPath('/');
  renderMenu(notice);
}

/** Draws the main menu without touching whatever overlay is open. */
function renderMenu(notice?: string): void {
  clear(menuLayer);
  menuLayer.append(
    buildMainMenu(identity.name, {
      onLoadout: () => setOverlay('loadout'),
      onLocker: () => setOverlay('locker'),
      onProfile: () => setOverlay('profile'),
      onPlay: (name, mode) => {
        if (mode !== 'ranked') return startJoin(name, { kind: 'quick', mode });
        if (!account.account) return openAccount('signup');
        startJoin(name, { kind: 'ranked' });
      },
      onChallenge: (name) => startJoin(name, { kind: 'challenge' }),
      onModeChange: rememberMode,
      onCreate: (name) => startJoin(name, { kind: 'create' }),
      onJoinCode: (name, code) => startJoin(name, { kind: 'code', code }),
      onSettings: () => setOverlay('settings'),
      onHowTo: () => setOverlay('howto'),
      onNameChange: rememberName,
    }, notice, lastMode, account.account?.name ?? null, buildDailyCard(account)),
    buildAccountChip(account, () => openAccount('signup'), () => setOverlay('profile')),
  );
}

function openAccount(tab: AccountTab): void {
  accountTab = tab;
  setOverlay('account');
}

/** Called when the account or profile changes (log in/out, purchases, match rewards). */
let lastAccountName: string | null = null;
account.onChange(() => {
  // Drop anything the saved loadout has that isn't unlocked yet.
  const allowed = unlockedAt(account.profile.level);
  const clean = sanitizeLoadout(game.loadout, allowed);
  if (JSON.stringify(clean) !== JSON.stringify(game.loadout)) game.setLoadout(clean, false);
  const name = account.account?.name ?? null;
  if (name !== lastAccountName) {
    lastAccountName = name;
    if (name) rememberName(name);
    if (screen === 'menu') renderMenu();
  }
});

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
  // Request pointer lock inside the click so the browser allows it. Phones go fullscreen and
  // sideways instead (where the browser allows it).
  if (touchMode) goFullscreen();
  else input.requestLock();
  screen = 'connecting';
  pendingJoin = join;
  clear(menuLayer);
  if (join.kind === 'ranked') {
    input.exitLock();
    screen = 'queue';
    menuLayer.append(buildQueue(0, 1, account.profile.rating ?? 1000, cancelQueue));
  }
  net.join(name, identity.guestId, join, game.loadout, account.token ?? undefined).catch((err: Error) => {
    input.exitLock();
    showMenu(err.message || 'Could not connect. Check your Wi-Fi and try again.');
  });
}

/** Waits between reconnect tries (seconds): about a minute in all, enough for a server restart. */
const RECONNECT_DELAYS = [0.5, 1.5, 3, 4, 5, 6, 8, 10, 10, 12];

/**
 * The connection dropped mid-match (Wi-Fi hiccup or a server update): keep trying to get back
 * into the same room (or the same mode, for public rooms) before giving up.
 */
function reconnect(updating: boolean): void {
  stopReconnecting();
  reconnectUpdating = updating;
  scheduleReconnect();
}

/** Queues the next try (a failed try can report twice: its promise and its socket closing). */
function scheduleReconnect(): void {
  if (reconnectTimer !== null) return;
  const room = lastRoom;
  if (!room || reconnectAttempt >= RECONNECT_DELAYS.length) {
    showMenu('Lost connection to the server. Check your Wi-Fi and try again.');
    return;
  }
  screen = 'reconnecting';
  setOverlay('none');
  clear(menuLayer);
  menuLayer.append(buildReconnecting(reconnectUpdating, reconnectAttempt, () => showMenu()));
  const delay = RECONNECT_DELAYS[reconnectAttempt++];
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    if (screen !== 'reconnecting') return;
    const join: JoinRequest = room.isPrivate ? { kind: 'code', code: room.code } : { kind: 'quick', mode: room.mode };
    pendingJoin = join;
    const tried = reconnectAttempt;
    net.join(identity.name, identity.guestId, join, game.loadout, account.token ?? undefined).catch(() => {
      if (screen === 'reconnecting') scheduleReconnect();
    });
    // A try that neither gets in nor fails (a stuck socket) is retried too.
    window.setTimeout(() => {
      if (screen === 'reconnecting' && reconnectAttempt === tried && reconnectTimer === null) {
        net.close();
        scheduleReconnect();
      }
    }, 12_000);
  }, delay * 1000);
}

function stopReconnecting(): void {
  if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
  reconnectAttempt = 0;
}
let reconnectAttempt = 0;
let reconnectUpdating = false;

function goFullscreen(): void {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    const p = el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.();
    const orientation = window.screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    const lock = () => orientation?.lock?.('landscape').catch(() => undefined);
    if (p && typeof (p as Promise<void>).then === 'function') (p as Promise<void>).then(lock, () => undefined);
  } catch {
    // Fullscreen isn't available everywhere (iPhone Safari); the game still works.
  }
}

function cancelQueue(): void {
  net.close();
  showMenu();
  net.warm().catch(() => undefined);
}

function setOverlay(next: typeof overlay): void {
  // The results screen is redrawn twice a second (for its countdown); keep its scroll position so
  // the rewards and daily challenges at the bottom stay readable on short screens.
  const resultsScroll = next === 'results' && overlay === 'results' ? (overlayLayer.querySelector('.results .panel')?.scrollTop ?? 0) : 0;
  overlay = next;
  clear(overlayLayer);
  lockerDispose?.();
  lockerDispose = null;
  const back = () => setOverlay(screen === 'playing' ? 'pause' : 'none');
  switch (next) {
    case 'locker': {
      const locker = buildLocker({ account, audio, weapon: game.loadout.weapon, onClose: back, onSignup: () => openAccount('signup') });
      lockerDispose = locker.dispose;
      overlayLayer.append(locker.root);
      break;
    }
    case 'profile':
      overlayLayer.append(
        buildProfile(
          account,
          back,
          () => openAccount('signup'),
          () => {
            void account.logout().then(() => (screen === 'menu' ? showMenu() : back()));
          },
          () => setOverlay('face'),
        ),
      );
      break;
    case 'face': {
      const scan = buildFaceScan(account, () => setOverlay('profile'));
      lockerDispose = scan.dispose;
      overlayLayer.append(scan.root);
      break;
    }
    case 'account':
      overlayLayer.append(buildAccountPanel(account, accountTab, back, back));
      break;
    case 'pause':
      overlayLayer.append(
        buildPause(game.room, game.room?.hostId === game.youId, {
          onLoadout: () => setOverlay('loadout'),
          onLocker: () => setOverlay('locker'),
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
          account.locked,
          screen === 'playing' ? 'Changes apply the next time you respawn.' : '',
        ),
      );
      break;
    case 'howto':
      overlayLayer.append(
        buildHowTo(
          () => setOverlay(screen === 'playing' ? 'pause' : 'none'),
          input.getBindings(),
          touchMode ? undefined : Object.fromEntries(Object.keys(input.getPadBindings()).map((k) => [k, input.padLabel(k as keyof ReturnType<typeof input.getPadBindings>)])),
          touchMode,
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
        overlayLayer.append(
          buildResults(game.match.result, game.roster, game.youId, secondsLeft, game.teamView(), {
            report: game.lastProgress,
            guest: !account.account,
            onSignup: () => openAccount('signup'),
            ranked: !!game.room?.ranked,
          }),
        );
        const panel = overlayLayer.querySelector('.results .panel');
        if (panel) panel.scrollTop = resultsScroll;
      }
      break;
    default:
      break;
  }
  input.enabled = screen === 'playing' && (next === 'none' || next === 'results' || next === 'replay') && (input.locked || padPlay || touchMode);
}

function applySettings(s: Settings): void {
  saveSettings(s);
  input.applySettings(s);
  if (touch) touch.sensitivity = s.sensTouch;
  audio.setVolumes(s.volumes);
  game.announcer.setVolume(s.volumes.muted ? 0 : s.volumes.master * s.volumes.announcer);
  const q = qualityFor(s);
  renderer.autoQuality = s.quality === 'auto';
  if (s.quality !== 'auto' || !autoDropped) {
    if (q !== renderer.quality) renderer.setQuality(q);
  }
  fpsEl.classList.toggle('hidden', !s.showFps);
  game.refreshTeamColors();
  game.showChat = s.showQuickChat;
  game.showFaces = s.showFaces;
}

function resume(): void {
  audio.unlock();
  if (padPlay || touchMode) setOverlay('none');
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
      input.locked
        ? null
        : {
            onKick: isHost ? (id) => net.send({ type: 'host', action: 'kick', id }) : null,
            onReport: (id, reason) => {
              reported.add(id);
              net.send({ type: 'report', target: id, reason });
              hud.toast('Thanks. We got your report.');
            },
            onMute: (id) => {
              if (game.muted.has(id)) game.muted.delete(id);
              else game.muted.add(id);
              renderScoreboard();
            },
            muted: game.muted,
            reported,
          },
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

input.onChatWheel = (open, slot) => hud.showChatWheel(open, slot);
input.onCameraToggle = () => {
  if (screen === 'playing') game.toggleCamera();
};
input.onChat = (slot) => game.sendChat(slot);

input.onScoreboard = (show) => {
  scoreboardOpen = show;
  renderScoreboard();
};

if (touch) {
  touch.onPause = () => {
    if (screen === 'playing' && overlay === 'none') setOverlay('pause');
  };
  touch.onScoreboard = (show) => {
    scoreboardOpen = show;
    renderScoreboard();
  };
  touch.onChat = (slot) => game.sendChat(slot);
  touch.setChatLabels(QUICK_CHAT);
}

net.handlers = {
  onSnapshot: (snap) => game.onSnapshot(snap),
  onMessage: (msg: ServerMessage) => {
    if (msg.type === 'queue') {
      if (screen === 'queue') {
        clear(menuLayer);
        menuLayer.append(buildQueue(msg.seconds, msg.searching, msg.rating, cancelQueue));
      }
      return;
    }
    if (msg.type === 'progress') {
      account.setProfile(msg.report.profile);
      game.onMessage(msg);
      if (overlay === 'results') setOverlay('results');
      return;
    }
    if (msg.type === 'renamed') {
      hud.toast(msg.message, 6000);
      if (!account.account) rememberName(msg.name);
      return;
    }
    if (msg.type === 'error' && msg.code === 'ranked_over') {
      net.close();
      game.leave();
      input.exitLock();
      showMenu(msg.message);
      net.warm().catch(() => undefined);
      return;
    }
    if (msg.type === 'welcome') {
      if (msg.room.ranked) padPlay = padPlay || input.lastDevice === 'pad';
      stopReconnecting();
      lastRoom = { code: msg.room.code, isPrivate: msg.room.isPrivate, mode: msg.room.settings.mode, ranked: msg.room.ranked };
      screen = 'playing';
      reported.clear();
      clear(menuLayer);
      game.enter(msg);
      if (msg.room.isPrivate) setPath(`/${msg.room.challenge ? 'c' : 'r'}/${msg.room.code}`);
      else setPath('/');
      if (msg.name !== identity.name) rememberName(msg.name);
      setOverlay(input.locked || touchMode ? 'none' : 'click');
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
      } else if (msg.room.ranked) {
        hud.callout('RANKED 1v1', `First to ${BALANCE.modes.duel.target} knockouts. Click to play!`, 4);
        audio.goalHorn();
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
        if (msg.code === 'account_required') openAccount('login');
        return;
      }
    }
    game.onMessage(msg);
    if (msg.type === 'roster' && scoreboardOpen) renderScoreboard();
  },
  onClose: (reason, code) => {
    // Dropped mid-match: get back in automatically (ranked matches can't be rejoined).
    if (screen === 'reconnecting') {
      scheduleReconnect();
      return;
    }
    if (screen === 'playing' && lastRoom && !lastRoom.ranked && code !== 4001) {
      game.leave();
      input.exitLock();
      reconnect(code === 1012);
      return;
    }
    if (screen === 'playing' || screen === 'connecting' || screen === 'queue') {
      game.leave();
      input.exitLock();
      showMenu(`Disconnected: ${reason}`);
    }
  },
};

game.onMatchChange = (m) => {
  if (m.phase === 'playing') game.lastProgress = null;
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
    // Give the mouse back so Skip and the results buttons can be clicked. The next match's
    // "click to play" takes it again.
    input.exitLock();
  } else if (overlay === 'results' || overlay === 'replay') {
    game.stopReplay();
    setOverlay(input.locked || touchMode ? 'none' : 'click');
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

/** ?lookdev: a fixed lineup of tube men for judging the look (developer tool). */
let lookdev: ((dt: number) => void) | null = null;
if (new URLSearchParams(location.search).has('lookdev')) {
  void import('./lookdev').then((m) => {
    lookdev = m.startLookdev(renderer);
    uiRoot.style.display = 'none';
  });
}

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
  touch?.show(screen === 'playing' && overlay === 'none');
  const t0 = performance.now();
  if (lookdev) {
    game.mapView.update(dt, now / 1000);
    lookdev(dt);
  } else game.frame(dt);
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
account.refresh().catch(() => undefined);
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
(window as unknown as { bubba: unknown }).bubba = { game, net, input, renderer, settings, perf, account, touch };

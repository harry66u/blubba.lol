import { BALANCE } from '../shared/balance';
import { QUICK_CHAT, unlockLevelOf, unlockedAt } from '../shared/economy';
import { sanitizeLoadout } from '../shared/loadout';
import { KNOCKOUT_MAPS, MAPS, homeMapFor } from '../shared/maps';
import { randomGuestName } from '../shared/names';
import { MODE_INFO, type ModeId } from '../shared/game/modes';
import type { JoinRequest, QueueCounts, ServerMessage } from '../shared/protocol';
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
import { type AccountTab, buildAccountChip, buildAccountPanel, buildDailyCard, buildProfile, buildQueue, updateQueue } from './ui/accountUi';
import { buildFaceScan } from './ui/faceScan';
import { buildFriends, buildInvites } from './ui/friends';
import { type TeamLobbyData, buildTeamLobby } from './ui/teamLobby';
import { buildLocker } from './ui/locker';
import { Hud } from './ui/hud';
import {
  type MenuNotice,
  type PlayMode,
  buildClickToPlay,
  buildConnecting,
  buildHowTo,
  buildMainMenu,
  setActiveCount,
  setModeCounts,
  setFriendBadge,
  buildPause,
  buildReplayBanner,
  buildResults,
  type ResultsActions,
  buildRoomJoin,
  buildScoreboard,
  buildSettings,
  resultsCountdownText,
} from './ui/menus';
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
// iPad with a trackpad or mouse: it aims and shoots like on a computer.
if (touchMode) input.enableTrackpad();
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
type Overlay = 'none' | 'pause' | 'settings' | 'howto' | 'click' | 'results' | 'loadout' | 'replay' | 'locker' | 'profile' | 'account' | 'face' | 'friends' | 'teams';
let overlay = 'none' as Overlay;
/** The Team Knockout lobby screen while it's showing (updated in place). */
let teamsView: { root: HTMLElement; update: () => void } | null = null;

/** Where menus go back to in a match: the team lobby between Team Knockout matches, else the pause menu. */
function matchHome(): 'teams' | 'pause' {
  return game.inTeamLobby ? 'teams' : 'pause';
}
let accountTab: AccountTab = 'signup';
let lockerDispose: (() => void) | null = null;
let pendingJoin: JoinRequest | null = null;
/** The room you were last playing in, so a dropped connection can put you back. */
let lastRoom: { code: string; isPrivate: boolean; mode: ModeId; ranked: boolean } | null = null;
let reconnectTimer: number | null = null;
/** Set while being moved into a busier room (the welcome that follows says so). */
let movedReason: string | null = null;
/** Sudden Death's "one life" banner waits for the first round you're in. */
let sdIntro = false;
/** Waiting alone in a public room: since when, and whether the hint showed. */
let aloneSince = 0;
let aloneHinted = false;

/** After a while alone in a public room, say what you can do about it (once per room). */
window.setInterval(() => {
  const room = game.room;
  const alone = screen === 'playing' && !!room && !room.isPrivate && !room.ranked && game.match.phase === 'waiting' && [...game.roster.values()].filter((r) => !r.bot).length <= 1;
  if (!alone) {
    aloneSince = 0;
    return;
  }
  if (!aloneSince) aloneSince = Date.now();
  if (aloneHinted || Date.now() - aloneSince < 20_000) return;
  aloneHinted = true;
  const key = touchMode ? 'Tap ❚❚' : padPlay ? 'Press Menu' : 'Press Esc';
  hud.callout('NOBODY ELSE YET', `${key}: copy an invite link for friends, or vote for bots to play now`, 6, '#ffd60a');
}, 1000);
let scoreboardOpen = false;
/** Playing with a controller: no pointer lock needed. */
let padPlay = false;

// --- Routing ----------------------------------------------------------------------------------

/** Room links look like /r/CODE; 1v1 challenge links look like /c/CODE. */
function roomCodeFromPath(): { code: string; challenge: boolean } | null {
  const m = location.pathname.match(/^\/([rc])\/([A-Za-z0-9]{4,6})\/?$/);
  return m ? { code: m[2].toUpperCase(), challenge: m[1] === 'c' } : null;
}

// v2: everyone starts on "Any mode" (the everyone-together Sudden Death queue) once, whatever
// they picked before.
const MODE_KEY = 'bubba.mode.v2';
function loadMode(): PlayMode {
  try {
    const m = window.localStorage.getItem(MODE_KEY);
    if (m === 'any' || m === 'knockout' || m === 'suddenDeath' || m === 'teamKnockout' || m === 'ball' || m === 'pump' || m === 'duel' || m === 'ranked') return m;
  } catch {
    // Storage blocked: default mode.
  }
  return 'any';
}
let lastMode = loadMode();
/** The menu's background shows the map you'd play: the mode's own arena, or the one you picked. */
function showPickedMap(): void {
  game.showMenuMap(homeMapFor(lastMode) ?? lastMap);
}

function rememberMode(m: PlayMode): void {
  lastMode = m;
  showPickedMap();
  try {
    window.localStorage.setItem(MODE_KEY, m);
  } catch {
    // Not remembered; fine.
  }
}

/** The map picked for quick play (null: any map). */
const MAP_KEY = 'bubba.map.v1';
function loadMap(): string | null {
  try {
    const m = window.localStorage.getItem(MAP_KEY);
    if (m && KNOCKOUT_MAPS.includes(m)) return m;
  } catch {
    // Storage blocked: any map.
  }
  return null;
}
let lastMap = loadMap();
function rememberMap(m: string | null): void {
  lastMap = m;
  showPickedMap();
  try {
    if (m) window.localStorage.setItem(MAP_KEY, m);
    else window.localStorage.removeItem(MAP_KEY);
  } catch {
    // Not remembered; fine.
  }
}

/**
 * Quick play: the picked mode and map, with bots only if you switched them on. "Any mode" (the
 * default) is Sudden Death with everyone else who just pressed PLAY, on whatever map they're on.
 */
function quickJoin(mode: Exclude<PlayMode, 'ranked'>): Extract<JoinRequest, { kind: 'quick' }> {
  if (mode === 'any') return { kind: 'quick', mode: 'suddenDeath', any: true, open: true };
  return { kind: 'quick', mode, ...(lastMap ? { map: lastMap } : {}), open: !botsFor(mode) };
}

const BOTS_KEY = 'bubba.bots.v1';
/** The menu's Bots switch (off by default: only real players). */
let botsOn = (() => {
  try {
    return window.localStorage.getItem(BOTS_KEY) === '1';
  } catch {
    return false;
  }
})();

/** Team Knockout has its own Bots switch, off until you turn it on (only real teams by default). */
const BOTS_TEAM_KEY = 'bubba.bots.team.v1';
let botsTeam = (() => {
  try {
    return window.localStorage.getItem(BOTS_TEAM_KEY) === '1';
  } catch {
    return false;
  }
})();

function botsFor(mode: PlayMode): boolean {
  return mode === 'teamKnockout' ? botsTeam : botsOn;
}

function rememberBots(on: boolean, mode: PlayMode): void {
  if (mode === 'teamKnockout') botsTeam = on;
  else botsOn = on;
  try {
    window.localStorage.setItem(mode === 'teamKnockout' ? BOTS_TEAM_KEY : BOTS_KEY, on ? '1' : '0');
  } catch {
    // Not remembered; fine.
  }
}

function setPath(path: string): void {
  if (location.pathname !== path) history.replaceState(null, '', path);
}

// --- Screens -----------------------------------------------------------------------------------

/**
 * Friends: requests and invites show up on the menu within ten seconds (accounts only), and an
 * invite that arrives mid-match pops up as a toast.
 */
let friendsPolledAt = 0;
window.setInterval(() => {
  if (!account.account || overlay === 'friends' || document.hidden) return;
  const every = screen === 'menu' ? 10_000 : screen === 'playing' ? 20_000 : 0;
  if (!every || Date.now() - friendsPolledAt < every) return;
  friendsPolledAt = Date.now();
  void account.loadFriends().catch(() => undefined);
}, 2000);

/** Invites already seen (by friend and time), and ones dismissed on the menu. */
const invitesSeen = new Set<string>();
const invitesDismissed = new Set<string>();
const inviteKey = (f: { id: number; invite?: { at: number } }) => `${f.id}:${f.invite?.at ?? 0}`;

/** Redraws the menu's invite cards, and toasts new invites during a match. */
function showInvites(): void {
  const fresh = account.invites.filter((f) => !invitesDismissed.has(inviteKey(f)));
  if (screen === 'playing') {
    for (const f of fresh) {
      if (invitesSeen.has(inviteKey(f))) continue;
      invitesSeen.add(inviteKey(f));
      if (f.playing?.code !== game.room?.code) hud.toast(`🎮 ${f.name} invited you to ${MODE_INFO[f.invite!.mode as ModeId]?.name ?? 'a match'}! Esc → 👥 Invite to join them.`, 6000);
    }
    return;
  }
  for (const f of fresh) invitesSeen.add(inviteKey(f));
  menuLayer.querySelector('.invites')?.remove();
  if (screen !== 'menu' || !fresh.length) return;
  menuLayer.append(
    buildInvites(
      fresh,
      (id) => startJoin(identity.name, { kind: 'friend', id }),
      (f) => {
        invitesDismissed.add(inviteKey(f));
        showInvites();
      },
    ),
  );
}

/** Live player counts for the menu's mode buttons, every few seconds while it shows. */
let countsAt = 0;
function pollCounts(force = false): void {
  if (screen !== 'menu' || document.hidden || (!force && Date.now() - countsAt < 8000)) return;
  countsAt = Date.now();
  fetch('/api/counts', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((c: QueueCounts | null) => {
      if (c && screen === 'menu') setModeCounts(c);
    })
    .catch(() => undefined);
}
window.setInterval(pollCounts, 2000);

function showMenu(notice?: MenuNotice | string): void {
  stopReconnecting();
  if (account.account) void account.loadFriends().catch(() => undefined);
  screen = 'menu';
  setOverlay('none');
  setPath('/');
  renderMenu(notice);
}

/** Draws the main menu without touching whatever overlay is open. */
function renderMenu(notice?: MenuNotice | string): void {
  showPickedMap();
  clear(menuLayer);
  window.setTimeout(() => {
    setModeCounts();
    pollCounts(true);
    showInvites();
  }, 0);
  menuLayer.append(
    buildMainMenu(identity.name, {
      onLoadout: () => setOverlay('loadout'),
      onLocker: () => setOverlay('locker'),
      onProfile: () => setOverlay('profile'),
      onFriends: () => (account.account ? setOverlay('friends') : openAccount('signup')),
      onPlay: (name, mode) => {
        if (mode !== 'ranked') return startJoin(name, quickJoin(mode));
        if (!account.account) return openAccount('signup');
        startJoin(name, { kind: 'ranked' });
      },
      onChallenge: (name) => startJoin(name, { kind: 'challenge' }),
      onModeChange: rememberMode,
      onMapChange: rememberMap,
      onCreate: (name) => startJoin(name, { kind: 'create' }),
      onBotsChange: rememberBots,
      onJoinCode: (name, code) => startJoin(name, { kind: 'code', code }),
      onSettings: () => setOverlay('settings'),
      onHowTo: () => setOverlay('howto'),
      onNameChange: rememberName,
    }, notice, lastMode, account.account?.name ?? null, buildDailyCard(account), lastMap, account.active, botsFor),
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
  setActiveCount(account.active);
  showInvites();
  setFriendBadge(account.friendRequests);
  // Drop anything the saved loadout has that isn't unlocked yet.
  const allowed = unlockedAt(unlockLevelOf(account.profile));
  const clean = sanitizeLoadout(game.loadout, allowed);
  if (JSON.stringify(clean) !== JSON.stringify(game.loadout)) game.setLoadout(clean, false);
  const name = account.account?.name ?? null;
  if (name !== lastAccountName) {
    lastAccountName = name;
    if (name) rememberName(name);
    // Just logged in: fetch friends so waiting requests show on the menu.
    if (name) void account.loadFriends().catch(() => undefined);
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
  if (join.kind === 'quick') lastQuick = join;
  clear(menuLayer);
  if (join.kind === 'ranked') {
    input.exitLock();
    screen = 'queue';
    menuLayer.append(buildQueue(0, 1, account.profile.rating ?? 1000, cancelQueue));
  } else {
    menuLayer.append(buildConnecting(join, cancelQueue));
  }
  net.join(name, identity.guestId, join, game.loadout, account.token ?? undefined).catch((err: Error) => {
    input.exitLock();
    showMenu({
      title: "Can't reach the server",
      text: err.message || 'Could not connect. Check your Wi-Fi and try again.',
      action: { label: 'Try again', run: () => startJoin(identity.name, join) },
    });
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
    const retry: JoinRequest | null = room ? rejoinFor(room) : null;
    showMenu({
      title: 'Lost connection',
      text: "Couldn't reach the server. Check your Wi-Fi and try again.",
      action: retry ? { label: 'Try again', run: () => startJoin(identity.name, retry) } : undefined,
    });
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
    const join = rejoinFor(room);
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

/**
 * Getting back into a room after the connection dropped: private rooms by code; public ones the
 * way you first joined (same mode, map and bots switch), trying the same room first so friends
 * who were playing together land together again (even after a server restart).
 */
function rejoinFor(room: { code: string; isPrivate: boolean; mode: ModeId }): JoinRequest {
  if (room.isPrivate) return { kind: 'code', code: room.code };
  const how = lastQuick && (lastQuick.mode === room.mode || (lastQuick.any && room.mode === 'suddenDeath')) ? lastQuick : quickJoin(room.mode);
  return { ...how, room: room.code };
}
/** The last quick-play request (rejoins go back the same way). */
let lastQuick: Extract<JoinRequest, { kind: 'quick' }> | null = null;

/** Joining again after a dropped connection: the same private room, or the same kind of match. */
function rejoinRequest(): JoinRequest | null {
  if (screen === 'playing' && lastRoom && !lastRoom.ranked) return rejoinFor(lastRoom);
  return pendingJoin;
}

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

/** Backs out of the ranked queue or a join that's still connecting. */
function cancelQueue(): void {
  net.close();
  input.exitLock();
  showMenu();
  net.warm().catch(() => undefined);
}

function setOverlay(next: typeof overlay): void {
  // The results screen is redrawn twice a second (for its countdown); keep its scroll position so
  // the rewards and daily challenges at the bottom stay readable on short screens.
  const redraw = next === 'results' && overlay === 'results';
  const resultsScroll = redraw ? (overlayLayer.querySelector('.results .panel')?.scrollTop ?? 0) : 0;
  overlay = next;
  // Menus need the mouse: a menu opened while it's still locked to the game (the controller's
  // Menu button, for one) would send every click to the game instead.
  if (next !== 'none' && next !== 'click' && next !== 'replay' && input.locked) input.exitLock();
  clear(overlayLayer);
  lockerDispose?.();
  lockerDispose = null;
  const back = () => setOverlay(screen === 'playing' ? matchHome() : 'none');
  teamsView = null;
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
    case 'friends': {
      const friends = buildFriends({
        account,
        onJoin: (id) => {
          setOverlay('none');
          if (screen === 'playing') leaveMatch();
          startJoin(identity.name, { kind: 'friend', id });
        },
        // In a match: invite friends into it (they see it on their menu).
        onInvite: screen === 'playing' && game.room && !game.room.ranked ? (id) => account.inviteFriend(id) : null,
        roomCode: () => game.room?.code ?? '',
        onSignup: () => openAccount('signup'),
        onClose: back,
      });
      lockerDispose = friends.dispose;
      overlayLayer.append(friends.root);
      break;
    }
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
            else if (action === 'start') {
              net.send({ type: 'host', action: 'start' });
              resume();
            } else net.send({ type: 'host', action: 'settings', settings: action });
          },
          onBots: (on) => {
            audio.uiClick();
            net.send({ type: 'bots', on });
          },
          onFriends: account.account ? () => setOverlay('friends') : undefined,
        }, { waiting: game.inLobby, players: game.roster.size, you: game.youId, humans: [...game.roster.values()].filter((r) => !r.bot).length }),
      );
      break;
    case 'settings':
      overlayLayer.append(
        buildSettings(settings, {
          onChange: applySettings,
          onClose: () => setOverlay(screen === 'playing' ? matchHome() : 'none'),
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
    case 'loadout': {
      const builder = buildLoadout({
        current: game.loadout,
        onChange: (l) => {
          saveLoadout(l);
          game.setLoadout(l, true);
        },
        onClose: () => setOverlay(screen === 'playing' ? matchHome() : 'none'),
        locked: account.locked,
        note: screen === 'playing' ? 'Changes apply the next time you respawn.' : '',
        looks: {
          cosmetics: () => account.profile.cosmetics,
          owned: () => account.profile.owned,
          equipFinish: (id) => account.equip({ finish: id }),
          onChange: (fn) => account.onChange(fn),
        },
      });
      // Frees the 3D gun view's WebGL context when the builder closes.
      lockerDispose = builder.dispose;
      overlayLayer.append(builder.root);
      break;
    }
    case 'howto':
      overlayLayer.append(
        buildHowTo(
          () => setOverlay(screen === 'playing' ? matchHome() : 'none'),
          input.getBindings(),
          touchMode ? undefined : Object.fromEntries(Object.keys(input.getPadBindings()).map((k) => [k, input.padLabel(k as keyof ReturnType<typeof input.getPadBindings>)])),
          touchMode,
        ),
      );
      break;
    case 'click':
      overlayLayer.append(
        buildClickToPlay(
          game.alive ? 'READY?' : 'WAITING...',
          resume,
          input.lastDevice === 'pad',
          settings.deviceAsked || touchMode
            ? undefined
            : {
                current: settings.device,
                onPick: (d) => {
                  settings.device = d;
                  settings.deviceAsked = true;
                  applySettings(settings);
                },
              },
        ),
      );
      break;
    case 'teams': {
      const view = buildTeamLobby(teamLobbyData, {
        onJoin: (t) => {
          audio.uiClick();
          game.joinTeam(t);
        },
        onReady: (r) => {
          audio.unlock();
          audio.uiClick();
          game.setReady(r);
          teamsView?.update();
        },
        onShuffle: () => net.send({ type: 'host', action: 'shuffle' }),
        onLock: (locked) => net.send({ type: 'host', action: 'lock', locked }),
        onMenu: () => setOverlay('pause'),
        onCopyLink: copyInvite,
        onLeave: leaveMatch,
        onCountdownTick: () => audio.beep(null),
        onBots: (on) => {
          audio.uiClick();
          // Public rooms vote; in a private room the host just switches them.
          if (game.room?.isPrivate) net.send({ type: 'host', action: 'settings', settings: { bots: on } });
          else net.send({ type: 'bots', on });
        },
        onFriends: account.account ? () => setOverlay('friends') : null,
      });
      teamsView = view;
      overlayLayer.append(view.root);
      break;
    }
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
          buildResults(
            game.match.result,
            game.roster,
            game.youId,
            secondsLeft,
            game.teamView(),
            {
              report: game.lastProgress,
              guest: !account.account,
              onSignup: () => openAccount('signup'),
              ranked: !!game.room?.ranked,
              lobby: backToLobby(),
            },
            !redraw,
            resultsActions(),
          ),
        );
        const panel = overlayLayer.querySelector('.results .panel');
        if (panel) panel.scrollTop = resultsScroll;
      }
      break;
    default:
      break;
  }
  input.enabled = screen === 'playing' && (next === 'none' || next === 'results' || next === 'replay') && (input.locked || padPlay || touchMode || input.freeAim);
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
  game.hud.popupWords = s.popupWords;
  game.hud.flashScale = s.screenFlashes;
}

function resume(): void {
  audio.unlock();
  // Between Team Knockout matches there's nothing to play yet: back to the team lobby.
  if (game.inTeamLobby) {
    setOverlay('teams');
    return;
  }
  if (padPlay || touchMode || input.freeAim) {
    setOverlay('none');
    return;
  }
  // No Pointer Lock at all (rare, very old browsers): the only way to play is with a visible cursor.
  if (!('requestPointerLock' in HTMLElement.prototype)) {
    playUnlocked();
    return;
  }
  input.requestLock();
}

/** The browser has no Pointer Lock API: aim with a visible cursor. */
function playUnlocked(): void {
  if (input.freeAim) return;
  input.freeAim = true;
  setOverlay('none');
  hud.toast("Your browser can't lock the mouse, so the cursor stays visible: move it to aim, click the game to shoot, Esc or P for the menu.", 6000);
}

// A refused lock (a click too soon after pressing Esc, or the raw-mouse option not supported, which
// is retried without it): if we're still not locked a moment later, ask for another click. The mouse
// always gets locked and hidden while playing.
input.onLockError = () => {
  window.setTimeout(() => {
    if (screen !== 'playing' || touchMode || padPlay || input.locked || input.freeAim) return;
    if (overlay === 'none' || overlay === 'pause' || overlay === 'click') {
      setOverlay('click');
      hud.toast('Click again to lock the mouse and play.', 2500);
    }
  }, 350);
};

// Private-room lobby: the host presses Enter to start the match.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Enter' || screen !== 'playing' || overlay !== 'none' || !game.inLobby || !game.isHost) return;
  if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
  game.startMatch();
});

// Without pointer lock (touch devices with a keyboard, or a refused lock), Esc or P opens the menu.
window.addEventListener('keydown', (e) => {
  if (screen !== 'playing' || input.locked || (e.code !== 'Escape' && e.code !== 'KeyP')) return;
  if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
  if (overlay === 'none' && (touchMode || input.freeAim)) setOverlay('pause');
  else if (overlay === 'pause' && e.code === 'Escape') resume();
  else if (overlay === 'teams' && e.code === 'Escape') setOverlay('pause');
});

// Controller: Menu toggles pause, any button starts playing without a mouse, B closes menus.
input.onMenuButton = () => {
  if (screen !== 'playing') return;
  if (overlay === 'none' || overlay === 'teams') {
    padPlay = true;
    setOverlay('pause');
  } else if (overlay === 'pause' || overlay === 'click') {
    padPlay = true;
    setOverlay('none');
  }
};
/**
 * Controller menus: the d-pad moves focus through whatever buttons are showing and A presses the
 * focused one; B backs out (results: MENU, replay: skip).
 */
function padMenuItems(): HTMLElement[] {
  const root = screen === 'playing' || overlay !== 'none' ? overlayLayer : menuLayer;
  return [...root.querySelectorAll<HTMLElement>('button:not([disabled]), select, input[type="checkbox"]')].filter((e) => e.offsetParent !== null);
}
function padFocus(dir: 1 | -1): boolean {
  const items = padMenuItems();
  if (!items.length) return false;
  const i = items.indexOf(document.activeElement as HTMLElement);
  (items[i < 0 ? (dir > 0 ? 0 : items.length - 1) : (i + dir + items.length) % items.length] ?? items[0]).focus();
  return true;
}
/** Menus a controller can move around in (not the game itself, the click prompt or the team lobby's own buttons). */
const padNavigable = () => screen === 'menu' || screen === 'room-join' || (screen === 'playing' && overlay !== 'none' && overlay !== 'click' && overlay !== 'teams');

input.onPadButton = (b) => {
  audio.unlock();
  if (padNavigable()) {
    if (b === PAD.UP || b === PAD.LEFT) {
      if (padFocus(-1)) return;
    } else if (b === PAD.DOWN || b === PAD.RIGHT) {
      if (padFocus(1)) return;
    } else if (b === PAD.A) {
      const focused = document.activeElement as HTMLElement | null;
      if (focused && focused !== document.body && padMenuItems().includes(focused)) {
        padPlay = true;
        focused.click();
        return;
      }
    }
  }
  if (overlay === 'results' && (b === PAD.A || b === PAD.B)) {
    const btn = overlayLayer.querySelector<HTMLButtonElement>(b === PAD.A ? '.play-again:not([disabled])' : '.results-menu');
    if (btn) {
      padPlay = true;
      btn.click();
      return;
    }
  }
  if (overlay === 'replay' && (b === PAD.A || b === PAD.B)) {
    overlayLayer.querySelector<HTMLButtonElement>('.replay-banner button')?.click();
    return;
  }
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
  if (b === PAD.B && (overlay === 'settings' || overlay === 'howto' || overlay === 'loadout')) setOverlay(screen === 'playing' ? matchHome() : 'none');
  // Team lobby: A readies up, the bumpers pick a team.
  if (screen === 'playing' && overlay === 'teams') {
    padPlay = true;
    if (b === PAD.A) game.setReady(!game.ready);
    else if (b === PAD.LB) game.joinTeam(0);
    else if (b === PAD.RB) game.joinTeam(1);
    teamsView?.update();
  }
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

/** Private rooms (and every Team Knockout room) go back to the lobby after the results (challenges and ranked don't). */
function backToLobby(): boolean {
  const r = game.room;
  return !!r && (r.isPrivate || r.settings.mode === 'teamKnockout') && !r.challenge && !r.ranked;
}

/** PLAY AGAIN (and who's ready) and MENU for the results screen. */
function resultsActions(): ResultsActions {
  const room = game.room;
  let again: ResultsActions['again'] = null;
  if (room?.ranked) {
    again = {
      label: 'QUEUE AGAIN',
      done: false,
      onClick: () => {
        leaveMatch();
        startJoin(identity.name, { kind: 'ranked' });
      },
    };
  } else if (room && !room.challenge) {
    const humans = [...game.roster.values()].filter((r) => !r.bot).length;
    const mine = game.againIds.has(game.youId);
    again = {
      label: mine ? `READY ✓ ${game.againIds.size}/${Math.max(humans, game.againIds.size)}` : 'PLAY AGAIN',
      done: mine,
      onClick: () => {
        audio.uiClick();
        net.send({ type: 'again' });
        game.againIds.add(game.youId);
        if (overlay === 'results') setOverlay('results');
      },
    };
  }
  return { again, onMenu: leaveMatch };
}

game.onAgainChange = () => {
  if (overlay === 'results') setOverlay('results');
};

/** Menus someone might have open over the team lobby (they go back to it when closed). */
const MENU_OVERLAYS = new Set<Overlay>(['pause', 'settings', 'howto', 'loadout', 'locker', 'profile', 'account', 'face', 'friends']);

game.onTeamLobby = () => teamsView?.update();

/** What the team lobby shows right now. */
function teamLobbyData(): TeamLobbyData {
  const room = game.room;
  const L = game.teamLobby;
  const now = game.clock.tickAt(performance.now());
  const tv = game.teamView();
  return {
    roster: [...game.roster.values()],
    youId: game.youId,
    hostId: room?.hostId ?? -1,
    isHost: !!room?.isPrivate && room.hostId === game.youId,
    isPrivate: !!room?.isPrivate,
    code: room?.code ?? '',
    mapName: MAPS[room?.mapId ?? '']?.name ?? '',
    names: tv?.names ?? ['RED', 'BLUE'],
    colors: tv?.colors ?? [0xff3b5c, 0x2ec5ff],
    lobby: L,
    startsIn: L && L.startsAt > 0 ? Math.max(0, (L.startsAt - now) / BALANCE.tickRate) : null,
    autoReadyIn: L && L.autoReadyAt > 0 ? Math.max(0, (L.autoReadyAt - now) / BALANCE.tickRate) : null,
    botsOn: !!room?.settings.bots,
    botVotes: room?.botVotes ?? null,
  };
}

/** Ticks "Next match in..." without redrawing the results (so their entrance plays once). */
function tickResultsCountdown(): void {
  const countdown = overlayLayer.querySelector<HTMLElement>('.results [data-countdown]');
  if (!countdown) return;
  const secondsLeft = Math.max(0, (game.match.endsAtTick - game.clock.tickAt(performance.now())) / 60);
  countdown.textContent = resultsCountdownText(secondsLeft, !!game.room?.ranked, backToLobby());
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
            onFriend: account.account
              ? (r) => {
                  void account.addFriend(r.name).then(
                    (st) => {
                      hud.toast(st === 'friends' ? `You and ${r.name} are friends now!` : `Friend request sent to ${r.name}.`);
                      renderScoreboard();
                    },
                    (err: Error) => hud.toast(err.message),
                  );
                }
              : null,
            friendState: (acc) => account.friends.find((f) => f.id === acc)?.status ?? '',
          },
      game.teamView(),
    ),
  );
}

// --- Wiring ----------------------------------------------------------------------------------

input.onLockChange = (locked) => {
  // A tablet playing with its trackpad: the on-screen controls get out of the way.
  document.body.classList.toggle('mouse-play', touchMode && locked);
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
      if (screen === 'queue' && !updateQueue(menuLayer, msg.seconds, msg.searching, msg.rating)) {
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
      showMenu({ kind: 'info', text: msg.message, action: { label: 'Queue again', run: () => startJoin(identity.name, { kind: 'ranked' }) } });
      net.warm().catch(() => undefined);
      return;
    }
    if (msg.type === 'moved') {
      // Folded into a busier room of the same mode: its welcome comes next and sets everything up.
      game.leave();
      pendingJoin = null;
      movedReason = msg.reason;
      return;
    }
    if (msg.type === 'welcome') {
      // The scoreboard's add-friend buttons need to know who's a friend already.
      if (account.account) void account.loadFriends().catch(() => undefined);
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
      } else if (movedReason) {
        hud.callout(movedReason, `${MODE_INFO[msg.room.settings.mode].name} · ${MAPS[msg.room.mapId]?.name ?? ''}`, 3.5, '#35d07f');
        audio.goalHorn();
      } else if (msg.room.settings.mode === 'suddenDeath') {
        // Shown once a round is actually on (not while waiting for a second player).
        sdIntro = true;
      }
      movedReason = null;
      aloneSince = 0;
      aloneHinted = false;
      return;
    }
    if (msg.type === 'error') {
      if (msg.code === 'kicked' || screen !== 'playing') {
        const link = roomCodeFromPath();
        game.leave();
        input.exitLock();
        if (msg.code === 'not_found' && link) showRoomJoin(link.code, msg.message, link.challenge);
        else if (msg.code === 'version') showMenu({ kind: 'update', title: 'Blubba got an update!', text: 'Refresh to get the newest version. It only takes a second.', action: { label: 'Refresh', run: () => location.reload() } });
        else if (msg.code === 'kicked') showMenu({ kind: 'info', text: msg.message });
        else showMenu(msg.message);
        if (msg.code === 'account_required') openAccount('login');
        return;
      }
    }
    game.onMessage(msg);
    if (msg.type === 'roster' && scoreboardOpen) renderScoreboard();
    if ((msg.type === 'roster' || msg.type === 'room') && overlay === 'teams') teamsView?.update();
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
      const retry = rejoinRequest();
      game.leave();
      input.exitLock();
      showMenu({
        title: screen === 'playing' ? 'Disconnected' : "Couldn't connect",
        text: reason,
        action: retry ? { label: screen === 'playing' ? 'Rejoin' : 'Try again', run: () => startJoin(identity.name, retry) } : undefined,
      });
    }
  },
};

game.onMatchChange = (m) => {
  if (m.phase === 'playing') game.lastProgress = null;
  if (sdIntro && m.phase === 'playing' && game.mode === 'suddenDeath' && overlay !== 'results' && overlay !== 'replay') {
    sdIntro = false;
    hud.callout('SUDDEN DEATH', "One life. Get knocked out and you're out. Last one standing wins!", 4, '#ff3b5c');
  }
  if (m.phase !== 'results') game.againIds.clear();
  // Team Knockout: the team lobby covers the map until the match starts.
  if (game.inTeamLobby) {
    game.stopReplay();
    input.exitLock();
    if (overlay !== 'teams' && !MENU_OVERLAYS.has(overlay)) setOverlay('teams');
    return;
  }
  if (overlay === 'teams') {
    // The match is on (or the host switched to another mode): off the team lobby.
    setOverlay(input.locked || touchMode || padPlay ? 'none' : 'click');
    if (m.phase === 'playing') hud.callout('GO!', 'Blast the other team off the map!', 1.6);
    return;
  }
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
    sdIntro = false;
    game.stopReplay();
    setOverlay(input.locked || touchMode ? 'none' : 'click');
    if (m.phase === 'playing' && game.mode === 'suddenDeath') hud.callout('SUDDEN DEATH!', "One life. Get knocked out and you're out. Last one standing wins!", 2.4, '#ff3b5c');
    else if (m.phase === 'playing') hud.callout('GO!', 'Blast them off the map!', 1.6);
  }
};

game.onKicked = (message) => {
  game.leave();
  input.exitLock();
  showMenu({ kind: 'info', text: message });
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
  if (overlay === 'results' && fpsFrames === 0) tickResultsCountdown();
  // The team lobby's countdown.
  if (overlay === 'teams' && game.teamLobby?.startsAt) teamsView?.update();
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

// Fade out the HTML splash now that the game is ready (and the fonts are in, so nothing jumps;
// a slow font download doesn't hold it up for long).
const splash = document.getElementById('splash');
if (splash) {
  const fonts = document.fonts?.ready ?? Promise.resolve();
  void Promise.race([fonts, new Promise((r) => window.setTimeout(r, 1200))]).then(() => {
    splash.classList.add('gone');
    window.setTimeout(() => splash.remove(), 450);
  });
}

// Expose for debugging and automated tests.
(window as unknown as { bubba: unknown }).bubba = { game, net, input, renderer, settings, perf, account, touch, setOverlay };

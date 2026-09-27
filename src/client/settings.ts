import type { VolumeSettings } from './audio/audio';

export type QualitySetting = 'auto' | 'low' | 'medium' | 'high';
export type PointerDevice = 'trackpad' | 'mouse';

export interface Settings {
  device: PointerDevice;
  sensTrackpad: number;
  sensMouse: number;
  sensController: number;
  invertY: boolean;
  aimAssist: number;
  quality: QualitySetting;
  fov: number;
  volumes: VolumeSettings;
  colorblindTeams: boolean;
  showFps: boolean;
  bindings: Record<string, string[]>;
  padBindings: Record<string, number[]>;
}

export const DEFAULT_SETTINGS: Settings = {
  device: 'trackpad',
  sensTrackpad: 1,
  sensMouse: 1,
  sensController: 1,
  invertY: false,
  aimAssist: 0.5,
  quality: 'auto',
  fov: 80,
  volumes: { master: 0.8, effects: 0.9, announcer: 0.9, music: 0.4, muted: false },
  colorblindTeams: false,
  showFps: false,
  bindings: {},
  padBindings: {},
};

const KEY = 'bubba.settings.v1';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadSettings(): Settings {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...structuredClone(DEFAULT_SETTINGS),
      ...parsed,
      volumes: { ...DEFAULT_SETTINGS.volumes, ...(parsed.volumes ?? {}) },
      bindings: { ...(parsed.bindings ?? {}) },
      padBindings: { ...(parsed.padBindings ?? {}) },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode or storage disabled: settings just won't persist.
  }
}

/** Stable anonymous guest identity plus the last-used name. */
export interface Identity {
  guestId: string;
  name: string;
}

const ID_KEY = 'bubba.identity.v1';

export function loadIdentity(makeName: () => string): Identity {
  try {
    const raw = storage()?.getItem(ID_KEY);
    if (raw) {
      const id = JSON.parse(raw) as Identity;
      if (id.guestId && id.name) return id;
    }
  } catch {
    // fall through
  }
  const id: Identity = {
    guestId: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: makeName(),
  };
  saveIdentity(id);
  return id;
}

export function saveIdentity(id: Identity): void {
  try {
    storage()?.setItem(ID_KEY, JSON.stringify(id));
  } catch {
    // ignore
  }
}

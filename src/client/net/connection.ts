import type { InputFrame } from '../../shared/input';
import type { Loadout } from '../../shared/loadout';
import {
  type ClientMessage,
  type JoinRequest,
  MSG_SNAPSHOT,
  PROTOCOL_VERSION,
  type ServerMessage,
  type Snapshot,
  decodeSnapshot,
  encodeInputs,
} from '../../shared/protocol';

export interface ConnectionHandlers {
  onMessage: (msg: ServerMessage) => void;
  onSnapshot: (snap: Snapshot) => void;
  onClose: (reason: string) => void;
}

/** WebSocket connection to the game server. Opened early so joining is instant. */
export class Connection {
  private ws: WebSocket | null = null;
  private openPromise: Promise<void> | null = null;
  handlers: ConnectionHandlers | null = null;
  rtt = 80;
  private pingTimer: number | null = null;
  private closedByUs = false;
  bytesIn = 0;

  get url(): string {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }

  /** Opens the socket without joining (warms up DNS/TLS/TCP while the player reads the menu). */
  warm(): Promise<void> {
    if (this.openPromise && this.ws && this.ws.readyState <= WebSocket.OPEN) return this.openPromise;
    this.closedByUs = false;
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.openPromise = new Promise((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Could not reach the Bubba server.'));
    });
    ws.onmessage = (e) => this.onMessage(e);
    ws.onclose = (e) => {
      if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.openPromise = null;
      if (this.ws === ws) this.ws = null;
      if (!this.closedByUs) this.handlers?.onClose(e.reason || 'Disconnected from the server.');
    };
    this.openPromise.catch(() => undefined);
    return this.openPromise;
  }

  async join(name: string, guestId: string, join: JoinRequest, loadout?: Loadout, token?: string): Promise<void> {
    await this.warm();
    this.send({ type: 'hello', v: PROTOCOL_VERSION, name, guestId, join, loadout, token });
    if (this.pingTimer === null) {
      this.pingTimer = window.setInterval(() => this.send({ type: 'ping', t: performance.now() }), 2000);
      this.send({ type: 'ping', t: performance.now() });
    }
  }

  close(): void {
    this.closedByUs = true;
    this.ws?.close();
    this.ws = null;
    this.openPromise = null;
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  sendInputs(frames: InputFrame[]): void {
    if (this.ws?.readyState === WebSocket.OPEN && frames.length) this.ws.send(encodeInputs(frames));
  }

  private onMessage(e: MessageEvent): void {
    if (e.data instanceof ArrayBuffer) {
      this.bytesIn += e.data.byteLength;
      const view = new DataView(e.data);
      if (view.byteLength > 0 && view.getUint8(0) === MSG_SNAPSHOT) this.handlers?.onSnapshot(decodeSnapshot(view));
      return;
    }
    this.bytesIn += (e.data as string).length;
    let msg: ServerMessage;
    try {
      msg = JSON.parse(e.data as string);
    } catch {
      return;
    }
    if (msg.type === 'pong') {
      const sample = performance.now() - msg.t;
      this.rtt = this.rtt * 0.7 + sample * 0.3;
    }
    this.handlers?.onMessage(msg);
  }
}

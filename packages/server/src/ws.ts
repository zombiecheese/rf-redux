// A small WebSocket server (RFC 6455) on node:http's upgrade event: text and binary messages, ping/pong and close,
// no extensions. Enough for the game's own client, without a dependency.

import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OP_CONT = 0;
const OP_TEXT = 1;
const OP_BINARY = 2;
const OP_CLOSE = 8;
const OP_PING = 9;
const OP_PONG = 10;

export interface SocketOptions {
  /** Largest message accepted, in bytes; bigger closes the connection with 1009. */
  maxMessage: number;
  /** Close a connection whose unsent output grows past this many bytes (a client that stopped reading). */
  maxBuffered: number;
}

const DEFAULTS: SocketOptions = { maxMessage: 4 << 20, maxBuffered: 8 << 20 };

export class Socket {
  onText: (text: string) => void = () => {};
  onBinary: (data: Uint8Array) => void = () => {};
  onClose: (code: number) => void = () => {};
  closed = false;
  private buf = Buffer.alloc(0);
  private parts: Buffer[] = [];
  private partsOp = 0;
  private partsLen = 0;

  constructor(private readonly sock: Duplex, private readonly opts: SocketOptions) {
    sock.on('data', (d: Buffer) => this.data(d));
    sock.on('close', () => this.finish(1006));
    sock.on('error', () => this.finish(1006));
    sock.on('end', () => this.finish(1006));
  }

  /** Bytes queued and not yet written to the network. */
  get buffered(): number {
    return this.sock.writableLength;
  }

  sendText(text: string): void {
    this.frame(OP_TEXT, Buffer.from(text, 'utf8'));
  }

  sendBinary(data: Uint8Array): void {
    this.frame(OP_BINARY, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  }

  close(code = 1000, reason = ''): void {
    if (this.closed) return;
    const r = Buffer.from(reason.slice(0, 100), 'utf8');
    const body = Buffer.alloc(2 + r.length);
    body.writeUInt16BE(code, 0);
    r.copy(body, 2);
    this.frame(OP_CLOSE, body);
    this.sock.end();
    this.finish(code);
  }

  private finish(code: number): void {
    if (this.closed) return;
    this.closed = true;
    // Give a close frame a moment to go out, then let the socket go.
    if (!this.sock.destroyed) setTimeout(() => this.sock.destroy(), 1000).unref();
    this.onClose(code);
  }

  private frame(op: number, payload: Buffer): void {
    if (this.closed || this.sock.destroyed) return;
    if (this.sock.writableLength > this.opts.maxBuffered) {
      this.sock.destroy();
      this.finish(1008);
      return;
    }
    const n = payload.length;
    const head = Buffer.alloc(n < 126 ? 2 : n < 0x10000 ? 4 : 10);
    head[0] = 0x80 | op;
    if (n < 126) head[1] = n;
    else if (n < 0x10000) {
      head[1] = 126;
      head.writeUInt16BE(n, 2);
    } else {
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(n), 2);
    }
    this.sock.write(Buffer.concat([head, payload]));
  }

  private data(d: Buffer): void {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (!this.closed) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0]! & 0x80) !== 0;
      const op = b[0]! & 0x0f;
      const masked = (b[1]! & 0x80) !== 0;
      let len = b[1]! & 0x7f;
      let o = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        o = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(this.opts.maxMessage)) return this.close(1009, 'Message too big');
        len = Number(big);
        o = 10;
      }
      if (!masked || b[0]! & 0x70) return this.close(1002, 'Protocol error');
      if (len > this.opts.maxMessage) return this.close(1009, 'Message too big');
      if (b.length < o + 4 + len) return;
      const mask = b.subarray(o, o + 4);
      const payload = Buffer.from(b.subarray(o + 4, o + 4 + len));
      for (let i = 0; i < len; i++) payload[i]! ^= mask[i & 3]!;
      this.buf = b.subarray(o + 4 + len);
      this.handle(fin, op, payload);
    }
  }

  private handle(fin: boolean, op: number, payload: Buffer): void {
    if (op >= 8) {
      if (!fin || payload.length > 125) return this.close(1002, 'Protocol error');
      if (op === OP_PING) this.frame(OP_PONG, payload);
      else if (op === OP_CLOSE) this.close(payload.length >= 2 ? payload.readUInt16BE(0) : 1000);
      else if (op !== OP_PONG) this.close(1002, 'Protocol error');
      return;
    }
    if (op === OP_CONT) {
      if (!this.partsOp) return this.close(1002, 'Protocol error');
    } else {
      if (this.partsOp) return this.close(1002, 'Protocol error');
      if (op !== OP_TEXT && op !== OP_BINARY) return this.close(1003, 'Unsupported');
      this.partsOp = op;
    }
    this.partsLen += payload.length;
    if (this.partsLen > this.opts.maxMessage) return this.close(1009, 'Message too big');
    this.parts.push(payload);
    if (!fin) return;
    const msg = this.parts.length === 1 ? this.parts[0]! : Buffer.concat(this.parts);
    const kind = this.partsOp;
    this.parts = [];
    this.partsOp = 0;
    this.partsLen = 0;
    if (kind === OP_TEXT) this.onText(msg.toString('utf8'));
    else this.onBinary(new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength));
  }
}

/** Completes the handshake for an upgrade request, or answers 400 and returns null. */
export function accept(req: IncomingMessage, sock: Duplex, opts: Partial<SocketOptions> = {}): Socket | null {
  const key = req.headers['sec-websocket-key'];
  if (req.headers.upgrade?.toLowerCase() !== 'websocket' || typeof key !== 'string' || req.headers['sec-websocket-version'] !== '13') {
    sock.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return null;
  }
  const acceptKey = createHash('sha1').update(key + GUID).digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey}\r\n\r\n`);
  if ('setNoDelay' in sock && typeof sock.setNoDelay === 'function') (sock as { setNoDelay(v: boolean): void }).setNoDelay(true);
  return new Socket(sock, { ...DEFAULTS, ...opts });
}

// The part of `ws` Flowly uses (server/local-daemon.ts and its test). Not @types/ws: it pulls
// @types/node in again, which reorders the merge with React Native's global timer declarations so
// `setTimeout(...).unref()` stops typechecking everywhere in the daemon.
declare module "ws" {
  import type { IncomingMessage, Server } from "node:http";
  import type { Socket } from "node:net";

  export class WebSocket {
    constructor(
      url: string,
      protocols?: string | string[],
      options?: { headers?: Record<string, string>; createConnection?: () => Socket },
    );
    readonly readyState: number;
    binaryType: string;
    send(data: string | ArrayBuffer | Uint8Array): void;
    close(code?: number, reason?: string): void;
    on(event: string, listener: (...args: unknown[]) => void): this;
    once(event: "message", listener: (data: Buffer | ArrayBuffer | Buffer[]) => void): this;
    once(event: string, listener: (...args: unknown[]) => void): this;
    off(event: string, listener: (...args: unknown[]) => void): this;
  }

  export class WebSocketServer {
    constructor(options: { server: Server; path?: string });
    on(event: "connection", listener: (socket: WebSocket, request: IncomingMessage) => void): this;
    close(callback?: () => void): void;
  }
}

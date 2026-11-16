/**
 * "The board changed" for subscribed clients (PASEO-0.16-SPEC §3.5). The event carries no data, only a sequence
 * number and what changed: a client that hears it re-reads what it shows through the existing etag reads, so the phone's
 * JS thread decodes nothing extra. Writes of one action are gathered (`settleMs`) into one event.
 *
 * Every new subscriber gets one event at once: it tells the client the subscription is live and makes it read
 * once, which also covers what changed while it was disconnected (Paseo re-subscribes after a reconnect).
 */

/** What changed: the board (cards, events, ideas), outside-session insights (chips only), or "all" (first event). */
export type ChangeScope = "all" | "board" | "sessions";
export type ChangePush = (event: { seq: number; scope: ChangeScope }) => Promise<void>;

export class ChangeFeed {
  private readonly subscribers = new Set<ChangePush>();
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private scope: ChangeScope | null = null;
  constructor(private readonly settleMs = 100) {}

  /** Serves one subscription until `signal` aborts. */
  serve(push: ChangePush, signal: AbortSignal) {
    if (signal.aborted) return;
    this.subscribers.add(push);
    signal.addEventListener("abort", () => this.subscribers.delete(push), { once: true });
    void push({ seq: this.seq, scope: "all" }).catch(() => this.subscribers.delete(push));
  }

  /** After a committed write. */
  notify(scope: Exclude<ChangeScope, "all"> = "board") {
    if (!this.subscribers.size) return;
    this.scope = this.scope === null || this.scope === scope ? scope : "all";
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const event = { seq: ++this.seq, scope: this.scope ?? "board" };
      this.scope = null;
      for (const push of [...this.subscribers]) void push(event).catch(() => this.subscribers.delete(push));
    }, this.settleMs);
    (this.timer as { unref?: () => void }).unref?.();
  }

  get size() {
    return this.subscribers.size;
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.scope = null;
    this.subscribers.clear();
  }
}

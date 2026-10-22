/** A bounded, ephemeral record that this session has received the current refusal list. */
export class DeliveryGate {
  private refusals = new Map<string, { fingerprint: string; expires: number }>();

  acknowledge(binding: string, fingerprint: string, acknowledged: boolean, now: number): boolean {
    for (const [key, value] of this.refusals) if (value.expires <= now) this.refusals.delete(key);
    const previous = this.refusals.get(binding);
    if (acknowledged && previous?.fingerprint === fingerprint) return true;
    this.refusals.delete(binding);
    this.refusals.set(binding, { fingerprint, expires: now + 15 * 60 * 1000 });
    while (this.refusals.size > 1000) this.refusals.delete(this.refusals.keys().next().value!);
    return false;
  }

  clear(binding: string) {
    this.refusals.delete(binding);
  }
}

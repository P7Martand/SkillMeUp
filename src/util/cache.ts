import * as vscode from 'vscode';

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TTLCache {
  private mem = new Map<string, Entry<unknown>>();

  constructor(private readonly state: vscode.Memento) {}

  get<T>(key: string): T | undefined {
    const now = Date.now();
    const hit = this.mem.get(key) as Entry<T> | undefined;
    if (hit && hit.expiresAt > now) return hit.value;
    const persisted = this.state.get<Entry<T>>(this.persistKey(key));
    if (persisted && persisted.expiresAt > now) {
      this.mem.set(key, persisted);
      return persisted.value;
    }
    return undefined;
  }

  /** Returns the cached value even if its TTL has expired, with an `expired` flag. */
  getStale<T>(key: string): { value: T; expired: boolean } | undefined {
    const now = Date.now();
    const hit = this.mem.get(key) as Entry<T> | undefined;
    if (hit) return { value: hit.value, expired: hit.expiresAt <= now };
    const persisted = this.state.get<Entry<T>>(this.persistKey(key));
    if (persisted) {
      this.mem.set(key, persisted);
      return { value: persisted.value, expired: persisted.expiresAt <= now };
    }
    return undefined;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    const entry: Entry<T> = { value, expiresAt: Date.now() + ttlMs };
    this.mem.set(key, entry);
    await this.state.update(this.persistKey(key), entry);
  }

  async invalidate(key: string): Promise<void> {
    this.mem.delete(key);
    await this.state.update(this.persistKey(key), undefined);
  }

  async clear(): Promise<void> {
    for (const k of [...this.mem.keys()]) {
      await this.state.update(this.persistKey(k), undefined);
    }
    this.mem.clear();
  }

  private persistKey(k: string): string {
    return `skillmeup.cache.${k}`;
  }
}

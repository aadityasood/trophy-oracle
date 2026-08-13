import type { StorageLike } from '../data/progress-storage';

export class MemoryStorage implements StorageLike {
  private readonly data = new Map<string, string>();
  private readError: Error | null = null;
  private writeError: Error | null = null;

  readCount = 0;
  writeCount = 0;

  getItem(key: string): string | null {
    this.readCount += 1;
    if (this.readError) throw this.readError;
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writeCount += 1;
    if (this.writeError) throw this.writeError;
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  seed(key: string, value: string): void {
    this.data.set(key, value);
  }

  getRawValue(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setReadError(error: Error | null): void {
    this.readError = error;
  }

  setWriteError(error: Error | null): void {
    this.writeError = error;
  }

  clear(): void {
    this.data.clear();
    this.readCount = 0;
    this.writeCount = 0;
    this.readError = null;
    this.writeError = null;
  }
}

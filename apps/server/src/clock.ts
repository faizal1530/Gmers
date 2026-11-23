export interface Clock {
  now(): number;
  /** Mengembalikan fungsi pembatal. */
  setTimeout(fn: () => void, ms: number): () => void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout(fn, ms) {
    const h = setTimeout(fn, ms);
    h.unref?.();
    return () => clearTimeout(h);
  },
};

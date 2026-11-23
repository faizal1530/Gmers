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

/** Jam yang digerakkan tangan (uji sistem dan simulasi hari). `advance` menjalankan pewaktu yang jatuh tempo. */
export class ManualClock implements Clock {
  private t: number;
  private timers: { at: number; fn: () => void; live: boolean; id: number }[] = [];
  private nextId = 0;
  constructor(start = Date.now()) {
    this.t = start;
  }
  now(): number {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): () => void {
    const timer = { at: this.t + ms, fn, live: true, id: this.nextId++ };
    this.timers.push(timer);
    return () => {
      timer.live = false;
    };
  }
  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.live && x.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      due.live = false;
      this.t = Math.max(this.t, due.at);
      due.fn();
    }
    this.t = target;
    this.timers = this.timers.filter((x) => x.live);
  }
  setTime(ts: number): void {
    if (ts < this.t) throw new RangeError("Jam tidak boleh mundur");
    this.advance(ts - this.t);
  }
}

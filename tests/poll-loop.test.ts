import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PollLoop, type TimerHost } from "../lib/poll-loop";

class FakeTimers implements TimerHost {
  private next = 1;
  readonly pending = new Map<number, { cb: () => void; ms: number }>();
  setTimeout(cb: () => void, ms: number): NodeJS.Timeout {
    const id = this.next++;
    this.pending.set(id, { cb, ms });
    return id as unknown as NodeJS.Timeout;
  }
  clearTimeout(t: NodeJS.Timeout | undefined): void {
    if (t !== undefined) this.pending.delete(t as unknown as number);
  }
  fireAll(): void {
    const due = [...this.pending.entries()];
    this.pending.clear();
    for (const [, { cb }] of due) cb();
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = () => new Promise((r) => setImmediate(r));

describe("PollLoop", () => {
  it("polls at once on start and schedules the next poll after it finished", async () => {
    const timers = new FakeTimers();
    let polls = 0;
    const loop = new PollLoop({ timers, intervalMs: () => 60_000, poll: async () => void polls++, onError: () => {} });
    loop.start();
    await flush();
    assert.equal(polls, 1);
    assert.deepEqual([...timers.pending.values()].map((t) => t.ms), [60_000]);
    timers.fireAll();
    await flush();
    assert.equal(polls, 2);
  });

  it("runs a requested poll after the one in flight instead of in parallel (settings change)", async () => {
    const timers = new FakeTimers();
    const gates = [deferred(), deferred()];
    let running = 0;
    let maxRunning = 0;
    let polls = 0;
    const loop = new PollLoop({
      timers,
      intervalMs: () => 60_000,
      poll: async () => {
        const gate = gates[polls++];
        running++;
        maxRunning = Math.max(maxRunning, running);
        await gate?.promise;
        running--;
      },
      onError: () => {},
    });
    loop.start();
    await flush();
    loop.pollNow();
    await flush();
    assert.equal(polls, 1, "second poll waits for the first");
    gates[0].resolve();
    await flush();
    assert.equal(polls, 2, "second poll runs right after the first");
    gates[1].resolve();
    await flush();
    assert.equal(maxRunning, 1);
    assert.equal(timers.pending.size, 1, "only one next poll is scheduled");
  });

  it("polls immediately when idle and replaces the pending timer", async () => {
    const timers = new FakeTimers();
    let polls = 0;
    const loop = new PollLoop({ timers, intervalMs: () => 60_000, poll: async () => void polls++, onError: () => {} });
    loop.start();
    await flush();
    loop.pollNow();
    await flush();
    assert.equal(polls, 2);
    assert.equal(timers.pending.size, 1);
  });

  it("keeps polling when a poll throws", async () => {
    const timers = new FakeTimers();
    const errors: unknown[] = [];
    const loop = new PollLoop({
      timers,
      intervalMs: () => 1000,
      poll: async () => {
        throw new Error("boom");
      },
      onError: (err) => errors.push(err),
    });
    loop.start();
    await flush();
    assert.equal(errors.length, 1);
    assert.equal(timers.pending.size, 1);
  });

  it("stops scheduling after stop(), also when a poll was in flight", async () => {
    const timers = new FakeTimers();
    const gate = deferred();
    const loop = new PollLoop({ timers, intervalMs: () => 1000, poll: () => gate.promise, onError: () => {} });
    loop.start();
    loop.stop();
    gate.resolve();
    await flush();
    assert.equal(timers.pending.size, 0);
  });

  it("uses the new interval after reschedule()", async () => {
    const timers = new FakeTimers();
    let interval = 60_000;
    const loop = new PollLoop({ timers, intervalMs: () => interval, poll: async () => {}, onError: () => {} });
    loop.start();
    await flush();
    interval = 120_000;
    loop.reschedule();
    assert.deepEqual([...timers.pending.values()].map((t) => t.ms), [120_000]);
  });
});

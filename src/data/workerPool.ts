/**
 * Pool of data workers with a prioritised queue.
 * Lower `priority` numbers run first; queued jobs can be cancelled when the
 * camera has moved on and the result is no longer wanted.
 */
import { platform } from '../platform';
import type { JobMap, JobType, WorkerRequest, WorkerResponse } from './worker/protocol';

interface Pending {
  id: number;
  type: JobType;
  payload: unknown;
  transfer: Transferable[];
  priority: number;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  cancelled: boolean;
}

export interface JobHandle<T> {
  promise: Promise<T>;
  /** Drop the job if it has not started yet (the promise then rejects with a 'cancelled' error). */
  cancel(): void;
}

export class JobCancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

export class WorkerPool {
  private readonly workers: Worker[] = [];
  private readonly busy: Array<Pending | null> = [];
  private readonly queue: Pending[] = [];
  private nextId = 1;
  private disposed = false;

  constructor(size?: number) {
    // Leave a core for rendering; phones rarely benefit from more than two data workers.
    const n = size ?? Math.max(1, Math.min(platform.device.mobile ? 2 : 3, platform.device.cores - 1));
    for (let i = 0; i < n; i++) {
      const worker = new Worker(new URL('./worker/dataWorker.ts', import.meta.url), { type: 'module', name: `starfarer-data-${i}` });
      worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.onMessage(i, ev.data);
      worker.onerror = (ev) => this.onError(i, ev.message || 'worker crashed');
      this.workers.push(worker);
      this.busy.push(null);
    }
  }

  get size(): number {
    return this.workers.length;
  }

  /** Number of jobs waiting or running. */
  get load(): number {
    return this.queue.length + this.busy.filter(Boolean).length;
  }

  run<K extends JobType>(type: K, payload: JobMap[K]['in'], opts: { priority?: number; transfer?: Transferable[] } = {}): JobHandle<JobMap[K]['out']> {
    let job!: Pending;
    const promise = new Promise<unknown>((resolve, reject) => {
      job = { id: this.nextId++, type, payload, transfer: opts.transfer ?? [], priority: opts.priority ?? 5, resolve, reject, cancelled: false };
    });
    if (this.disposed) {
      job.reject(new JobCancelled());
    } else {
      // Insert keeping the queue sorted by priority (stable for equal priorities).
      let i = this.queue.length;
      while (i > 0 && this.queue[i - 1]!.priority > job.priority) i--;
      this.queue.splice(i, 0, job);
      this.pump();
    }
    return {
      promise: promise as Promise<JobMap[K]['out']>,
      cancel: () => {
        if (job.cancelled) return;
        const at = this.queue.indexOf(job);
        if (at >= 0) {
          this.queue.splice(at, 1);
          job.cancelled = true;
          job.reject(new JobCancelled());
        }
      },
    };
  }

  /** Run the same job on every worker (used to install shared data). */
  async broadcast<K extends JobType>(type: K, payload: JobMap[K]['in']): Promise<void> {
    await Promise.all(
      this.workers.map(
        (worker, i) =>
          new Promise<void>((resolve, reject) => {
            const id = this.nextId++;
            const listener = (ev: MessageEvent<WorkerResponse>): void => {
              if (ev.data.id !== id) return;
              worker.removeEventListener('message', listener);
              if (ev.data.ok) resolve();
              else reject(new Error(ev.data.error));
            };
            worker.addEventListener('message', listener);
            const req: WorkerRequest<K> = { id, type, payload };
            worker.postMessage(req);
            void i;
          }),
      ),
    );
  }

  private pump(): void {
    for (let w = 0; w < this.workers.length; w++) {
      if (this.busy[w] || this.queue.length === 0) continue;
      const job = this.queue.shift()!;
      this.busy[w] = job;
      const req: WorkerRequest = { id: job.id, type: job.type, payload: job.payload as never };
      this.workers[w]!.postMessage(req, job.transfer);
    }
  }

  private onMessage(w: number, msg: WorkerResponse): void {
    const job = this.busy[w];
    if (!job || job.id !== msg.id) return; // broadcast replies are handled by their own listeners
    this.busy[w] = null;
    if (msg.ok) job.resolve(msg.result);
    else job.reject(new Error(msg.error));
    this.pump();
  }

  private onError(w: number, message: string): void {
    const job = this.busy[w];
    this.busy[w] = null;
    job?.reject(new Error(message));
    this.pump();
  }

  dispose(): void {
    this.disposed = true;
    for (const job of this.queue.splice(0)) job.reject(new JobCancelled());
    for (const worker of this.workers) worker.terminate();
    this.busy.forEach((job) => job?.reject(new JobCancelled()));
  }
}

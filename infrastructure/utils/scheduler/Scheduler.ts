import { IScheduledJob, ISchedulerCallbacks } from './types';

export class Scheduler {
  private jobs: Map<string, IScheduledJob> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;
  private callbacks: ISchedulerCallbacks = {};

  constructor(callbacks?: ISchedulerCallbacks) {
    this.callbacks = callbacks || {};
  }

  addJob(job: Omit<IScheduledJob, 'createdAt' | 'enabled'>): string {
    const id = job.id || `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const nextRun = this.getNextRun(job.cron).getTime();
    this.jobs.set(id, {
      ...job, id, enabled: true, createdAt: Date.now(), nextRun,
    });
    return id;
  }

  removeJob(id: string): void { this.jobs.delete(id); }

  enableJob(id: string): void {
    const job = this.jobs.get(id);
    if (job) { job.enabled = true; job.nextRun = this.getNextRun(job.cron).getTime(); }
  }

  disableJob(id: string): void {
    const job = this.jobs.get(id);
    if (job) { job.enabled = false; job.nextRun = undefined; }
  }

  start(): void {
    if (this.timer) return;
    const check = () => {
      const now = new Date();
      this.jobs.forEach(job => {
        if (job.enabled && this.matchesCron(job.cron, now)) this.runJob(job);
      });
    };
    this.timer = setInterval(check, 60000);
    check();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  getJobs(): IScheduledJob[] { return Array.from(this.jobs.values()); }

  getNextRun(cron: string): Date {
    const next = new Date(Date.now() + 60000);
    next.setSeconds(0, 0);
    for (let i = 0; i < 525600; i++) {
      if (this.matchesCron(cron, next)) return next;
      next.setTime(next.getTime() + 60000);
    }
    return next;
  }

  private async runJob(job: IScheduledJob): Promise<void> {
    try {
      this.callbacks.onJobRun?.(job);
      await job.handler();
      job.lastRun = Date.now();
      job.nextRun = this.getNextRun(job.cron).getTime();
    } catch (error) {
      this.callbacks.onJobError?.(job, error as Error);
    }
  }

  private matchesCron(cron: string, date: Date): boolean {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return false;
    const min = parts[0]!;
    const hour = parts[1]!;
    const day = parts[2]!;
    const month = parts[3]!;
    const weekday = parts[4]!;
    return this.matchPart(min, date.getMinutes()) &&
           this.matchPart(hour, date.getHours()) &&
           this.matchPart(day, date.getDate()) &&
           this.matchPart(month, date.getMonth() + 1) &&
           this.matchPart(weekday, date.getDay());
  }

  private matchPart(part: string, value: number): boolean {
    if (part === '*') return true;
    if (part.startsWith('*/')) return value % parseInt(part.slice(2), 10) === 0;
    if (part.includes('-')) {
      const rangeParts = part.split('-').map(Number);
      const start = rangeParts[0] ?? 0;
      const end = rangeParts[1] ?? 0;
      return value >= start && value <= end;
    }
    if (part.includes(',')) return part.split(',').map(Number).includes(value);
    return parseInt(part, 10) === value;
  }
}

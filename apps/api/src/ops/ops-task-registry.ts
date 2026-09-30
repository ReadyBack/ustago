import { Injectable } from '@nestjs/common';

export type OpsTask = (now: Date) => Promise<Record<string, number>>;

/**
 * Maintenance tasks other modules hand to the ops monitor (e.g. expiring
 * suspensions). Keeps the monitor free of dependencies on those modules.
 */
@Injectable()
export class OpsTaskRegistry {
  private readonly tasks = new Map<string, OpsTask>();

  register(name: string, task: OpsTask): void {
    this.tasks.set(name, task);
  }

  entries(): [string, OpsTask][] {
    return [...this.tasks.entries()];
  }
}

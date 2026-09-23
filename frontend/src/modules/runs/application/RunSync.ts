import type { RunGateway, RunMirror } from './RunGateway.ts';

/** Pulls server runs and approved assignments into the local register. */
export class RunSync {
  private readonly gateway: RunGateway;
  private readonly mirror: RunMirror;

  constructor(gateway: RunGateway, mirror: RunMirror) {
    this.gateway = gateway;
    this.mirror = mirror;
  }

  sync = async (signal?: AbortSignal): Promise<number> => {
    const [runs, assignments] = await Promise.all([this.gateway.list(signal), this.gateway.assignments(signal)]);
    signal?.throwIfAborted();
    // Runs first: an assignment is attached to the local card of its run.
    await this.mirror.mirrorRuns(runs);
    await this.mirror.mirrorAssignments(assignments);
    return Date.now();
  };
}

import { DexieWorkspaceRepository } from '@/infrastructure/persistence/DexieWorkspaceRepository';
import { WorkspaceDatabase } from '@/infrastructure/persistence/WorkspaceDatabase';
import { demoRecords } from '@/infrastructure/persistence/demo/createDemoRecords';
import { MeetingService } from '@/modules/meetings/application/MeetingService';
import { BrowserMeetingExporter } from '@/modules/meetings/infrastructure/BrowserMeetingExporter';
import { ApiRecordingGateway } from '@/modules/recording/infrastructure/ApiRecordingGateway';
import { BrowserRecorder } from '@/modules/recording/infrastructure/BrowserRecorder';
import { SettingsService } from '@/modules/settings/application/SettingsService';
import { TaskService } from '@/modules/tasks/application/TaskService';
import type { WorkspaceServices } from '@/modules/workspace/application/WorkspaceServices';
import type { Identity } from '@/shared/domain/Identity';
import { createHttpClient } from './createHttpClient';

export function createServices(principalId: string): WorkspaceServices & { close(): void } {
  if (!principalId.trim()) throw new Error('A confirmed principal is required.');
  const database = new WorkspaceDatabase(`siqyrai-workspace:${encodeURIComponent(principalId)}`);
  const repository = new DexieWorkspaceRepository(database, demoRecords);
  const identity: Identity = { nextId: () => crypto.randomUUID(), now: () => new Date() };
  const apiUrl = import.meta.env.VITE_API_URL?.trim();
  return {
    close: () => database.close({ disableAutoOpen: false }),
    workspace: repository,
    meetings: new MeetingService(repository, identity),
    tasks: new TaskService(repository, identity),
    settings: new SettingsService(repository),
    recorder: new BrowserRecorder(),
    recordings: apiUrl ? new ApiRecordingGateway(createHttpClient(), apiUrl) : null,
    exporter: new BrowserMeetingExporter(),
  };
}

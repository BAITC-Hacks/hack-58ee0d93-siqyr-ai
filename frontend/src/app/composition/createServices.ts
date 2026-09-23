import { DexieWorkspaceRepository } from '@/infrastructure/persistence/DexieWorkspaceRepository';
import { WorkspaceDatabase } from '@/infrastructure/persistence/WorkspaceDatabase';
import { demoRecords } from '@/infrastructure/persistence/demo/createDemoRecords';
import { MeetingService } from '@/modules/meetings/application/MeetingService';
import { BrowserMeetingExporter } from '@/modules/meetings/infrastructure/BrowserMeetingExporter';
import { ApiRecordingGateway } from '@/modules/recording/infrastructure/ApiRecordingGateway';
import { LOCAL_WORKSPACE_ID } from '@/modules/auth/domain/auth.types';
import { storedAccessToken } from '@/modules/auth/infrastructure/ApiAuthGateway';
import { BrowserRecorder } from '@/modules/recording/infrastructure/BrowserRecorder';
import { RunSync } from '@/modules/runs/application/RunSync';
import { ApiRunGateway } from '@/modules/runs/infrastructure/ApiRunGateway';
import { SettingsService } from '@/modules/settings/application/SettingsService';
import { TaskService } from '@/modules/tasks/application/TaskService';
import type { WorkspaceServices } from '@/modules/workspace/application/WorkspaceServices';
import type { Identity } from '@/shared/domain/Identity';
import { isOwnServer } from '@/shared/domain/ownServer';
import { createHttpClient } from './createHttpClient';
import { ApiChatGateway } from '@/modules/chat/infrastructure/ApiChatGateway';

export function createServices(principalId: string): WorkspaceServices & { close(): void } {
  if (!principalId.trim()) throw new Error('A confirmed principal is required.');
  const database = new WorkspaceDatabase(`siqyrai-workspace:${encodeURIComponent(principalId)}`);
  const repository = new DexieWorkspaceRepository(database, import.meta.env.VITE_DEMO_SEED === '0'
    ? () => ({ meetings: [], tasks: [] }) : demoRecords);
  const identity: Identity = { nextId: () => crypto.randomUUID(), now: () => new Date() };
  const apiUrl = import.meta.env.VITE_API_URL?.trim();
  const ownApi = apiUrl ? isOwnServer(apiUrl, window.location.origin) : false;
  const serverBacked = ownApi && principalId !== LOCAL_WORKSPACE_ID;
  const accessToken = () => storedAccessToken(window.sessionStorage);
  const runs = serverBacked ? new ApiRunGateway(createHttpClient()) : null;
  return {
    close: () => database.close({ disableAutoOpen: false }),
    workspace: repository,
    meetings: new MeetingService(repository, identity),
    tasks: new TaskService(repository, identity, runs),
    settings: new SettingsService(repository),
    recorder: new BrowserRecorder(),
    recordings: serverBacked && apiUrl ? new ApiRecordingGateway(createHttpClient(), apiUrl, accessToken) : null,
    chat: serverBacked ? new ApiChatGateway(createHttpClient()) : null,
    runs,
    sync: runs ? new RunSync(runs, repository) : null,
    exporter: new BrowserMeetingExporter(),
  };
}

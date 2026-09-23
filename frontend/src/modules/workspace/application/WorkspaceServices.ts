import type { MeetingExporter } from '../../meetings/application/MeetingExporter.ts';
import type { MeetingService } from '../../meetings/application/MeetingService.ts';
import type { Recorder } from '../../recording/application/Recorder.ts';
import type { RecordingGateway } from '../../recording/application/RecordingGateway.ts';
import type { SettingsService } from '../../settings/application/SettingsService.ts';
import type { TaskService } from '../../tasks/application/TaskService.ts';
import type { WorkspaceRepository } from './WorkspaceRepository.ts';
import type { ChatGateway } from '../../chat/application/ChatGateway.ts';

export interface WorkspaceServices {
  meetings: MeetingService;
  tasks: TaskService;
  settings: SettingsService;
  workspace: WorkspaceRepository;
  recorder: Recorder;
  /** null without VITE_API_URL: the recording then stays only in this browser. */
  recordings: RecordingGateway | null;
  chat: ChatGateway | null;
  exporter: MeetingExporter;
}

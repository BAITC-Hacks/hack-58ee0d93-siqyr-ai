import type { MeetingExporter } from '../../meetings/application/MeetingExporter.ts';
import type { MeetingService } from '../../meetings/application/MeetingService.ts';
import type { Recorder } from '../../recording/application/Recorder.ts';
import type { SettingsService } from '../../settings/application/SettingsService.ts';
import type { TaskService } from '../../tasks/application/TaskService.ts';
import type { WorkspaceRepository } from './WorkspaceRepository.ts';

export interface WorkspaceServices {
  meetings: MeetingService;
  tasks: TaskService;
  settings: SettingsService;
  workspace: WorkspaceRepository;
  recorder: Recorder;
  exporter: MeetingExporter;
}

import type { MeetingLanguage } from '../../meetings/domain/meeting.types.ts';

export interface Settings {
  displayName: string;
  organization: string;
  defaultLanguage: MeetingLanguage;
  reminderDays: number;
}

export const defaultSettings: Readonly<Settings> = Object.freeze({
  displayName: '', organization: '', defaultLanguage: 'ru', reminderDays: 3,
});

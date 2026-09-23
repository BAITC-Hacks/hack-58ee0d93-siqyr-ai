import { DomainError } from '../../../shared/domain/DomainError.ts';
import { isMeetingLanguage } from '../../meetings/domain/meeting.types.ts';
import type { Settings } from '../domain/settings.types.ts';
import type { SettingsRepository } from './SettingsRepository.ts';

export class SettingsService {
  private readonly repository: SettingsRepository;

  constructor(repository: SettingsRepository) {
    this.repository = repository;
  }

  update = async (patch: Partial<Settings>): Promise<void> => {
    const current = await this.repository.getSettings();
    const next: Settings = {
      displayName: (patch.displayName ?? current.displayName).trim(),
      organization: (patch.organization ?? current.organization).trim(),
      defaultLanguage: patch.defaultLanguage ?? current.defaultLanguage,
      reminderDays: patch.reminderDays ?? current.reminderDays,
    };
    if (next.displayName.length > 80) throw new DomainError('Не более 80 символов.');
    if (next.organization.length > 160) throw new DomainError('Не более 160 символов.');
    if (!isMeetingLanguage(next.defaultLanguage)) throw new DomainError('Выберите язык встречи.');
    if (!Number.isInteger(next.reminderDays) || next.reminderDays < 0 || next.reminderDays > 30) throw new DomainError('Укажите целое число от 0 до 30.');
    const changes: Partial<Settings> = {};
    if (patch.displayName !== undefined) changes.displayName = next.displayName;
    if (patch.organization !== undefined) changes.organization = next.organization;
    if (patch.defaultLanguage !== undefined) changes.defaultLanguage = next.defaultLanguage;
    if (patch.reminderDays !== undefined) changes.reminderDays = next.reminderDays;
    await this.repository.updateSettings(changes);
  };
}

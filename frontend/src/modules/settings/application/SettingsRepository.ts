import type { Settings } from '../domain/settings.types.ts';

export interface SettingsRepository {
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
}

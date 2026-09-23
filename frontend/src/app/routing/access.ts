import { canAccess, isAccessPolicy, type AccessPolicy } from '../../modules/auth/domain/accessPolicy.ts';
import type { AuthSession } from '../../modules/auth/domain/auth.types.ts';

// Pages that create a server run: the API refuses them without a write role in the department.
const writeMeetings: AccessPolicy = { permissionsAllOf: ['meetings:write'] };

export const pagePolicies = {
  meetings: {},
  meeting: {},
  newMeeting: writeMeetings,
  liveMeeting: {},
  call: writeMeetings,
  chat: {},
  tasks: {},
  integrations: {},
  settings: {},
} satisfies Record<string, AccessPolicy>;

export type ProtectedPage = keyof typeof pagePolicies;
export interface SecurityHandle { access: AccessPolicy }

export const workspaceNavigation: ReadonlyArray<{ id: ProtectedPage; to: string; label: string }> = [
  // { id: 'meetings', to: '/meetings', label: 'Встречи' },
  { id: 'liveMeeting', to: '/meetings/live', label: 'Разговоры' },
  { id: 'chat', to: '/chat', label: 'Чат по встречам' },
  { id: 'tasks', to: '/tasks', label: 'Поручения' },
  { id: 'integrations', to: '/integrations', label: 'Интеграции' },
];

export function firstAccessiblePath(session: AuthSession): string | null {
  return workspaceNavigation.find((item) => canAccess(session, pagePolicies[item.id]))?.to ?? null;
}

export function resolveRouteAccess(session: AuthSession | null, handles: unknown[]): boolean {
  const policies = handles.filter((handle): handle is SecurityHandle =>
    typeof handle === 'object' && handle !== null && 'access' in handle);
  // Missing metadata must not accidentally publish a new protected page.
  if (!policies.length) return false;
  return policies.every(({ access }) => isAccessPolicy(access) && canAccess(session, access));
}

/** Department roles from /api/auth/me and what they allow; mirrors Principal.can in backend/app/auth.py. */
export type Permission = 'meetings:read' | 'meetings:write' | 'protocol:approve' | 'department:admin' | 'system:admin';

const rolePermissions: Readonly<Record<string, readonly Permission[]>> = {
  viewer: ['meetings:read'],
  editor: ['meetings:read', 'meetings:write'],
  secretary: ['meetings:read', 'meetings:write', 'protocol:approve'],
  department_admin: ['meetings:read', 'meetings:write', 'protocol:approve', 'department:admin'],
};

const allPermissions: readonly Permission[] = ['meetings:read', 'meetings:write', 'protocol:approve', 'department:admin', 'system:admin'];

/** The UI creates runs without department_id, so the API files them under this department. */
export const workspaceDepartment = 'default';

/**
 * Claims for the workspace department only: a role in another department grants nothing here,
 * exactly as the API answers 403/404 for runs outside the user's departments.
 */
export function departmentClaims(isSystemAdmin: boolean, departments: Readonly<Record<string, string>>): { roles: string[]; permissions: Permission[] } {
  const role = departments[workspaceDepartment];
  return {
    roles: [...(isSystemAdmin ? ['system_admin'] : []), ...(role ? [role] : [])],
    permissions: [...(isSystemAdmin ? allPermissions : rolePermissions[role ?? ''] ?? [])],
  };
}

const roleLabels: ReadonlyArray<[string, string]> = [
  ['system_admin', 'Системный администратор'],
  ['department_admin', 'Администратор департамента'],
  ['secretary', 'Секретарь'],
  ['editor', 'Редактор'],
  ['viewer', 'Наблюдатель'],
];

/** The strongest known role, for display only; access checks use permissions. */
export function roleLabel(roles: readonly string[]): string {
  return roleLabels.find(([role]) => roles.includes(role))?.[1] ?? 'Без роли в департаменте';
}

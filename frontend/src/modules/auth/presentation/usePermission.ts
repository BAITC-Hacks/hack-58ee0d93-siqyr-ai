import { canAccess } from '../domain/accessPolicy.ts';
import type { Permission } from '../domain/departmentAccess.ts';
import { useAuth } from './AuthProvider';

/** Hides controls the API would refuse; the API still checks every request itself. */
export function usePermission(permission: Permission): boolean {
  const { state } = useAuth();
  return state.status === 'authenticated' && canAccess(state.session, { permissionsAllOf: [permission] });
}

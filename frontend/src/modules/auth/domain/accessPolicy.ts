import type { AuthSession } from './auth.types.ts';
import { isSessionActive } from './auth.types.ts';

export interface AccessPolicy {
  /** At least one role must match. An explicitly empty list denies access. */
  readonly rolesAnyOf?: readonly string[];
  /** Every permission must match. An explicitly empty list denies access. */
  readonly permissionsAllOf?: readonly string[];
}

export function isAccessPolicy(value: unknown): value is AccessPolicy {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, claims]) =>
    (key === 'rolesAnyOf' || key === 'permissionsAllOf') && Array.isArray(claims)
    && claims.every((claim) => typeof claim === 'string' && claim.trim() === claim && claim.length > 0));
}

export function canAccess(session: AuthSession | null, policy: AccessPolicy, now = Date.now()): boolean {
  if (!session || !isSessionActive(session, now) || !isAccessPolicy(policy)) return false;
  const { rolesAnyOf, permissionsAllOf } = policy;
  if (rolesAnyOf && (!rolesAnyOf.length || !rolesAnyOf.some((role) => session.principal.roles.includes(role)))) return false;
  if (permissionsAllOf && (!permissionsAllOf.length || !permissionsAllOf.every((permission) => session.principal.permissions.includes(permission)))) return false;
  return true;
}

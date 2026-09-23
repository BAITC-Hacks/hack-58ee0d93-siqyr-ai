import { Navigate, Outlet, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/modules/auth/presentation/AuthProvider';
import { SessionStatus } from '@/modules/auth/presentation/components/SessionStatus';
import { safeReturnPath } from '@/modules/auth/domain/returnPath';
import { firstAccessiblePath } from './access';
import { AccessDenied } from './AccessDenied';

export function GuestRoute() {
  const { state } = useAuth();
  const [params] = useSearchParams();
  if (state.status === 'checking' || state.status === 'error') return <SessionStatus />;
  if (state.status === 'authenticated') {
    const fallback = firstAccessiblePath(state.session);
    if (!fallback) return <AccessDenied />;
    return <Navigate to={safeReturnPath(params.get('returnTo'), fallback)} replace />;
  }
  return <Outlet />;
}

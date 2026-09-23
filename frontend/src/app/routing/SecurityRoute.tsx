import { Navigate, Outlet, useLocation, useMatches } from 'react-router-dom';
import { useAuth } from '@/modules/auth/presentation/AuthProvider';
import { SessionStatus } from '@/modules/auth/presentation/components/SessionStatus';
import { resolveRouteAccess } from './access';
import { AccessDenied } from './AccessDenied';

export function SecurityRoute() {
  const { state } = useAuth();
  const location = useLocation();
  const matches = useMatches();
  if (state.status === 'checking' || state.status === 'error') return <SessionStatus />;
  if (state.status === 'anonymous') {
    const returnTo = location.pathname + location.search + location.hash;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }
  if (!resolveRouteAccess(state.session, matches.map((match) => match.handle))) return <AccessDenied />;
  return <Outlet />;
}

import { Navigate } from 'react-router-dom';
import { useAuth } from '@/modules/auth/presentation/AuthProvider';
import { firstAccessiblePath } from './access';
import { AccessDenied } from './AccessDenied';

export function WorkspaceRedirect() {
  const { state } = useAuth();
  const target = state.status === 'authenticated' ? firstAccessiblePath(state.session) : null;
  return target ? <Navigate to={target} replace /> : <AccessDenied />;
}

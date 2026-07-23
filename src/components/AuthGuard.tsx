/**
 * Auth Guard — protects routes that require authentication.
 * Redirects to /login/ if no valid token.
 */

import { Navigate, useLocation } from 'react-router-dom';
import { isAuthenticated } from '../lib/api';

interface AuthGuardProps {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const location = useLocation();

  if (!isAuthenticated()) {
    return <Navigate to="/sign-in" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}

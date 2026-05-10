import { Navigate, Outlet } from 'react-router';
import { getToken } from '../lib/auth';

export function ProtectedRoute() {
  const token = getToken();
  if (!token) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}

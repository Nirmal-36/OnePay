import { LoaderCircle, RefreshCw, WifiOff } from 'lucide-react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Brand } from './Brand';
import { Button } from './Controls';

export function SessionLoading() {
  return (
    <main className="auth-status-page">
      <Brand />
      <section className="card auth-status-card" role="status" aria-live="polite">
        <LoaderCircle className="spin" size={24} aria-hidden="true" />
        <h1>Checking your session</h1>
        <p>Connecting securely to your OnePay account…</p>
      </section>
    </main>
  );
}

export function SessionError() {
  const { sessionError, refreshSession } = useAuth();
  return (
    <main className="auth-status-page">
      <Brand />
      <section className="card auth-status-card" role="alert">
        <span className="auth-status-icon"><WifiOff size={23} /></span>
        <h1>We couldn’t check your session</h1>
        <p>{sessionError ?? 'The OnePay account service is not responding.'}</p>
        <Button onClick={() => void refreshSession()} icon={<RefreshCw size={16} />}>Try again</Button>
        <small>Your account password is separate from any banking credentials. Never share a banking PIN or OTP.</small>
      </section>
    </main>
  );
}

export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <SessionLoading />;
  if (status === 'error') return <SessionError />;
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

export function GuestRoute() {
  const { status } = useAuth();
  if (status === 'loading') return <SessionLoading />;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <Outlet />;
}

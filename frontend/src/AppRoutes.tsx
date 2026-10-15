import { lazy, Suspense } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import { GuestRoute, ProtectedRoute } from './components/AuthRouteGuards';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const PasswordResetPage = lazy(() => import('./pages/PasswordResetPage'));
const PasswordResetConfirmPage = lazy(() => import('./pages/PasswordResetConfirmPage'));
const HomePage = lazy(() => import('./pages/HomePage'));
const SendMoneyPage = lazy(() => import('./pages/SendMoneyPage'));
const ScanQrPage = lazy(() => import('./pages/ScanQrPage'));
const TransactionsPage = lazy(() => import('./pages/TransactionsPage'));
const BillsPage = lazy(() => import('./pages/BillsPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const HelpPage = lazy(() => import('./pages/HelpPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function RouteLoading() {
  return <div className="card route-loading" role="status"><LoaderCircle className="spin" size={21} /><span>Loading OnePay…</span></div>;
}

export default function AppRoutes() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route element={<GuestRoute />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/password-reset" element={<PasswordResetPage />} />
          <Route path="/reset-password/confirm" element={<PasswordResetConfirmPage />} />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/send" element={<SendMoneyPage />} />
            <Route path="/scan" element={<ScanQrPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/bills" element={<BillsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}

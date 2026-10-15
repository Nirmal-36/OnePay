import { lazy, Suspense } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';

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
  return <div className="card route-loading" role="status"><LoaderCircle className="spin" size={21} /><span>Loading this demo page…</span></div>;
}

export default function AppRoutes() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="send" element={<SendMoneyPage />} />
          <Route path="scan" element={<ScanQrPage />} />
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="bills" element={<BillsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="help" element={<HelpPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

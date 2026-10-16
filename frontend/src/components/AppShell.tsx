import { useEffect, useState } from 'react';
import { Bell, CircleHelp, House, LogOut, ReceiptText, ScanLine, Send, Settings2, ShieldCheck, Smartphone, UsersRound, WalletCards } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { apiErrorMessage } from '../api/auth';
import { useAuth } from '../context/AuthContext';
import { useDemo } from '../context/DemoProvider';
import { useToast } from '../context/ToastProvider';
import { Brand } from './Brand';
import { ProfileAvatar } from './Avatar';

const primaryLinks = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/send', label: 'Send money', icon: Send },
  { to: '/recipients', label: 'Recipients', icon: UsersRound },
  { to: '/scan', label: 'Scan QR', icon: ScanLine },
  { to: '/transactions', label: 'Transactions', icon: ReceiptText },
  { to: '/bills', label: 'Recharge & bills', icon: Smartphone },
];

const mobileLinks = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/send', label: 'Pay', icon: Send },
  { to: '/scan', label: 'Scan', icon: ScanLine },
  { to: '/transactions', label: 'Activity', icon: ReceiptText },
  { to: '/profile', label: 'Profile', icon: Settings2 },
];

const titleForPath = (path: string): string => {
  if (path === '/') return 'Your home';
  if (path.startsWith('/send')) return 'Send money';
  if (path.startsWith('/scan')) return 'Scan & pay';
  if (path.endsWith('/receipt')) return 'Transaction receipt';
  if (path.startsWith('/transactions/') && path !== '/transactions') return 'Transaction details';
  if (path.startsWith('/transactions')) return 'Transaction history';
  if (path.startsWith('/recipients')) return 'Manage recipients';
  if (path.startsWith('/bills')) return 'Recharge & bills';
  if (path.startsWith('/profile')) return 'Your profile';
  if (path.startsWith('/notifications')) return 'Notifications';
  if (path.startsWith('/help')) return 'Help & support';
  return 'OnePay';
};

function SidebarLinks() {
  return (
    <nav className="sidebar-nav" aria-label="Main navigation">
      <span className="nav-section-label">Workspace</span>
      {primaryLinks.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
          <span>{label}</span>
          {to === '/scan' && <span className="nav-spark" aria-hidden="true">NEW</span>}
        </NavLink>
      ))}
      <span className="nav-section-label nav-section-lower">Support</span>
      <NavLink to="/help" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
        <CircleHelp size={19} strokeWidth={1.8} aria-hidden="true" /><span>Help & support</span>
      </NavLink>
    </nav>
  );
}

export default function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, notifications, paymentDataError, refreshPaymentData } = useDemo();
  const { signOut } = useAuth();
  const { showToast } = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const unreadCount = notifications.filter((item) => !item.read).length;

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch (error) {
      showToast(apiErrorMessage(error, 'Could not sign out. Please try again.'), 'error');
    } finally {
      setSigningOut(false);
    }
  };

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [location.pathname]);

  const notificationButton = (
    <Link to="/notifications" className="icon-button notification-trigger" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}>
      <Bell size={19} strokeWidth={1.8} />
      {unreadCount > 0 && <span className="notification-dot" aria-hidden="true" />}
    </Link>
  );

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-top">
          <Brand />
          <div className="demo-mini-label"><span className="demo-pulse" />Demo workspace</div>
        </div>
        <SidebarLinks />
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <span className="tip-icon"><WalletCards size={18} /></span>
            <div><strong>Demo funds only</strong><span>No real money moves here.</span></div>
          </div>
          <Link to="/profile" className="sidebar-profile">
            <ProfileAvatar profile={profile} />
            <span className="sidebar-profile-copy"><strong>{profile.name}</strong><small>OnePay account</small></span>
            <Settings2 size={17} aria-hidden="true" />
          </Link>
        </div>
      </aside>

      <div className="app-main">
        <header className="desktop-topbar">
          <div className="topbar-title">
            <span className="topbar-kicker">OnePay workspace</span>
            <strong>{titleForPath(location.pathname)}</strong>
          </div>
          <div className="topbar-actions">
            <span className="topbar-demo-pill"><span className="demo-pulse" />Demo mode</span>
            {notificationButton}
            <Link to="/profile" className="topbar-user" aria-label={`Open profile for ${profile.name}`}>
              <ProfileAvatar profile={profile} size="sm" />
              <span>{profile.name.split(' ')[0]}</span>
            </Link>
            <button type="button" className="topbar-signout" onClick={() => void handleSignOut()} disabled={signingOut}>
              <LogOut size={16} aria-hidden="true" />{signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </header>

        <header className="mobile-topbar">
          <Brand compact />
          <div className="mobile-topbar-actions">
            {notificationButton}
            <Link to="/profile" aria-label={`Open profile for ${profile.name}`}><ProfileAvatar profile={profile} size="sm" /></Link>
          </div>
        </header>

        <main id="main-content" className="page-container">
          <div className="persistent-demo-notice" role="note"><ShieldCheck size={17} /><span><strong>OnePay demo only.</strong> All balances and payments are simulated; no real UPI transfer or funds movement occurs.</span></div>
          {paymentDataError && <div className="payment-data-error" role="alert"><span>{paymentDataError}</span><button type="button" onClick={() => { void refreshPaymentData().catch(() => undefined); }}>Retry</button></div>}
          <Outlet />
        </main>

        <footer className="desktop-footer">
          <span>© {new Date().getFullYear()} OnePay demo</span>
          <span>Built for practice · No real payments</span>
        </footer>

        <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
          {mobileLinks.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `mobile-nav-link ${isActive ? 'active' : ''}`}>
              <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

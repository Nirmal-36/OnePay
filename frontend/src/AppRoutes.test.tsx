import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DemoProvider } from './context/DemoProvider';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastProvider';
import AppRoutes from './AppRoutes';

function renderRoute(path: string) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ user: { id: 1, email: 'ananya@example.test', full_name: 'Ananya Sharma', date_joined: '2026-10-15T12:00:00Z' } }),
  }));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <DemoProvider>
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </DemoProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('application routes', () => {
  it.each([
    ['/', /Good (morning|afternoon|evening), Ananya/],
    ['/send', 'Send money'],
    ['/scan', 'Scan QR'],
    ['/transactions', 'Transaction history'],
    ['/bills', 'Recharge & bills'],
    ['/profile', 'Profile & settings'],
    ['/notifications', 'Notifications'],
    ['/help', 'Help & support'],
    ['/route-that-does-not-exist', 'This page took a wrong turn.'],
  ])('renders %s', async (path, heading) => {
    renderRoute(path);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
  });

  it('navigates to Send money from the main navigation', async () => {
    renderRoute('/');
    await screen.findByRole('heading', { name: /Good (morning|afternoon|evening), Ananya/ });
    const mainNav = screen.getByRole('navigation', { name: 'Main navigation' });
    fireEvent.click(within(mainNav).getByRole('link', { name: /Send money/ }));
    expect(await screen.findByRole('heading', { name: 'Send money' })).toBeInTheDocument();
  });

  it('shows field validation before opening the simulated payment review', async () => {
    renderRoute('/send');
    await screen.findByRole('heading', { name: 'Send money' });
    fireEvent.click(screen.getByRole('button', { name: 'Review demo payment' }));
    expect(screen.getByText(/Enter a UPI ID in the format name@bank/)).toBeInTheDocument();
    expect(screen.getByText('Enter an amount greater than ₹0.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('records a clearly labeled in-memory demo payment', async () => {
    renderRoute('/send');
    await screen.findByRole('heading', { name: 'Send money' });
    fireEvent.change(screen.getByLabelText('UPI ID'), { target: { value: 'rohan@okaxis' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '125' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review demo payment' }));
    expect(await screen.findByRole('dialog', { name: 'Review demo payment' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm demo payment' }));
    expect(await screen.findByRole('dialog', { name: 'Demo payment recorded' })).toBeInTheDocument();
    expect(screen.getByText(/Simulated only · no real money moved/)).toBeInTheDocument();
  });

  it('records a recharge as simulated activity without contacting a provider', async () => {
    renderRoute('/bills');
    await screen.findByRole('heading', { name: 'Recharge & bills' });
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '9876543210' } });
    fireEvent.change(screen.getByLabelText('Amount in rupees'), { target: { value: '199' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review recharge' }));
    expect(await screen.findByRole('dialog', { name: 'Review demo payment' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm demo payment' }));
    expect(await screen.findByRole('dialog', { name: 'Demo activity recorded' })).toBeInTheDocument();
    expect(screen.getByText('Simulated only · no provider was contacted')).toBeInTheDocument();
  });

  it('offers a working demo QR scan result', async () => {
    renderRoute('/scan');
    await screen.findByRole('heading', { name: 'Scan QR' });
    fireEvent.click(screen.getByRole('button', { name: 'Try a demo QR' }));
    expect(screen.getByText('QR details read')).toBeInTheDocument();
    expect(screen.getByText('arjun@okicici')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });

  it('can filter the transaction history to received demo activity', async () => {
    renderRoute('/transactions');
    await screen.findByRole('heading', { name: 'Transaction history' });
    fireEvent.click(screen.getByRole('button', { name: 'Received' }));
    expect(screen.getByRole('button', { name: /Kavya Iyer/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rohan Mehta/ })).not.toBeInTheDocument();
  });
});

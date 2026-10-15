import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import AppRoutes from './AppRoutes';
import { DemoProvider } from './context/DemoProvider';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastProvider';

const user = {
  id: 7,
  email: 'aasha@example.test',
  full_name: 'Aasha Rao',
  date_joined: '2026-10-15T12:00:00Z',
};

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
}) as Response;

function renderApp(path: string) {
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

describe('real account authentication flow', () => {
  it('sends unauthenticated visitors to sign in instead of showing a protected page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, {
      error: { status: 401, message: 'Authentication credentials were not provided.', details: null },
    })));

    renderApp('/profile');
    expect(await screen.findByRole('heading', { name: 'Sign in to OnePay' })).toBeInTheDocument();
    expect(screen.getByLabelText('OnePay account password')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Profile & settings' })).not.toBeInTheDocument();
  });

  it('uses the CSRF-protected login API and returns to the requested page', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/me/')) {
        return jsonResponse(401, { error: { status: 401, message: 'Sign in required.', details: null } });
      }
      if (url.endsWith('/csrf/')) return jsonResponse(200, { csrfToken: 'masked-csrf-token' });
      if (url.endsWith('/login/')) return jsonResponse(200, { user, csrfToken: 'rotated-csrf-token' });
      throw new Error(`Unexpected auth endpoint: ${url} (${init?.method ?? 'GET'})`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApp('/send');
    await screen.findByRole('heading', { name: 'Sign in to OnePay' });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText('OnePay account password'), { target: { value: 'OnePay!AccountOnly2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Send money' })).toBeInTheDocument();
    const loginCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/login/'));
    expect(loginCall).toBeDefined();
    const request = loginCall?.[1];
    expect(request?.method).toBe('POST');
    expect(request?.credentials).toBe('include');
    expect((request?.headers as Record<string, string>)['X-CSRFToken']).toBe('masked-csrf-token');
    expect(request?.body).toBe(JSON.stringify({ email: user.email, password: 'OnePay!AccountOnly2026' }));
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/csrf/'))).toBe(true);
  });

  it('shows a server error instead of claiming invalid credentials succeeded', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/me/')) return jsonResponse(401, { error: { status: 401, message: 'Sign in required.', details: null } });
      if (url.endsWith('/csrf/')) return jsonResponse(200, { csrfToken: 'masked-csrf-token' });
      if (url.endsWith('/login/')) return jsonResponse(401, {
        error: { status: 401, message: 'Unable to log in with those credentials.', details: null },
      });
      throw new Error(`Unexpected auth endpoint: ${url}`);
    }));

    renderApp('/login');
    await screen.findByRole('heading', { name: 'Sign in to OnePay' });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'aasha@example.test' } });
    fireEvent.change(screen.getByLabelText('OnePay account password'), { target: { value: 'incorrect password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to log in with those credentials.');
    expect(screen.getByRole('heading', { name: 'Sign in to OnePay' })).toBeInTheDocument();
  });
});

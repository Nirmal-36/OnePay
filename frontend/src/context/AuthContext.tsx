import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { ApiError, apiErrorMessage, authApi, type AuthUser } from '../api/auth';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'error';

interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  sessionError: string | null;
  refreshSession: () => Promise<void>;
  signIn: (data: { email: string; password: string }) => Promise<AuthUser>;
  signUp: (data: { email: string; full_name: string; password: string; password_confirm: string }) => Promise<AuthUser>;
  signOut: () => Promise<void>;
  updateAccountProfile: (data: { full_name: string }) => Promise<AuthUser>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [sessionError, setSessionError] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    setStatus('loading');
    setSessionError(null);
    try {
      const response = await authApi.currentUser();
      setUser(response.user);
      setStatus('authenticated');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        setStatus('anonymous');
        return;
      }
      setUser(null);
      setStatus('error');
      setSessionError(apiErrorMessage(error, 'Unable to check your account session.'));
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const signIn = useCallback(async (data: { email: string; password: string }) => {
    const response = await authApi.login(data);
    setUser(response.user);
    setStatus('authenticated');
    setSessionError(null);
    return response.user;
  }, []);

  const signUp = useCallback(async (data: { email: string; full_name: string; password: string; password_confirm: string }) => {
    const response = await authApi.register(data);
    setUser(response.user);
    setStatus('authenticated');
    setSessionError(null);
    return response.user;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      // A 401 means the server-side session has already expired or been invalidated.
    }
    setUser(null);
    setStatus('anonymous');
    setSessionError(null);
  }, []);

  const updateAccountProfile = useCallback(async (data: { full_name: string }) => {
    try {
      const response = await authApi.updateProfile(data);
      setUser(response.user);
      return response.user;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        setStatus('anonymous');
      }
      throw error;
    }
  }, []);

  const value = useMemo(() => ({
    user,
    status,
    sessionError,
    refreshSession,
    signIn,
    signUp,
    signOut,
    updateAccountProfile,
  }), [user, status, sessionError, refreshSession, signIn, signUp, signOut, updateAccountProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}

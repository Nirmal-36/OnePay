export interface AuthUser {
  id: number;
  email: string;
  full_name: string;
  date_joined: string;
}

interface ApiErrorBody {
  error?: {
    status?: number;
    message?: string;
    details?: unknown;
  };
}

export interface AuthResponse {
  user: AuthUser;
  csrfToken: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status = 0, details: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

const authBase = '/api/v1/auth';
let csrfToken: string | null = null;
let csrfRequest: Promise<string> | null = null;

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
};

async function decodeResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError('The server returned an unreadable response.', response.status);
  }
}

async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  if (!csrfRequest) {
    csrfRequest = (async () => {
      let response: Response;
      try {
        response = await fetch(`${authBase}/csrf/`, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
      } catch {
        throw new ApiError('Could not connect to OnePay. Check that the development server is running and try again.');
      }
      const payload = await decodeResponse<{ csrfToken?: string } & ApiErrorBody>(response);
      if (!response.ok || !payload.csrfToken) {
        throw new ApiError(payload.error?.message ?? 'Could not start a secure session. Please try again.', response.status, payload.error?.details);
      }
      csrfToken = payload.csrfToken;
      return csrfToken;
    })().finally(() => {
      csrfRequest = null;
    });
  }
  return csrfRequest;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  const init: RequestInit = { method, credentials: 'include', headers };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  if (method !== 'GET') headers['X-CSRFToken'] = await getCsrfToken();

  let response: Response;
  try {
    response = await fetch(`${authBase}/${path}`, init);
  } catch {
    throw new ApiError('Could not connect to OnePay. Check your connection and try again.');
  }

  const payload = await decodeResponse<T & ApiErrorBody>(response);
  if (!response.ok) {
    throw new ApiError(
      payload.error?.message ?? 'Something went wrong. Please try again.',
      response.status,
      payload.error?.details,
    );
  }
  const returnedCsrfToken = (payload as { csrfToken?: string } | null)?.csrfToken;
  if (returnedCsrfToken) csrfToken = returnedCsrfToken;
  return payload;
}

export const authApi = {
  currentUser: () => request<{ user: AuthUser }>('me/'),
  login: (data: { email: string; password: string }) => request<AuthResponse>('login/', { method: 'POST', body: data }),
  register: (data: { email: string; full_name: string; password: string; password_confirm: string }) =>
    request<AuthResponse>('register/', { method: 'POST', body: data }),
  logout: () => request<{ message: string; csrfToken: string }>('logout/', { method: 'POST', body: {} }),
  updateProfile: (data: { full_name: string }) => request<{ user: AuthUser }>('profile/', { method: 'PATCH', body: data }),
  requestPasswordReset: (data: { email: string }) =>
    request<{ message: string }>('password-reset/', { method: 'POST', body: data }),
  confirmPasswordReset: (data: { uid: string; token: string; new_password: string; confirm_password: string }) =>
    request<{ message: string }>('password-reset/confirm/', { method: 'POST', body: data }),
};

export async function paymentRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  const init: RequestInit = { method, credentials: 'include', headers };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  if (method !== 'GET') headers['X-CSRFToken'] = await getCsrfToken();

  let response: Response;
  try {
    const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
    response = await fetch(`/api/v1/${normalizedPath}`, init);
  } catch {
    throw new ApiError('Could not connect to OnePay. Check your connection and try again.');
  }

  const payload = await decodeResponse<T & ApiErrorBody>(response);
  if (!response.ok) {
    throw new ApiError(
      payload.error?.message ?? 'Something went wrong. Please try again.',
      response.status,
      payload.error?.details,
    );
  }
  return payload;
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function apiFieldError(error: unknown, field: string): string | undefined {
  if (!(error instanceof ApiError) || !error.details || typeof error.details !== 'object') return undefined;
  const value = (error.details as Record<string, unknown>)[field];
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return typeof value === 'string' ? value : undefined;
}

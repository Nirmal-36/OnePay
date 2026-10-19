import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() });
afterEach(() => cleanup());

// Recharts' ResponsiveContainer observes its parent element. jsdom does not
// implement ResizeObserver, so provide a no-op measurement shim for tests.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!('ResizeObserver' in globalThis)) {
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: ResizeObserverStub });
}

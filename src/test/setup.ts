import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock window.scrollTo
Object.defineProperty(window, 'scrollTo', {
  writable: true,
  value: vi.fn(),
});

// Mock IntersectionObserver
// NOTE: must be a regular function, not an arrow function -- arrow functions
// can't be used as constructors, so `new IntersectionObserver()` would throw.
global.IntersectionObserver = vi.fn().mockImplementation(function (_callback) {
  return {
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
    root: null,
    rootMargin: '',
    thresholds: [],
  };
});

// Mock ResizeObserver (see note above: must be a regular function)
global.ResizeObserver = vi.fn().mockImplementation(function (_callback) {
  return {
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  };
});

// jsdom has no PointerEvent constructor at all (as of the jsdom version this
// project pins), and no Pointer Capture API on Element - both of which
// Radix UI's interactive primitives (DropdownMenu, Select, Tooltip, etc.)
// depend on to open/close. Without these, a plain fireEvent.pointerDown()
// in a test silently does nothing (Radix's own handlers just never run).
// This is the standard minimal shim for testing Radix components under
// jsdom - a real PointerEvent subclassing MouseEvent, plus no-op capture
// methods, is enough for Radix's own event handling to work normally.
if (!('PointerEvent' in window)) {
  class PointerEventPolyfill extends MouseEvent {
    pointerId?: number;
    pointerType?: string;
    isPrimary?: boolean;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId;
      this.pointerType = params.pointerType;
      this.isPrimary = params.isPrimary;
    }
  }

  Object.defineProperty(window, 'PointerEvent', { value: PointerEventPolyfill, writable: true });
  Object.defineProperty(global, 'PointerEvent', { value: PointerEventPolyfill, writable: true });
}

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};
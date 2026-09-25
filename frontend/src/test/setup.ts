import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
  // next-themes writes the theme class/localStorage outside React, so RTL's
  // cleanup() doesn't reset it — do so explicitly to keep tests isolated.
  document.documentElement.classList.remove('dark')
  localStorage.clear()
})

// jsdom doesn't implement ResizeObserver, which Radix's Popper (used by Tooltip,
// DropdownMenu, etc.) relies on for positioning.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver ??= ResizeObserverMock as unknown as typeof ResizeObserver

// jsdom doesn't implement window.matchMedia, which next-themes' ThemeProvider
// calls unconditionally to watch the OS color-scheme preference.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

// jsdom has no layout, so it doesn't implement element scrolling. The transcript's
// auto-follow (自動跟隨) calls scrollTo; tests assert on visible state, not scroll offsets.
Element.prototype.scrollTo ??= function scrollTo() {}

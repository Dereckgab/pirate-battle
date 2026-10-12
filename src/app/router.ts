import { useSyncExternalStore } from 'react'

export type Route = '/' | '/options' | '/play' | '/result' | '/log/ranking' | '/log/history' | '/network'

const ROUTES: readonly Route[] = [
  '/',
  '/options',
  '/play',
  '/result',
  '/log/ranking',
  '/log/history',
  '/network',
]

function parse(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/'
  return (ROUTES as readonly string[]).includes(path) ? (path as Route) : '/'
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

function getSnapshot(): Route {
  return parse(window.location.hash)
}

/**
 * Tiny hash router: works on any static host and survives refreshes without server rewrites.
 * A match in progress is not resumable, so loading the page on the combat route goes back to
 * the main menu (the abandoned match is simply discarded).
 */
export function initRouter(): void {
  if (parse(window.location.hash) === '/play') {
    window.history.replaceState(null, '', '#/')
  }
}

export function navigate(route: Route, options: { replace?: boolean } = {}): void {
  if (parse(window.location.hash) === route) return
  if (options.replace) {
    window.history.replaceState(null, '', `#${route}`)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else {
    window.location.hash = route
  }
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getSnapshot)
}

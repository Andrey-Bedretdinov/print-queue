import type { PqApi } from '../../electron/preload/index'
import { mockApi } from './mock'

declare global {
  interface Window {
    pq?: PqApi
  }
}

/** In Electron the preload bridge is always there; in a browser we fall back. */
export const api: PqApi = window.pq ?? mockApi

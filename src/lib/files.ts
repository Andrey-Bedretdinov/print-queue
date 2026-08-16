import type { DragEvent } from 'react'
import { api } from './api'

export function hasFiles(e: DragEvent) {
  return Array.from(e.dataTransfer.types).includes('Files')
}

/** Explorer drops: Electron 32+ requires webUtils to resolve a real path. */
export function pathsFrom(e: DragEvent) {
  return Array.from(e.dataTransfer.files)
    .map((file) => api.pathForFile(file))
    .filter(Boolean)
}

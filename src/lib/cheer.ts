/**
 * Крошечная шина «что-то произошло»: перенос, старт печати, добавленные файлы.
 * Нужна ровно для украшений розовой темы, поэтому и живёт отдельно — очередь
 * печати про сердечки знать не должна, а украшения про очередь.
 */
type Listener = () => void

const listeners = new Set<Listener>()

export function onCheer(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function cheer() {
  for (const listener of listeners) listener()
}

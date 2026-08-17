/**
 * Голосовые отбивки на начало печати.
 *
 * Файлы лежат рядом и собираются в бандл: десять коротких .ogg суммарно на
 * сорок килобайт, тянуть их с диска в рантайме незачем. Chromium играет ogg
 * сам, без кодеков и зависимостей.
 */
const files = import.meta.glob('../assets/sounds/*.ogg', { eager: true, query: '?url', import: 'default' })
const urls = Object.keys(files)
  .sort()
  .map((key) => files[key] as string)

/** Один и тот же звук подряд звучит как заедание — держим прошлый и обходим. */
let last = -1

export function playStartSound(volume = 0.85) {
  if (!urls.length) return
  let pick = Math.floor(Math.random() * urls.length)
  if (urls.length > 1 && pick === last) pick = (pick + 1) % urls.length
  last = pick

  try {
    const audio = new Audio(urls[pick])
    audio.volume = volume
    // Печать может стартовать пачкой; ошибку воспроизведения глотаем молча,
    // чтобы очередь не спотыкалась об звук.
    void audio.play().catch(() => {})
  } catch {
    /* звук — не повод падать */
  }
}

export const soundCount = urls.length

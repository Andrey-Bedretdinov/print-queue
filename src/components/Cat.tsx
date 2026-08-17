import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { onCheer } from '../lib/cheer'

/**
 * Украшение розовой темы: на каждое действие снизу выглядывает чёрная кошка и
 * вверх уплывают сердечки. Живёт поверх интерфейса и мышь не ловит, поэтому
 * ничего не заслоняет и ни на что не влияет.
 */

/** Кошка нарисована по фотографии: острые уши с кисточками, зелёные глаза. */
function CatFace() {
  return (
    <svg viewBox="0 0 140 96" width="140" height="96" aria-hidden>
      <defs>
        <radialGradient id="pq-eye" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#cdefe2" />
          <stop offset="70%" stopColor="#7fc9ad" />
          <stop offset="100%" stopColor="#4f9c82" />
        </radialGradient>
      </defs>

      {/* Кисточки на ушах — по ним кошка и узнаётся */}
      <path d="M31 30 26 8l12 17z" fill="#111" />
      <path d="M109 30 114 8l-12 17z" fill="#111" />

      {/* Голова с ушами: низ уходит за край окна */}
      <path
        d="M31 30 44 47c8-4 17-6 26-6s18 2 26 6l13-17c4 10 6 21 6 30 0 22-20 36-45 36S26 82 26 60c0-9 2-20 5-30z"
        fill="#141414"
      />

      {/* Глаза */}
      <g>
        <ellipse cx="52" cy="62" rx="12" ry="9" fill="url(#pq-eye)" />
        <ellipse cx="88" cy="62" rx="12" ry="9" fill="url(#pq-eye)" />
        <ellipse cx="52" cy="62" rx="3" ry="8" fill="#10201a" />
        <ellipse cx="88" cy="62" rx="3" ry="8" fill="#10201a" />
        <circle cx="48" cy="58" r="2" fill="#ffffff" opacity=".8" />
        <circle cx="84" cy="58" r="2" fill="#ffffff" opacity=".8" />
      </g>

      {/* Усы */}
      <g stroke="#f6dae6" strokeWidth="1.1" strokeLinecap="round" opacity=".55">
        <path d="M34 74h-14M34 79l-13 4M106 74h14M106 79l13 4" />
      </g>
    </svg>
  )
}

interface Heart {
  id: number
  /** Отступ справа: сердечки поднимаются от кошки, а не из пустого угла. */
  right: number
  delay: number
  size: number
  drift: number
}

let seq = 0

export function Cat({ active }: { active: boolean }) {
  const [visible, setVisible] = useState(false)
  const [hearts, setHearts] = useState<Heart[]>([])
  const hide = useRef<number | null>(null)

  useEffect(() => {
    if (!active) {
      setVisible(false)
      setHearts([])
      return
    }
    return onCheer(() => {
      setVisible(true)
      if (hide.current) window.clearTimeout(hide.current)
      hide.current = window.setTimeout(() => setVisible(false), 2600)

      const batch: Heart[] = Array.from({ length: 5 }, () => ({
        id: ++seq,
        right: 30 + Math.random() * 140,
        delay: Math.random() * 0.6,
        size: 11 + Math.random() * 11,
        drift: (Math.random() - 0.5) * 70,
      }))
      setHearts((prev) => [...prev.slice(-12), ...batch])
      window.setTimeout(() => {
        const ids = new Set(batch.map((h) => h.id))
        setHearts((prev) => prev.filter((h) => !ids.has(h.id)))
      }, 2600)
    })
  }, [active])

  if (!active) return null

  return (
    <div className="cat-layer">
      <AnimatePresence>
        {visible && (
          <motion.div
            className="cat"
            initial={{ y: 96, opacity: 0 }}
            animate={{ y: 18, opacity: 1 }}
            exit={{ y: 96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 220, damping: 22 }}
          >
            <CatFace />
          </motion.div>
        )}
      </AnimatePresence>

      {hearts.map((heart) => (
        <motion.span
          key={heart.id}
          className="heart"
          style={{ right: heart.right, width: heart.size, height: heart.size }}
          initial={{ y: 0, opacity: 0, scale: 0.6 }}
          animate={{ y: -160, x: heart.drift, opacity: [0, 1, 1, 0], scale: 1 }}
          transition={{ duration: 2.1, delay: heart.delay, ease: 'easeOut' }}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <path
              d="M12 21s-8-5.1-8-11a4.6 4.6 0 0 1 8-3.1A4.6 4.6 0 0 1 20 10c0 5.9-8 11-8 11z"
              fill="currentColor"
            />
          </svg>
        </motion.span>
      ))}
    </div>
  )
}

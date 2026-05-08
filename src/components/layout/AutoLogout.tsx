'use client'

import { useEffect, useRef, useState } from 'react'
import { signOut } from 'next-auth/react'

const TIMEOUT_MS = 60 * 60 * 1000  // 1 hour
const WARN_BEFORE_MS = 60 * 1000   // warn 60 seconds before logout

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']

export default function AutoLogout() {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warnRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function clearAll() {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (warnRef.current) clearTimeout(warnRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
  }

  function reset() {
    clearAll()
    setSecondsLeft(null)

    warnRef.current = setTimeout(() => {
      let secs = Math.round(WARN_BEFORE_MS / 1000)
      setSecondsLeft(secs)
      countdownRef.current = setInterval(() => {
        secs -= 1
        setSecondsLeft(secs)
        if (secs <= 0) {
          clearInterval(countdownRef.current!)
        }
      }, 1000)
    }, TIMEOUT_MS - WARN_BEFORE_MS)

    timerRef.current = setTimeout(() => {
      signOut({ callbackUrl: '/login' })
    }, TIMEOUT_MS)
  }

  useEffect(() => {
    reset()
    const handler = () => reset()
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, handler, { passive: true })
    }
    return () => {
      clearAll()
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, handler)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (secondsLeft === null) return null

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[300] bg-graphite-800 border border-accent-yellow/30 rounded-xl px-5 py-3 shadow-2xl flex items-center gap-4">
      <svg className="w-4 h-4 text-accent-yellow shrink-0" viewBox="0 0 24 24" fill="currentColor">
        <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
      </svg>
      <p className="text-white/80 text-sm">
        You'll be signed out in <span className="text-accent-yellow font-semibold">{secondsLeft}s</span> due to inactivity.
      </p>
      <button
        onClick={reset}
        className="text-xs text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition"
      >
        Stay signed in
      </button>
    </div>
  )
}

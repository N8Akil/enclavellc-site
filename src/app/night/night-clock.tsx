'use client'

import { useEffect, useState } from 'react'

// The headline is about after hours, so the opening slate reads the visitor's own clock. Rendered after mount only
// (the server does not know the visitor's time), and it holds the line's height so nothing shifts when it arrives.
export function NightClock() {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const t = window.setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  if (!now) return <p className="clock mono" aria-hidden="true">&nbsp;</p>
  const h = now.getHours(); const day = now.getDay()
  const closed = h >= 18 || h < 8 || day === 0 || day === 6
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return (
    <p className={closed ? 'clock mono late' : 'clock mono'}>
      <i aria-hidden="true"></i><b>{time}</b> where you are.{' '}
      {closed ? 'You are closed. Your website is still open.' : 'When you close tonight, your website stays open.'}
    </p>
  )
}

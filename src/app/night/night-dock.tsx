'use client'

import { useEffect, useState } from 'react'

// The audit stays one tap away for the length of the page: a slim bar that comes up once the opening shot (and its
// form) has scrolled off, and steps aside again when the forms at the end are on screen.
export function NightDock() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const hero = document.getElementById('audit-hero'); const end = document.getElementById('book')
    const slip = document.querySelector('.nc .slip')   // the coverage slate has its own button: don't sit on it
    if (!hero || !end || !('IntersectionObserver' in window)) return
    const seen = new Map<Element, boolean>()
    const io = new IntersectionObserver((es) => {
      es.forEach((e) => seen.set(e.target, e.isIntersecting))
      const pastHero = hero.getBoundingClientRect().bottom < 0
      setShow(pastHero && !seen.get(hero) && !seen.get(end) && !(slip && seen.get(slip)))
    }, { rootMargin: '0px 0px -80px 0px' })
    io.observe(hero); io.observe(end); if (slip) io.observe(slip)
    return () => io.disconnect()
  }, [])

  const toAudit = () => {
    const f = document.getElementById('audit')
    f?.scrollIntoView({ block: 'center' })
    f?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
  }
  const toBook = () => {
    window.dispatchEvent(new CustomEvent('nc:book', { detail: {} }))
    document.getElementById('book')?.scrollIntoView({ block: 'start' })
  }

  return (
    <div className={show ? 'dock show' : 'dock'} role="region" aria-label="Start here" inert={!show}>
      <p><b>Free site audit.</b><span> A plain-language report, in your inbox in a few minutes.</span></p>
      <button className="btn gold" type="button" onClick={toAudit}>Get the audit</button>
      <button className="link" type="button" onClick={toBook}>or book a call</button>
    </div>
  )
}

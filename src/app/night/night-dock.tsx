'use client'

import { useEffect, useState } from 'react'
import { hostOf, readTypedUrl } from './night-forms'
import { currentSlate } from './night-coverage'

// The audit stays one tap away for the length of the page: a slim bar that comes up once the opening shot and the
// report section (each with its own audit button) have scrolled off, and steps aside whenever the coverage slate or
// the forms at the end are on screen, so it never sits on another call to action.
export function NightDock() {
  const [show, setShow] = useState(false)
  const [host, setHost] = useState('')

  // a web address typed into the hero form but not sent yet: the dock offers to finish that audit
  useEffect(() => {
    setHost(hostOf(readTypedUrl()))
    const onUrl = (e: Event) => setHost(hostOf((e as CustomEvent<string>).detail || ''))
    window.addEventListener('nc:url', onUrl)
    return () => window.removeEventListener('nc:url', onUrl)
  }, [])

  useEffect(() => {
    const gate = document.getElementById('report') ?? document.getElementById('audit-hero')
    const end = document.getElementById('book')
    const slip = document.getElementById('make')   // the whole coverage section: its slate has its own button
    if (!gate || !end) return

    const onScreen = (el: Element | null) => {
      if (!el) return false
      const r = el.getBoundingClientRect()
      return r.top < innerHeight - 80 && r.bottom > 0
    }
    let frame = 0
    const read = () => {
      frame = 0
      setShow(gate.getBoundingClientRect().bottom < innerHeight * 0.4 && !onScreen(end) && !onScreen(slip))
    }
    const queue = () => { if (!frame) frame = requestAnimationFrame(read) }
    read()
    window.addEventListener('scroll', queue, { passive: true })
    window.addEventListener('resize', queue)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', queue)
      window.removeEventListener('resize', queue)
    }
  }, [])

  const toAudit = () => {
    const f = document.getElementById('audit')
    f?.scrollIntoView({ block: 'center' })
    // with the address already carried over, land on the next REQUIRED field that is still empty (the email)
    const fields = [...(f?.querySelectorAll<HTMLInputElement>('input') ?? [])]
    ;(fields.find((i) => i.required && !i.value) ?? fields[0])?.focus({ preventScroll: true })
  }
  const toBook = () => {
    window.dispatchEvent(new CustomEvent('nc:book', { detail: currentSlate() ?? {} }))
    document.getElementById('book')?.scrollIntoView({ block: 'start' })
  }

  return (
    <div className={show ? 'dock show' : 'dock'} role="region" aria-label="Start here" inert={!show}>
      {host
        ? <p><b>{host}</b><span> has a free audit waiting. Add your email.</span></p>
        : <p><b>Free site audit.</b><span> A plain-language report, sent to your inbox.</span></p>}
      <button className="btn gold" type="button" onClick={toAudit}>{host ? 'Finish the audit' : 'Get the audit'}</button>
      <button className="link" type="button" onClick={toBook}>or request a call</button>
    </div>
  )
}

// The last credit: "And introducing" names the visitor's own site once they have typed its address.
export function NightIntroducing() {
  const [host, setHost] = useState('')
  useEffect(() => {
    setHost(hostOf(readTypedUrl()))
    const onUrl = (e: Event) => setHost(hostOf((e as CustomEvent<string>).detail || ''))
    window.addEventListener('nc:url', onUrl)
    return () => window.removeEventListener('nc:url', onUrl)
  }, [])
  return <span className="v intro">{host || 'Your business'}</span>
}

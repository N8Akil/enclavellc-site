'use client'

import { useState } from 'react'

// "What we make" as a slate the visitor fills in: tap the pieces you want, see who comes onto the job, and the
// Book-a-call form opens with that list as a first draft of the message. Nothing is sent from here.
type Service = 'Website Rebuild' | 'Automation Setup' | 'Content + Cleanup' | 'Not sure yet'
type Piece = { id: string; h: string; p: string; who: string[]; soon?: string; service?: Service }

const WHOLE = ['Isis', 'Thoth', 'Ra', 'Horus', 'Amun']
const pieces: Piece[] = [
  { id: 'site', h: 'Website rebuild', p: 'Fast, mobile-first and easy to find, built to turn visitors into calls.', who: ['Isis', 'Thoth'], service: 'Website Rebuild' },
  { id: 'apps', h: 'iPhone apps', p: 'Native apps built in Swift: fast, accessible, and connected to your site and the tools you already use.', who: ['Isis', 'Thoth'], soon: 'Android · coming soon' },
  { id: 'auto', h: 'Automation', p: 'Forms, notifications, scheduling and follow-up that run without you.', who: ['Thoth', 'Ra'], service: 'Automation Setup' },
  { id: 'content', h: 'Content and video', p: 'Posts, graphics, newsletters and training videos in your voice.', who: ['Horus'], service: 'Content + Cleanup' },
  { id: 'social', h: 'Social media', p: 'A steady schedule across your platforms, with replies and simple reporting.', who: ['Horus'] },
  { id: 'all', h: 'Full overhaul', p: 'All of it together, planned end to end, with priority support after launch.', who: WHOLE },
]

// what is on the slate right now, for the other "book a call" entries (the dock, the header button)
let slate: { message: string; service: Service } | null = null
export const currentSlate = () => slate

const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

export function NightCoverage() {
  const [on, setOn] = useState<string[]>([])

  // the full overhaul is everything, so it stands alone on the slate
  const toggle = (id: string) => setOn((cur) => {
    if (cur.includes(id)) return cur.filter((x) => x !== id)
    if (id === 'all') return ['all']
    return [...cur.filter((x) => x !== 'all'), id]
  })

  const picked = pieces.filter((p) => on.includes(p.id))
  const crew = WHOLE.filter((n) => picked.some((p) => p.who.includes(n)))
  const names = picked.map((p) => p.h)

  const services = picked.map((p) => p.service).filter(Boolean) as Service[]
  slate = picked.length
    ? { message: `I would like to talk about: ${list(names)}.`, service: picked.length === 1 && services.length === 1 ? services[0] : 'Not sure yet' }
    : null

  const book = () => {
    window.dispatchEvent(new CustomEvent('nc:book', { detail: slate ?? {} }))
    document.getElementById('book')?.scrollIntoView({ block: 'start' })
  }

  return (
    <>
      <div className="coverage rv">
        <article className="cov first"><span className="mono">Start here · free</span><h3>Site audit</h3><p>Send your web address and get a plain-language report on what is working and what is costing you customers.</p><a href="#audit">Send your web address</a><span className="who mono">Osiris + Isis</span></article>
        {pieces.map((p) => {
          const sel = on.includes(p.id)
          return (
            <article className={sel ? 'cov pick on' : 'cov pick'} key={p.id}>
              <h3><button type="button" aria-pressed={sel} onClick={() => toggle(p.id)}>{p.h}</button></h3>
              <p>{p.p}</p>
              {p.soon && <span className="soon mono">{p.soon}</span>}
              <span className="who mono">{p.id === 'all' ? 'The whole crew' : p.who.join(' + ')}</span>
              <span className="tick mono" aria-hidden="true"><i></i>{sel ? 'On your slate' : 'Add to your slate'}</span>
            </article>
          )
        })}
      </div>
      <div className={picked.length ? 'slip on' : 'slip'}>
        <div role="status">
          {picked.length === 0
            ? <p className="slip-main">Tap the pieces you want. Your slate fills in here.</p>
            : <>
                <p className="slip-main"><span className="mono">Your production</span>{list(names)}</p>
                <p className="slip-crew"><span className="mono">On the job</span>{list(crew)}. Osiris checks it, Nate approves it.</p>
              </>}
        </div>
        <button className="btn gold" type="button" onClick={book} disabled={picked.length === 0}>Book a call about this</button>
      </div>
    </>
  )
}

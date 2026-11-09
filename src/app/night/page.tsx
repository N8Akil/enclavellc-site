/* eslint-disable @next/next/no-img-element -- the cut-outs and the mask need their own transparent WebP, unoptimised */
import type { CSSProperties } from 'react'
import type { Metadata } from 'next'
import { preload } from 'react-dom'
import { IBM_Plex_Mono, Instrument_Sans } from 'next/font/google'
import localFont from 'next/font/local'
import { crew, crewSrc, mobileCardFrame, pad } from './crew'
import { NightCrewMotion } from './night-crew-motion'
import { NightAuditForm, NightBook } from './night-forms'
import './night.css'

// Preview of the new home page (concept D · Night Crew). Not linked from anywhere and kept out of search.
export const metadata: Metadata = {
  title: 'Night Crew preview',
  description: 'Your website, your follow-up and your content keep working after you close. One founder, six AI partners, one studio.',
  robots: { index: false, follow: false },
}

// The concept's "Big Shoulders Display" (Google's legacy wght-only variable cut, latin subset), self-hosted: next/font/google
// only offers its successor "Big Shoulders", whose bold runs ~6% wider and re-wraps the headings.
const display = localFont({ src: './fonts/big-shoulders-display-latin.woff2', weight: '100 900', variable: '--nc-font-display', display: 'swap', fallback: ['Impact', 'Arial Narrow', 'sans-serif'] })
const body = Instrument_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--nc-font-body', display: 'swap' })
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--nc-font-mono', display: 'swap' })

// a saved day/night pick is applied to the .nc root before first paint, as the concept does in <head>
const themeScript = "try{var t=localStorage.getItem('enclave-theme');if(t==='light'||t==='dark')document.currentScript.parentElement.dataset.theme=t}catch(e){}"

const css = (o: Record<string, string | number>) => o as CSSProperties

// the crew on risers, back to front; left/height place each cut-out on the stage, fx is its tape mark, tag nudges a label
const risers = [
  { who: 'amun', back: true, left: '18.9%', height: '72%', w: 658, h: 1152, alt: 'Amun, in a grey suit', fx: '52%', tag: '57%', dept: 'production' },
  { who: 'ra', back: true, left: '59.3%', height: '72%', w: 786, h: 1181, alt: 'Ra, in an olive blazer', fx: '43%', dept: 'operations' },
  { who: 'thoth', left: '3%', height: '82%', w: 1221, h: 1099, alt: 'Thoth, seated, in a navy blazer', fx: '50.6%', tag: '27%', dept: 'engineering' },
  { who: 'horus', left: '73.3%', height: '82%', w: 734, h: 1166, alt: 'Horus, in a black blazer', fx: '44%', dept: 'content' },
  { who: 'isis', left: '26.6%', height: '90%', w: 750, h: 1150, alt: 'Isis, in a plum blazer', fx: '51.4%', dept: 'design', priority: true },
  { who: 'osiris', left: '41%', height: '90%', w: 902, h: 1174, alt: 'Osiris, in a charcoal suit, holding printed pages', fx: '51.2%', dept: 'review', priority: true },
]

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

function SecSlate({ scene, loc }: { scene: string; loc: string }) {
  return (
    <p className="secslate mono" aria-hidden="true"><span className="clap"></span><span>Scene <b>{scene}</b></span><span className="take">Take <b>1</b></span><span>TC <b className="tc">00:00:00:00</b></span><span className="loc">{loc}</span></p>
  )
}

export default function NightPage() {
  // the front row is the opening frame: fetch it first
  risers.filter((r) => r.priority).forEach((r) => preload(crewSrc(r.who), { as: 'image', fetchPriority: 'high', type: 'image/webp' }))

  return (
    <div id="nc" className={`nc ${display.variable} ${body.variable} ${mono.variable}`} suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
        {/* stamp ink: a fine displacement roughens the edge, a coarse noise mask thins the ink in patches */}
        <filter id="nc-ink" x="-8%" y="-15%" width="116%" height="130%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves={2} seed={4} result="fine" />
          <feDisplacementMap in="SourceGraphic" in2="fine" scale={1.8} xChannelSelector="R" yChannelSelector="G" result="rough" />
          <feTurbulence type="fractalNoise" baseFrequency=".09 .16" numOctaves={3} seed={11} result="patch" />
          <feColorMatrix in="patch" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -2.6 0 0 0 2.25" result="density" />
          <feComposite in="rough" in2="density" operator="in" />
        </filter>
      </svg>
      <span className="grain" aria-hidden="true"></span>
      <header className="top">
        <div className="wrap">
          <a className="brand" href="#top" aria-label="Enclave, home"><span className="mark" aria-hidden="true"></span><span>Enclave</span></a>
          <nav className="nav" aria-label="Main"><a href="#crew">The crew</a><a href="#sheet">Call sheet</a><a href="#make">What we make</a><a href="#work">Now showing</a></nav>
          <div className="tools">
            <span className="rec mono" id="rec" aria-hidden="true"><i></i><span id="recTxt">Rolling</span></span>
            <button className="theme" id="theme" type="button" aria-label="Switch to the day set"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" /></svg><span id="themeLabel">Day</span></button>
            <a className="btn gold" href="#book">Book<span className="long">{' '}a call</span></a>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="open" aria-labelledby="h1">
          <div className="wrap">
            <div className="open-head">
              <div>
                <p className="slate mono" aria-hidden="true"><span>Scene <b>01</b></span><span>Take <b>1</b></span><span>TC <b className="tc" id="tc">00:00:00:00</b></span></p>
                <h1 className="h1" id="h1">The crew works the <span>night shift.</span></h1>
              </div>
              <div>
                <p className="sub">Your website, your follow-up and your content keep working after you close. One founder, six AI partners, one studio.</p>
                <div className="row"><a className="btn gold" href="#audit">Get a free site audit</a><a className="btn" href="#crew">Meet the crew</a></div>
              </div>
            </div>
          </div>
          <div className="matte lead" aria-hidden="true"></div>
          <div className="wrap">
            <div className="set" role="group" aria-label="The Enclave crew on set">
              <canvas id="light" aria-hidden="true"></canvas>
              <div className="stage" id="stage">
                {risers.map((r, d) => (
                  <div className="band" data-depth={d} style={css({ '--d': d })} key={r.who}>
                    <figure className={r.back ? 'fig back' : 'fig'} data-who={r.who} style={css({ left: r.left, height: r.height, aspectRatio: `${r.w}/${r.h}` })}>
                      <img src={crewSrc(r.who)} width={r.w} height={r.h} alt={r.alt} fetchPriority={r.priority ? 'high' : undefined} />
                    </figure>
                  </div>
                ))}
                {risers.map((r, d) => (
                  <div className="band taglayer" data-depth={d} style={css({ '--d': d })} aria-hidden="true" key={`${r.who}-tag`}>
                    <figure className={r.back ? 'fig back' : 'fig'} data-who={r.who} style={css({ left: r.left, height: r.height, aspectRatio: `${r.w}/${r.h}`, '--fx': r.fx })}>
                      <span className="tape"></span>
                      <figcaption className="tag" style={r.tag ? { left: r.tag } : undefined}><span><b>{cap(r.who)}</b><em>{` · ${r.dept}`}</em></span><i></i></figcaption>
                    </figure>
                  </div>
                ))}
              </div>
              <span className="floor" aria-hidden="true"></span>
            </div>
            <p className="marks mono" aria-hidden="true"><span className="wide">Stage A · the crew on their marks</span><span className="castline">L to R · <b>Thoth</b> · <b>Amun</b> · <b>Isis</b> · <b>Osiris</b> · <b>Ra</b> · <b>Horus</b></span><span className="wide" id="onCam">On camera · the whole crew</span></p>
          </div>
          <div className="matte" aria-hidden="true" style={{ marginTop: 20 }}></div>
          <div className="wrap">
            <div className="signoff rv" role="group" aria-label="How every project is signed off">
              <div><span className="k mono">Production</span><p className="v">Your business, online and working<small>Every job carries these three names before it ships.</small></p></div>
              <div><span className="k mono">Drawn by</span><p className="v">Isis<small>Design and build</small></p></div>
              <div><span className="k mono">Checked by</span><p className="v">Osiris<small>Quality review</small></p></div>
              <div><span className="k mono">Approved by</span><p className="v"><span className="stamp">Nate</span><small>Founder · you talk to him directly</small></p></div>
            </div>
          </div>
        </section>

        <section className="sec" id="crew" aria-labelledby="crew-h">
          <div className="wrap"><div className="head rv"><SecSlate scene="02" loc="Stage A" /><h2 className="h2" id="crew-h">Each partner owns one craft.</h2><p>Scroll and each one steps into the light, starting with the director. The monitor shows the kind of work they do for you; it is an illustration, not live data.</p></div></div>
          <div className="crew-track" id="crewTrack" style={css({ '--n': crew.length })}>
            <div className="crew-pin wrap" id="crewPin">
              <nav className="names" aria-label="Scenes">
                <ol id="names">
                  {crew.map((c, i) => <li key={c.id}><button type="button" data-i={i} aria-current="false"><small>{`Sc.${pad(i)}`}</small>{c.name}</button></li>)}
                </ol>
              </nav>
              <div className="spot" id="spot" aria-hidden="true">
                <span className="cone" id="cone"></span><span className="mark mono">✕ mark</span>
                {crew.map((c, i) => <figure data-i={i} data-id={c.id} key={c.id}><img src={crewSrc(c.id)} width={c.w} height={c.h} alt="" loading="lazy" /></figure>)}
              </div>
              <div className="brief" id="brief"></div>
              <p className="vh" id="onAir" aria-live="polite"></p>
              <div className="crew-mobile" id="crewMobile">
                {crew.map((c) => {
                  const m = mobileCardFrame(c)
                  return (
                    <article className={c.dir ? 'mcard dir' : 'mcard'} key={c.id}>
                      <div className="pool" style={css({ '--hx': m.hx })}><img src={crewSrc(c.id)} width={c.w} height={c.h} alt={c.name} loading="lazy" style={{ objectPosition: m.objectPosition }} /></div>
                      <div><span className="mono role">{c.role}</span><span className="mono call">Call: {c.call}</span><h3>{c.name}</h3><p>{c.line}</p></div>
                    </article>
                  )
                })}
              </div>
            </div>
          </div>
          <div className="wrap"><p className="joining mono">Also on the call sheet: Naunet and Amaunet. Their portraits are still being shot.</p></div>
        </section>

        <section className="sec flush" id="sheet" aria-labelledby="sheet-h">
          <div className="wrap">
            <div className="head rv"><SecSlate scene="03" loc="Production office" /><h2 className="h2" id="sheet-h">The call sheet</h2><p>On a film set, the call sheet tells everyone who is working, what they handle and when to show up. Here is ours.</p></div>
            <div className="table-box rv" tabIndex={0} role="region" aria-label="Call sheet table, scrolls sideways">
              <table>
                <thead><tr><th scope="col">Crew</th><th scope="col">Department</th><th scope="col">Call time</th><th scope="col">Handles</th></tr></thead>
                <tbody>
                  <tr className="founder-row"><td>Nate</td><td>Director</td><td><span className="call">Your hours</span></td><td>Every call with you, every decision, final approval. You always talk to a person.</td></tr>
                  <tr><td>Isis</td><td>Art department</td><td><span className="call">After hours too</span></td><td>Design and build: sites, native iPhone apps, brand, and pages that turn visitors into calls.</td></tr>
                  <tr><td>Thoth</td><td>Engineering</td><td><span className="call">After hours too</span></td><td>Forms, bookings, follow-up and the connections between your tools.</td></tr>
                  <tr><td>Ra</td><td>Operations</td><td><span className="call">After hours too</span></td><td>Hosting, security, backups and keeping everything online.</td></tr>
                  <tr><td>Horus</td><td>Publicity</td><td><span className="call">On schedule</span></td><td>Posts, short videos, newsletters and replies in your voice.</td></tr>
                  <tr><td>Osiris</td><td>Continuity</td><td><span className="call">Before every release</span></td><td>Checks every page, link and word before your customers see it.</td></tr>
                  <tr><td>Amun</td><td>Production</td><td><span className="call">At kickoff</span></td><td>The plan, the milestones and one price agreed up front.</td></tr>
                  <tr className="pending"><td>Naunet</td><td><span className="stamp sm">Coming soon</span></td><td><span className="call">Soon</span></td><td></td></tr>
                  <tr className="pending"><td>Amaunet</td><td><span className="stamp sm">Coming soon</span></td><td><span className="call">Soon</span></td><td></td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="sec flush" id="make" aria-labelledby="make-h">
          <div className="wrap">
            <div className="head rv"><SecSlate scene="04" loc="Coverage" /><h2 className="h2" id="make-h">What we make</h2><p>Start with the free audit. Take one piece or the whole production.</p></div>
            <div className="coverage rv">
              <article className="cov first"><span className="mono">Start here · free</span><h3>Site audit</h3><p>Send your web address and get a plain-language report on what is working and what is costing you customers.</p><a href="#audit">Send your web address</a><span className="who mono">Osiris + Isis</span></article>
              <article className="cov"><h3>Website rebuild</h3><p>Fast, mobile-first and easy to find, built to turn visitors into calls.</p><span className="who mono">Isis + Thoth</span></article>
              <article className="cov"><h3>iPhone apps</h3><p>Native apps built in Swift: fast, accessible, and connected to your site and the tools you already use.</p><span className="soon mono">Android · coming soon</span><span className="who mono">Isis + Thoth</span></article>
              <article className="cov"><h3>Automation</h3><p>Forms, notifications, scheduling and follow-up that run without you.</p><span className="who mono">Thoth + Ra</span></article>
              <article className="cov"><h3>Content and video</h3><p>Posts, graphics, newsletters and training videos in your voice.</p><span className="who mono">Horus</span></article>
              <article className="cov"><h3>Social media</h3><p>A steady schedule across your platforms, with replies and simple reporting.</p><span className="who mono">Horus</span></article>
              <article className="cov"><h3>Full overhaul</h3><p>All of it together, planned end to end, with priority support after launch.</p><span className="who mono">The whole crew</span></article>
            </div>
          </div>
        </section>

        <section className="sec flush" id="schedule" aria-labelledby="how-h">
          <div className="wrap">
            <div className="head rv"><SecSlate scene="05" loc="Production board" /><h2 className="h2" id="how-h">The shooting schedule</h2><p>Five scenes on the board, and the founder is on set for every one.</p></div>
            <ol className="steps rv">
              <li><h3>Free audit</h3><p>We review your site and send the report.</p></li>
              <li><h3>Call with the founder</h3><p>We talk through your business and goals.</p></li>
              <li><h3>Plan and quote</h3><p>Amun maps the work. You get one clear price.</p></li>
              <li><h3>Build</h3><p>The crew builds. Osiris checks everything before you see it.</p></li>
              <li><h3>Launch and care</h3><p>Ra keeps it running. We stay on call.</p></li>
            </ol>
          </div>
        </section>

        <section className="sec flush" id="work" aria-labelledby="work-h">
          <div className="wrap">
            <div className="head rv"><SecSlate scene="06" loc="Screening room" /><h2 className="h2" id="work-h">Now showing</h2><p>Every project is shown with the client&apos;s written permission.</p></div>
            <div className="work rv">
              <div className="slot big"><span className="mono">Our build · Enclave Landscape Management</span><strong>ELM</strong><span className="stamp">Coming soon</span></div>
              <div className="slot"><span className="mono">Our build · quality control</span><strong>EnclaveQC</strong><span className="stamp sm">Coming soon</span></div>
              <div className="slot"><span className="mono">Our build · the platform</span><strong>iEnclave</strong><span className="stamp sm">Coming soon</span></div>
            </div>
            <div className="ventures rv" role="group" aria-label="What the crew is building next">
              <div className="venture"><span className="dot build mono">In production</span><h3>Enclave Landscape Management</h3><span className="stamp sm">Under construction</span></div>
              <div className="venture"><span className="dot build mono">In production · target Jan 2027</span><h3>EnclaveQC</h3><span className="stamp sm">Under construction</span></div>
              <div className="venture"><span className="dot mono">Up next</span><h3>Thyck.net</h3><span className="stamp sm">Coming soon</span></div>
            </div>
          </div>
        </section>

        <section className="credits" id="credits" aria-labelledby="end-h">
          <div className="wrap"><SecSlate scene="07" loc="End credits" /></div>
          <div className="roll-track" id="rollTrack">
            <div className="roll-frame" id="rollFrame">
              <div className="wrap roll" id="roll">
                <div className="grp"><span className="k mono">Directed by</span><span className="v">Nate Garrett</span></div>
                <div className="grp"><span className="k mono">Starring</span>
                  <div className="cast"><span>Design and build</span><span>Isis</span><span>Engineering</span><span>Thoth</span><span>Operations</span><span>Ra</span><span>Content and social</span><span>Horus</span><span>Quality review</span><span>Osiris</span><span>Production</span><span>Amun</span><span>Coming soon</span><span>Naunet</span><span>Coming soon</span><span>Amaunet</span></div>
                </div>
                <div className="grp"><span className="k mono">And introducing</span><span className="v" style={{ color: 'var(--gold-ink)' }}>Your business</span></div>
              </div>
            </div>
          </div>
          <div className="wrap end" id="book" tabIndex={-1}>
            <div className="end-copy">
              <h2 id="end-h">Your scene is next.</h2>
              <p>Book a call with Nate, or start with the free audit. You will hear back from a person.</p>
              <NightBook />
            </div>
            <NightAuditForm />
          </div>
        </section>
      </main>
      <footer><div className="wrap"><span>© Enclave LLC</span><span>Investor questions: [investor email]</span></div></footer>

      <NightCrewMotion />
    </div>
  )
}

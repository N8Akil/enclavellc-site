'use client'

import { useEffect } from 'react'
import { crew, pad } from './crew'

// The motion for /night, ported from the concept's inline script. It attaches to the server-rendered markup
// inside the .nc root and renders nothing itself. Every listener, observer, frame loop, interval and timeout it
// starts is registered in `off` and torn down on unmount, so a route change leaves nothing running.
export function NightCrewMotion() {
  useEffect(() => {
    const root = document.getElementById('nc')
    if (!root) return
    const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
    const off: Array<() => void> = []
    let dead = false
    const on = (t: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn, opts)
      off.push(() => t.removeEventListener(type, fn, opts))
    }

    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const fine = matchMedia('(pointer: fine)').matches
    const desk = matchMedia('(min-width: 981px)')
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
    root.classList.toggle('js', !reduce)
    off.push(() => root.classList.remove('js'))

    // everything that moves stops while the tab is hidden; each waker restarts what should be running
    let pageOn = !document.hidden
    const wakers: Array<() => void> = []
    on(document, 'visibilitychange', () => { pageOn = !document.hidden; wakers.forEach((w) => w()) })
    // a frame loop that ends when its step returns false, and can be woken again
    const loop = (step: (t: number) => boolean | void) => {
      let id = 0
      const f = (t: number) => { id = 0; if (step(t) !== false) id = requestAnimationFrame(f) }
      off.push(() => { if (id) cancelAnimationFrame(id); id = 0 })
      return () => { if (!dead && !id) id = requestAnimationFrame(f) }
    }
    const watch = (els: Element[], cb: (e: IntersectionObserverEntry) => void, opts?: IntersectionObserverInit) => {
      const io = new IntersectionObserver((es) => es.forEach(cb), opts)
      els.forEach((el) => io.observe(el))
      off.push(() => io.disconnect())
    }

    // theme: day set / night set; follows the system until the viewer picks (a saved pick is applied before paint)
    const btn = $('theme'), lbl = $('themeLabel')
    const sys = matchMedia('(prefers-color-scheme: dark)')
    const isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : sys.matches
    let tok = { a: '', b: '', blades: '' }
    const readTok = () => { const cs = getComputedStyle(root); tok = { a: cs.getPropertyValue('--sweep-a').trim(), b: cs.getPropertyValue('--sweep-b').trim(), blades: cs.getPropertyValue('--blades').trim() } }
    const sync = () => { const d = isDark(); lbl.textContent = d ? 'Day' : 'Night'; btn.setAttribute('aria-label', d ? 'Switch to the day set' : 'Switch to the night set'); readTok() }
    on(btn, 'click', () => { const next = isDark() ? 'light' : 'dark'; root.dataset.theme = next; try { localStorage.setItem('enclave-theme', next) } catch {} sync() })
    on(sys, 'change', sync); sync()

    // the house lights: a visitor on the day set, who has not picked a set, sees the lights go down as the crew scene
    // arrives and come back up above it. A saved or fresh pick, a system set to dark, or reduced motion switches this off.
    let picked = false
    try { picked = !!localStorage.getItem('enclave-theme') } catch {}
    on(btn, 'click', () => { picked = true })
    const crewScene = $('crew')
    if (crewScene && !reduce) {
      let lightsFrame = 0
      const lights = () => {
        lightsFrame = 0
        if (picked || sys.matches) return
        const want = crewScene.getBoundingClientRect().top < innerHeight * 0.5 ? 'dark' : 'light'
        if ((root.dataset.theme || 'light') !== want) { root.dataset.theme = want; sync() }
      }
      on(window, 'scroll', () => { if (!lightsFrame) lightsFrame = requestAnimationFrame(lights) }, { passive: true })
      off.push(() => { if (lightsFrame) cancelAnimationFrame(lightsFrame) })
      lights()
    }

    // film grain, drawn once
    const g = document.createElement('canvas'); g.width = g.height = 160
    const gx = g.getContext('2d')
    if (gx) {
      const img = gx.createImageData(160, 160)
      for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255 }
      gx.putImageData(img, 0, 0); root.style.setProperty('--grain', `url(${g.toDataURL()})`)
      off.push(() => root.style.removeProperty('--grain'))
    }

    // timecode: one shared clock at 24fps, written only into the slates on screen
    const tcOn = new Set<Element>(), t0 = performance.now(); let tcTimer = 0
    const tcRun = () => {
      const go = !reduce && pageOn && tcOn.size > 0 && !dead
      if (go && !tcTimer) tcTimer = window.setInterval(() => { const s = (performance.now() - t0) / 1000; const t = `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(Math.floor(s) % 60)}:${pad(Math.floor((s % 1) * 24))}`; tcOn.forEach((el) => { el.textContent = t }) }, 1000 / 24)
      else if (!go && tcTimer) { clearInterval(tcTimer); tcTimer = 0 }
    }
    off.push(() => { clearInterval(tcTimer); tcTimer = 0 })
    watch([...root.querySelectorAll('.tc')], (e) => { if (e.isIntersecting) tcOn.add(e.target); else tcOn.delete(e.target); tcRun() })
    wakers.push(tcRun)

    // the key light: a warm pool that sweeps across the crew; colours come from the theme tokens, cached per theme
    let heroOn = true
    const cv = $<HTMLCanvasElement>('light'), cx = cv.getContext('2d')
    const size = () => { const k = Math.min(devicePixelRatio, 1.5); cv.width = cv.offsetWidth * k; cv.height = cv.offsetHeight * k }
    size(); on(window, 'resize', size)
    const sweep = loop((t) => {
      if (!heroOn || !pageOn || !cx) return false
      const w = cv.width, h = cv.height; cx.clearRect(0, 0, w, h)
      const x = (Math.sin(t / 5200) * 0.33 + 0.5) * w, y = h * 0.32
      const gr = cx.createRadialGradient(x, y, 0, x, y, w * 0.5)
      gr.addColorStop(0, tok.a); gr.addColorStop(0.5, tok.b); gr.addColorStop(1, 'rgba(0,0,0,0)')
      cx.fillStyle = gr; cx.fillRect(0, 0, w, h)
      cx.save(); cx.translate(x - w * 0.22, 0); cx.rotate(-0.35); cx.fillStyle = tok.blades
      for (let i = 0; i < 4; i++) cx.fillRect(i * w * 0.07, -h, w * 0.035, h * 3)
      cx.restore()
    })

    // the crew on risers: every partner on their own layer with their own spring (back heavy and slow, front light and quick)
    // and an idle sway on their own rhythm, so nobody moves as a pair; the set tilts a few degrees toward the pointer.
    // The idle sway keeps it running while the hero is on screen; off screen or in a hidden tab it stops at once (the heavy back
    // springs would take ~4s to settle, unseen) and sleeps until the hero, the pointer or a scroll wakes it.
    const stage = $('stage'), N = 6
    const bands = Array.from({ length: N }, (_, d) => [...stage.querySelectorAll<HTMLElement>(`.band[data-depth="${d}"]`)])
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t
    const cfg = bands.map((_, d) => { const t = d / (N - 1); return { k: lerp(30, 115, t), d: lerp(28, 15, t), m: lerp(1.5, 0.42, t), x: lerp(6, 42, t), y: lerp(4, 25, t), lift: lerp(18, 104, t), ph: d * 1.9, per: [4300, 3700, 4100, 3300, 3900, 3500][d], sw: lerp(1.2, 2.2, t) } })
    const st = cfg.map(() => ({ x: 0, y: 0, vx: 0, vy: 0 }))
    let tx = 0, ty = 0, drift = 0, last = performance.now()
    const spring = loop((now) => {
      if (!pageOn || !heroOn) return false
      const dt = Math.min(0.032, (now - last) / 1000); last = now
      cfg.forEach((c, i) => {
        const s = st[i], goal = { x: tx * c.x + Math.sin(now / c.per + c.ph) * c.sw, y: ty * c.y + Math.cos(now / (c.per * 1.3) + c.ph) * c.sw * 0.6 }
        const fx = -c.k * (s.x - goal.x) - c.d * s.vx; s.vx += (fx / c.m) * dt; s.x += s.vx * dt
        const fy = -c.k * (s.y - goal.y) - c.d * s.vy; s.vy += (fy / c.m) * dt; s.y += s.vy * dt
        const t = `translate3d(${s.x.toFixed(2)}px, ${(s.y - c.lift * drift).toFixed(2)}px, 0)`; bands[i].forEach((b) => { b.style.transform = t })
      })
      const f = st[N - 1], fc = cfg[N - 1]
      stage.style.transform = `rotateY(${(f.x / fc.x * 4).toFixed(2)}deg) rotateX(${(-f.y / fc.y * 3).toFixed(2)}deg) scale(${(1 - 0.05 * drift).toFixed(3)})`
    })
    if (!reduce && fine) on(window, 'pointermove', ((e: PointerEvent) => { const r = stage.getBoundingClientRect(); tx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2)); ty = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2)); if (heroOn) spring() }) as EventListener, { passive: true })
    // drift is always measured (a jump back to the top fires its scroll before the hero is seen again); only the loop waits for the hero
    const measureDrift = () => { const r = stage.getBoundingClientRect(); drift = clamp01(-r.top / r.height) }
    if (!reduce) on(window, 'scroll', () => { measureDrift(); if (heroOn) spring() }, { passive: true })
    const heroWake = () => { if (!reduce && heroOn && pageOn) { measureDrift(); sweep(); spring() } }
    watch([root.querySelector('.open')!], (e) => { heroOn = e.isIntersecting; heroWake() })
    wakers.push(heroWake)

    // hover: whoever is under the pointer lights up, judged by the cutout's own pixels (front to back), never by its box
    const figs = [...stage.querySelectorAll<HTMLElement>('.band:not(.taglayer) .fig')]
    const ghost = (f: HTMLElement) => stage.querySelector(`.taglayer .fig[data-who="${f.dataset.who}"]`)!
    const onCam = $('onCam')
    const alpha = new Map<HTMLElement, { w: number; h: number; d: Uint8ClampedArray } | null>()
    figs.forEach((f) => {
      const img = f.querySelector('img')!
      const build = () => { try { const w = 160, h = Math.max(1, Math.round(w * img.naturalHeight / img.naturalWidth)); const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(img, 0, 0, w, h); alpha.set(f, { w, h, d: x.getImageData(0, 0, w, h).data }) } catch { alpha.set(f, null) } }
      if (img.complete && img.naturalWidth) build(); else on(img, 'load', build, { once: true })
    })
    const hit = (e: PointerEvent) => {
      for (let i = figs.length - 1; i >= 0; i--) {
        const f = figs[i], r = f.querySelector('img')!.getBoundingClientRect()
        if (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom) continue
        const a = alpha.get(f); if (!a) continue
        const px = Math.floor((e.clientX - r.left) / r.width * a.w), py = Math.floor((e.clientY - r.top) / r.height * a.h)
        if (a.d[(py * a.w + px) * 4 + 3] > 60) return f
      }
      return null
    }
    let lit: HTMLElement | null = null
    const setLit = (f: HTMLElement | null) => {
      if (f === lit) return
      if (lit) { lit.classList.remove('lit'); ghost(lit).classList.remove('lit') }
      lit = f
      if (f) { f.classList.add('lit'); ghost(f).classList.add('lit') }
      stage.classList.toggle('hovering', !!f)
      const who = f && f.dataset.who
      onCam.textContent = `On camera · ${who ? who[0].toUpperCase() + who.slice(1) : 'the whole crew'}`
    }
    on(stage, 'pointermove', ((e: PointerEvent) => setLit(hit(e))) as EventListener)
    on(stage, 'pointerleave', () => setLit(null))
    off.push(() => setLit(null))

    // the stage: the director first, then one partner steps into the spot per screen
    const demos: Record<string, string> = {
      board: '<p class="boardcap mono">Today\'s call sheet · the scene shooting now is lit</p><ol class="board">' + crew.slice(1).map((c, i) => `<li style="--i:${i}"><span>Sc.${pad(i + 1)}</span><b>${c.name}</b><span>${c.call}</span></li>`).join('') + '</ol>',
      wf: '<div class="wf">' + '<span></span>'.repeat(11) + '</div>',
      code: '<div class="code" data-type></div>',
      uptime: '<div class="uptime">' + Array.from({ length: 30 }, (_, i) => `<i style="animation-delay:${(i * 0.09).toFixed(2)}s"></i>`).join('') + '</div><p class="mono" style="margin-top:12px;color:var(--dim)">All systems normal</p>',
      cal: '<div class="cal">' + ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => `<div>${d}<i class="${[0, 2, 3, 5].includes(i) ? 'p' : ''}"></i></div>`).join('') + '</div>',
      checks: '<ul class="checks"><li>Loads fast on a phone</li><li>Readable by screen readers</li><li>Every link and form works</li><li>Copy checked for accuracy</li></ul>',
      gantt: '<div class="gantt">' + ['Week 1', 'Week 2', 'Week 3', 'Week 4'].map((w, i) => `<div>${w}<b style="width:${[40, 70, 55, 85][i]}%;margin-left:${[0, 20, 45, 10][i]}%;animation-delay:${i * 0.25}s"></b></div>`).join('') + '</div>',
    }
    const codeText = [['c', '// new enquiry from your site'], ['', 'on form.submit:'], ['k2', '  book(calendar.nextFreeSlot)'], ['k2', '  send(reminder, 24h before)'], ['', '  add(customer, yourCRM)']]
    const names = $('names'), spot = $('spot'), cone = $('cone'), brief = $('brief'), onAir = $('onAir'), pin = $('crewPin')
    const track = $('crewTrack')
    track.style.setProperty('--n', String(crew.length))
    const lis = [...names.querySelectorAll<HTMLElement>('li')], spotFigs = [...spot.querySelectorAll<HTMLElement>('figure')]
    let active = -1, typer = 0, stageOn = false
    // the spot follows the head, not the cutout's box: Thoth's head sits well left of his landscape frame
    const aim = () => {
      if (active < 0) return; const c = crew[active], img = spotFigs[active].querySelector('img')!
      const bw = img.offsetWidth, bh = img.offsetHeight; if (!bw) return
      const cw = Math.min(bw, bh * c.w / c.h)
      cone.style.setProperty('--cx', `${(img.offsetLeft + bw / 2 + c.fx * cw).toFixed(1)}px`)
    }
    const centre = (li: HTMLElement) => { names.style.transform = `translateY(${-(li.offsetTop + li.offsetHeight / 2)}px)` }
    const typeRun = () => {
      clearInterval(typer); typer = 0
      const box = brief.querySelector('[data-type]'); if (!box) return
      if (reduce) { box.innerHTML = codeText.map(([k, t]) => `<span class="${k}">${t}</span>`).join('\n'); return }
      if (!(stageOn && pageOn && desk.matches) || dead) return
      let n = 0; const total = codeText.reduce((a, [, t]) => a + t.length + 1, 0)
      typer = window.setInterval(() => { n = (n + 1) % (total + 40); let left = n; box.innerHTML = codeText.map(([k, t]) => { const s = t.slice(0, Math.max(0, left)); left -= t.length + 1; return `<span class="${k}">${s}</span>` }).join('\n') }, 45)
    }
    off.push(() => { clearInterval(typer); typer = 0 })
    const show = (i: number, say: boolean) => {
      if (i === active) return; active = i; const c = crew[i]
      names.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-current', String(j === i)))
      if (!names.contains(document.activeElement)) centre(lis[i])
      spotFigs.forEach((f, j) => f.classList.toggle('on', j === i))
      aim()
      brief.innerHTML = `<span class="role mono">Sc. ${pad(i)} · ${c.role}</span><h3>${c.name}</h3><p>${c.line}</p><span class="call mono"><i aria-hidden="true"></i>Call: ${c.call}</span><ul>${c.does.map((d) => `<li>${d}</li>`).join('')}</ul><div class="monitor" aria-hidden="true"><span class="lbl mono">Monitor · illustration</span>${demos[c.demo]}</div>`
      if (say) onAir.textContent = `On camera: ${c.name}, ${c.role}`
      typeRun()
    }
    const onScroll = () => { if (!desk.matches) return; const r = track.getBoundingClientRect(); const p = Math.max(0, Math.min(0.999, -r.top / (r.height - innerHeight * 0.85))); show(Math.floor(p * crew.length), true) }
    on(names, 'click', ((e: MouseEvent) => { const b = (e.target as Element).closest<HTMLElement>('button'); if (!b) return; const i = +b.dataset.i!; const r = track.getBoundingClientRect(); scrollTo({ top: scrollY + r.top + (i + 0.5) / crew.length * (r.height - innerHeight * 0.85), behavior: reduce ? 'auto' : 'smooth' }) }) as EventListener)
    // keyboard: the focused name slides into the readable band; on leaving, the list returns to the scene on camera
    on(names, 'focusin', ((e: FocusEvent) => { const li = (e.target as Element).closest<HTMLElement>('li'); if (li) centre(li) }) as EventListener)
    on(names, 'focusout', () => centre(lis[active]))
    on(window, 'scroll', onScroll, { passive: true })
    on(window, 'resize', () => { aim(); onScroll() })
    show(0, false); onScroll()
    const stageRun = () => { pin.classList.toggle('paused', !(stageOn && pageOn)); typeRun() }
    watch([track], (e) => { stageOn = e.isIntersecting; stageRun() })
    wakers.push(stageRun)
    off.push(() => { brief.innerHTML = ''; onAir.textContent = '' })

    // the credits roll up through a fixed frame, slower than the scroll, and stop with the last credit at the bottom of the frame
    const rollTrack = $('rollTrack'), rollFrame = $('rollFrame'), roll = $('roll')
    let r0 = 0, r1 = 0
    const rollMove = () => {
      if (reduce) return
      const r = rollTrack.getBoundingClientRect(), top = parseFloat(getComputedStyle(rollFrame).top) || 0, span = r.height - rollFrame.offsetHeight
      const p = span > 0 ? clamp01((top - r.top) / span) : 1
      roll.style.transform = `translate3d(0, ${(r0 + (r1 - r0) * p).toFixed(1)}px, 0)`
    }
    const rollFit = () => {
      if (reduce || dead) return
      const fh = rollFrame.offsetHeight, rh = roll.offsetHeight
      r0 = fh * 0.12; r1 = Math.min(r0, fh * 0.88 - rh)
      rollTrack.style.height = `${Math.round(fh + (r0 - r1) / 0.72)}px`
      rollMove()
    }
    rollFit(); document.fonts?.ready.then(rollFit); on(window, 'resize', rollFit)
    on(window, 'scroll', rollMove, { passive: true })
    off.push(() => { rollTrack.style.removeProperty('height'); roll.style.removeProperty('transform') })

    // the tally: ROLLING until the end card is on screen, then CUT; scrolling back up puts the scene live again
    const rec = $('rec'), recTxt = $('recTxt')
    watch([$('book')], (e) => { const cut = e.isIntersecting || e.boundingClientRect.top < 0; rec.classList.toggle('cut', cut); recTxt.textContent = cut ? 'Cut' : 'Rolling' }, { threshold: 0.25 })

    // reveals: once; content is readable at rest
    if (!reduce && 'IntersectionObserver' in window) {
      const rvs = [...root.querySelectorAll('.rv')]
      const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }), { rootMargin: '0px 0px -50px 0px' })
      rvs.forEach((el) => io.observe(el))
      off.push(() => io.disconnect())
      const tm = window.setTimeout(() => rvs.forEach((el) => { if (el.getBoundingClientRect().top < innerHeight) el.classList.add('in') }), 60)
      off.push(() => clearTimeout(tm))
    }

    return () => {
      dead = true
      off.reverse().forEach((f) => f())
    }
  }, [])

  return null
}

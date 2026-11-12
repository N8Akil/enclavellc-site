'use client'

import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { currentSlate } from './night-coverage'

// ---------------------------------------------------------------------------------------------------------------
// Free site audit. Mirrors src/components/website-audit-form.tsx: the same schema, the same POST to
// /api/audit/generate (headers, JSON fields websiteUrl / userEmail / userName, https:// normalisation) and the same
// success and error handling. Only the markup and the feedback (D's role="status" line instead of a toast) differ.
// ---------------------------------------------------------------------------------------------------------------
const auditSchema = z.object({
  websiteUrl: z.string()
    .min(1, 'Website URL is required')
    .refine((url) => {
      try {
        const normalized = url.startsWith('http') ? url : `https://${url}`
        const parsed = new URL(normalized)
        return parsed.hostname.includes('.')
      } catch {
        return false
      }
    }, 'Please enter a valid website URL'),
  userEmail: z.string().email('Please enter a valid email address'),
  userName: z.string().optional(),
})

type AuditValues = z.infer<typeof auditSchema>

// A web address typed into either audit form is remembered for this tab only (sessionStorage; nothing is sent anywhere):
// the other audit form, the dock and the end credits pick it up through the "nc:url" event, and it is cleared once an
// audit is sent.
const URL_KEY = 'nc-url'
export const readTypedUrl = () => { try { return sessionStorage.getItem(URL_KEY) || '' } catch { return '' } }
const shareTypedUrl = (v: string) => {
  try { if (v) sessionStorage.setItem(URL_KEY, v); else sessionStorage.removeItem(URL_KEY) } catch {}
  window.dispatchEvent(new CustomEvent('nc:url', { detail: v }))
}
// the host a visitor would recognise as theirs, or '' while what they have typed is not an address yet
export const hostOf = (v: string) => {
  try {
    if (/[\s%]/.test(v)) return ''
    const h = new URL(v.startsWith('http') ? v : `https://${v}`).hostname.replace(/^www\./, '')
    return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(h) && h.length <= 48 ? h : ''
  } catch { return '' }
}

// variant 'hero' is the same form in the opening shot: website and email only. The name is optional in the schema and is
// sent as '' there, which is what the full form sends when its Name field is left blank.
export function NightAuditForm({ variant = 'end' }: { variant?: 'hero' | 'end' }) {
  const hero = variant === 'hero'
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [resultMessage, setResultMessage] = useState('')

  const { register, handleSubmit, formState: { errors, dirtyFields }, reset, setValue, getValues, watch } = useForm<AuditValues>({
    resolver: zodResolver(auditSchema),
    defaultValues: { userName: '' },
  })

  // what this form's address field holds is shared; an address typed in the other form fills this one while it is empty
  // (only once the visitor has edited THIS field: a carried-over value is not dirty, so the empty form never clears the other's)
  const typed = watch('websiteUrl')
  const edited = !!dirtyFields.websiteUrl
  useEffect(() => {
    if (!edited) return
    const v = (typed || '').trim()
    const next = hostOf(v) ? v : ''
    if (next !== readTypedUrl()) shareTypedUrl(next)
  }, [typed, edited])
  useEffect(() => {
    // fills an empty field, follows the other form while this one is untouched, and empties with it
    const fill = (v: string) => { if (!dirtyFields.websiteUrl && getValues('websiteUrl') !== v) setValue('websiteUrl', v) }
    fill(readTypedUrl())
    const onUrl = (e: Event) => fill((e as CustomEvent<string>).detail)
    window.addEventListener('nc:url', onUrl)
    return () => window.removeEventListener('nc:url', onUrl)
  }, [getValues, setValue, dirtyFields.websiteUrl])

  const onSubmit = async (values: AuditValues) => {
    setStatus('loading')

    try {
      // Normalize URL - add https:// if not present
      const normalizedUrl = values.websiteUrl.startsWith('http')
        ? values.websiteUrl
        : `https://${values.websiteUrl}`

      const res = await fetch('/api/audit/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...values,
          websiteUrl: normalizedUrl,
        }),
      })

      const data = await res.json()

      if (data.success) {
        setStatus('success')
        // while the free audit is in preview the API says what will really happen: show its words, not ours
        // (an accepted audit carries the API's own sentence too: it promises no time, where ours did)
        setResultMessage((data.preview === true || data.accepted === true) && typeof data.message === 'string' ? data.message : `Your professional audit document is being delivered to ${values.userEmail}. Check your inbox in 2-3 minutes!`)
        reset()
        shareTypedUrl('')
      } else {
        setStatus('error')
        setResultMessage(data.message || 'Something went wrong. Please try again.')
      }
    } catch {
      setStatus('error')
      setResultMessage('Unable to process your request. Please try again later.')
    }
  }

  const fieldError = errors.websiteUrl?.message || errors.userEmail?.message || errors.userName?.message
  const loading = status === 'loading'
  const note = fieldError || (loading ? 'Analyzing & Sending...' : resultMessage)
  const isErr = !!fieldError || status === 'error'

  if (hero) {
    return (
      <form className="audit hero-audit" id="audit-hero" aria-label="Free site audit" onSubmit={handleSubmit(onSubmit)} aria-busy={loading} noValidate>
        <div className="hero-fields">
          <label>Your website<input {...register('websiteUrl')} type="text" inputMode="url" autoComplete="url" placeholder="yourbusiness.com" required aria-invalid={!!errors.websiteUrl} disabled={loading} /></label>
          <label>Where to send it<input {...register('userEmail')} type="email" autoComplete="email" placeholder="you@yourbusiness.com" required aria-invalid={!!errors.userEmail} disabled={loading} /></label>
        </div>
        <div className="hero-go">
          <button className="btn gold" type="submit" disabled={loading}>Send my free audit</button>
          <p className={isErr ? 'note err' : 'note'} id="auditHeroNote" role="status">{note || 'Free. A plain-language report, sent to your inbox.'}</p>
        </div>
      </form>
    )
  }

  return (
    <form className="audit" id="audit" tabIndex={-1} aria-labelledby="audit-h" onSubmit={handleSubmit(onSubmit)} aria-busy={loading} noValidate>
      <span className="k mono">Start here · free</span>
      <h3 id="audit-h">Free site audit</h3>
      <label>Website<input {...register('websiteUrl')} type="text" inputMode="url" autoComplete="url" placeholder="yourbusiness.com" required aria-invalid={!!errors.websiteUrl} disabled={loading} /></label>
      <label>Name (optional)<input {...register('userName')} type="text" autoComplete="name" aria-invalid={!!errors.userName} disabled={loading} /></label>
      <label>Email<input {...register('userEmail')} type="email" autoComplete="email" required aria-invalid={!!errors.userEmail} disabled={loading} /></label>
      <button className="btn solid" type="submit" disabled={loading}>Send for the audit</button>
      <p className={isErr ? 'note err' : 'note'} id="auditNote" role="status">{note}</p>
    </form>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// "Request a call" (was "Book a call": there is no booking link yet, so the label says what happens). It opens a contact form. It mirrors
// src/components/contact-form.tsx: the same schema and default, the same POST of the raw values to /api/contact,
// the same success (res.ok) message, and on failure the API's own error (or the same fallback address).
// ---------------------------------------------------------------------------------------------------------------
const contactSchema = z.object({
  name: z.string().min(2, 'Please enter your name.'),
  email: z.string().email('Please enter a valid email.'),
  phone: z.string().optional(),
  service: z.enum(['Website Rebuild', 'Automation Setup', 'Content + Cleanup', 'Not sure yet']).optional(),
  message: z.string().min(10, 'Please add a short message (at least 10 characters).'),
})

type ContactValues = z.infer<typeof contactSchema>

export function NightBook() {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const { register, handleSubmit, formState: { errors, isSubmitting }, reset, setValue } = useForm<ContactValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      service: 'Not sure yet',
    },
  })

  const onSubmit = async (values: ContactValues) => {
    setResult(null)
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })

      if (!res.ok) {
        // the API's own error carries the fallback address (enclavellc-site #3)
        const data = await res.json().catch(() => null)
        setResult({ ok: false, text: typeof data?.error === 'string' ? data.error : 'We could not send your message. Please email n.garrett@enclavellc.net or try again.' })
        return
      }

      setResult({ ok: true, text: 'Sent. We’ll get back to you ASAP.' })
      reset()
    } catch {
      // a network error: the same fallback contact-form.tsx shows (enclavellc-site #3, fold 6)
      setResult({ ok: false, text: 'We could not send your message. Please email n.garrett@enclavellc.net or try again.' })
    }
  }

  // "nc:book" (the coverage slate, the dock): open the form; a slate pick arrives as a draft message the visitor can edit
  useEffect(() => {
    const onBook = (e: Event) => {
      const d = (e as CustomEvent<{ message?: string; service?: ContactValues['service'] }>).detail
      if (d?.message) setValue('message', d.message, { shouldValidate: false })
      if (d?.service) setValue('service', d.service)
      setResult(null)
      setOpen(true)
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>('input')?.focus())
    }
    window.addEventListener('nc:book', onBook)
    // plain "#book" links (the header button) open the form too, with whatever is on the slate
    const links = [...document.querySelectorAll<HTMLAnchorElement>('.nc a[href="#book"]')]
    const onLink = () => window.dispatchEvent(new CustomEvent('nc:book', { detail: currentSlate() ?? {} }))
    links.forEach((a) => a.addEventListener('click', onLink))
    return () => { window.removeEventListener('nc:book', onBook); links.forEach((a) => a.removeEventListener('click', onLink)) }
  }, [setValue])

  // opening the form moves focus into it (focus scrolls it into view)
  useEffect(() => {
    if (open) formRef.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [open])

  const fieldError = errors.name?.message || errors.email?.message || errors.phone?.message || errors.service?.message || errors.message?.message
  const note = fieldError || (isSubmitting ? 'Sending…' : result?.text ?? '')
  const isErr = !!fieldError || result?.ok === false

  return (
    <>
      <div className="bookbox">
        <button className="btn gold" id="bookLink" type="button" aria-expanded={open} aria-controls="contact"
          onClick={() => { if (open) formRef.current?.querySelector<HTMLInputElement>('input')?.focus(); else setOpen(true) }}>
          Request a call
        </button>
      </div>
      <form className="audit contact" id="contact" ref={formRef} hidden={!open} aria-label="Request a call" onSubmit={handleSubmit(onSubmit)} aria-busy={isSubmitting}>
        <span className="k mono">Request a call</span>
        <label>Name<input {...register('name')} autoComplete="name" placeholder="Your name" aria-invalid={!!errors.name} /></label>
        <label>Email<input {...register('email')} autoComplete="email" placeholder="you@company.com" aria-invalid={!!errors.email} /></label>
        <label>Phone (optional)<input {...register('phone')} autoComplete="tel" inputMode="tel" placeholder="(###) ###-####" aria-invalid={!!errors.phone} /></label>
        <label>What do you need?
          <select {...register('service')} aria-invalid={!!errors.service}>
            <option>Website Rebuild</option>
            <option>Automation Setup</option>
            <option>Content + Cleanup</option>
            <option>Not sure yet</option>
          </select>
        </label>
        <label>Message<textarea {...register('message')} placeholder="Tell us what’s going on (current site, what you want fixed, etc.)" aria-invalid={!!errors.message} /></label>
        <button className="btn solid" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Sending…' : 'Send request'}</button>
        <p className={isErr ? 'note err' : 'note'} id="contactNote" role="status">{note}</p>
      </form>
    </>
  )
}

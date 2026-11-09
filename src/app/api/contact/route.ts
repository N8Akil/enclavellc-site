import { NextRequest, NextResponse } from 'next/server'
import { escapeHtml } from '@/lib/email/escape'
import { getResendClient } from '@/lib/email/resend-client'

/**
 * Contact Form API Endpoint
 * Emails the enquiry to the admin inbox through Resend, with reply-to set to the visitor.
 * The visitor is thanked only once Resend has accepted the email.
 */

const SEND_FAILED = 'We could not send your message. Please email n.garrett@enclavellc.net or try again.'

export async function POST(request: NextRequest) {
  // logs carry only this id and a status/code, never the visitor's details
  const requestId = crypto.randomUUID().slice(0, 8)
  const failure = (status: number) =>
    NextResponse.json({ success: false, error: SEND_FAILED, requestId }, { status })

  try {
    const body = await request.json()

    // Validate required fields
    const { name, email, phone, message, service } = body

    if (!name || !email || !message) {
      return NextResponse.json(
        { success: false, error: 'Name, email, and message are required' },
        { status: 400 }
      )
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { success: false, error: 'Invalid email address' },
        { status: 400 }
      )
    }

    if (!process.env.RESEND_API_KEY) {
      console.error(`[Contact API] ${requestId} not sent: RESEND_API_KEY missing`)
      return failure(503)
    }

    const topic = String(service || 'General Inquiry').replace(/\s+/g, ' ').trim().slice(0, 100)

    try {
      const { data, error } = await getResendClient().emails.send({
        from: 'Enclave LLC <contact@enclavellc.net>',
        to: process.env.ADMIN_EMAIL || 'n.garrett@enclavellc.net',
        replyTo: String(email),
        subject: `New enquiry: ${topic}`,
        html: enquiryHtml({ name, email, phone, service: topic, message }),
      })

      if (error || !data?.id) {
        console.error(`[Contact API] ${requestId} not sent: resend ${error ? `${error.statusCode ?? '-'} ${error.name}` : 'returned no id'}`)
        return failure(502)
      }
    } catch (sendError) {
      console.error(`[Contact API] ${requestId} not sent: resend threw ${sendError instanceof Error ? sendError.name : typeof sendError}`)
      return failure(502)
    }

    return NextResponse.json({
      success: true,
      message: 'Thank you for reaching out! We\'ll get back to you within 24 hours.',
    })
  } catch (error) {
    console.error(`[Contact API] ${requestId} error: ${error instanceof Error ? error.name : typeof error}`)
    return NextResponse.json(
      { success: false, error: 'An error occurred. Please try again.' },
      { status: 500 }
    )
  }
}

function enquiryHtml(fields: Record<string, unknown>): string {
  const row = (label: string, value: unknown) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#666;vertical-align:top">${label}</td><td style="padding:6px 0">${escapeHtml(value) || '—'}</td></tr>`
  return `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;color:#222">
<h2 style="margin:0 0 12px">New enquiry from enclavellc.net</h2>
<table role="presentation" style="border-collapse:collapse">
${row('Name', fields.name)}
${row('Email', fields.email)}
${row('Phone', fields.phone)}
${row('Service', fields.service)}
</table>
<p style="margin:16px 0 4px;color:#666">Message</p>
<p style="margin:0;white-space:pre-wrap">${escapeHtml(fields.message)}</p>
</body></html>`
}

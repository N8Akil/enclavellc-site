import { NextRequest, NextResponse } from 'next/server'

/**
 * Contact Form API Endpoint
 * Sends form data to n8n webhook for processing
 */

export async function POST(request: NextRequest) {
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

    // Prepare payload for n8n webhook
    const webhookPayload = {
      timestamp: new Date().toISOString(),
      source: 'enclavellc.net',
      formType: 'contact',
      data: {
        name,
        email,
        phone: phone || null,
        message,
        service: service || 'General Inquiry',
      },
      metadata: {
        userAgent: request.headers.get('user-agent'),
        ip: request.headers.get('x-forwarded-for') || 'unknown',
      },
    }

    // Send to n8n webhook
    const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL
    const n8nWebhookToken = process.env.N8N_WEBHOOK_TOKEN

    if (n8nWebhookUrl) {
      const n8nResponse = await fetch(n8nWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(n8nWebhookToken && { Authorization: `Bearer ${n8nWebhookToken}` }),
        },
        body: JSON.stringify(webhookPayload),
      })

      if (!n8nResponse.ok) {
        console.error('[Contact API] n8n webhook failed:', n8nResponse.status)
        // Don't fail the request - still return success to user
      }
    } else {
      console.warn('[Contact API] N8N_WEBHOOK_URL not configured')
    }

    return NextResponse.json({
      success: true,
      message: 'Thank you for reaching out! We\'ll get back to you within 24 hours.',
    })
  } catch (error) {
    console.error('[Contact API] Error:', error)
    return NextResponse.json(
      { success: false, error: 'An error occurred. Please try again.' },
      { status: 500 }
    )
  }
}

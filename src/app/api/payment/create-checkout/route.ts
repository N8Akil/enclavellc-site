import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

// Service packages for Enclave Development
const PACKAGES = {
  'website-audit': {
    name: 'Website Audit',
    description: 'Comprehensive website and lead process review with actionable recommendations',
    amount: 0, // Free
    mode: 'payment' as const,
  },
  'website-rebuild': {
    name: 'Website Rebuild',
    description: 'Modern, mobile-first website rebuild with SEO optimization',
    amount: 249900, // $2,499
    mode: 'payment' as const,
  },
  'automation-setup': {
    name: 'Automation Setup',
    description: 'Lead capture, notifications, and follow-up automation',
    amount: 149900, // $1,499
    mode: 'payment' as const,
  },
  'full-package': {
    name: 'Full Digital Overhaul',
    description: 'Website rebuild + automation setup + content refresh',
    amount: 349900, // $3,499
    mode: 'payment' as const,
  },
  'content-creation': {
    name: 'Content Creation',
    description: 'Professional blog posts, social media graphics, and email newsletter copy',
    amount: 99900, // $999/month
    mode: 'subscription' as const,
  },
  'social-media': {
    name: 'Social Media Management',
    description: 'Full-service social presence management across 3 platforms',
    amount: 129900, // $1,299/month
    mode: 'subscription' as const,
  },
  'monthly-maintenance': {
    name: 'Monthly Maintenance',
    description: 'Ongoing website updates, hosting, and support',
    amount: 19900, // $199/month
    mode: 'subscription' as const,
  },
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { packageId, customerEmail, customerName } = body

    if (!packageId || !PACKAGES[packageId as keyof typeof PACKAGES]) {
      return NextResponse.json(
        { error: 'Invalid package selected' },
        { status: 400 }
      )
    }

    const pkg = PACKAGES[packageId as keyof typeof PACKAGES]

    // Free audit - just redirect to contact
    if (pkg.amount === 0) {
      return NextResponse.json({
        url: `${process.env.NEXT_PUBLIC_SITE_URL}/#contact`,
        free: true,
      })
    }

    // Create or find customer
    let customer: Stripe.Customer | undefined
    if (customerEmail) {
      const existingCustomers = await stripe.customers.list({
        email: customerEmail,
        limit: 1,
      })

      if (existingCustomers.data.length > 0) {
        customer = existingCustomers.data[0]
      } else {
        customer = await stripe.customers.create({
          email: customerEmail,
          name: customerName || undefined,
          metadata: {
            source: 'enclavellc.net',
            package: packageId,
          },
        })
      }
    }

    // Create checkout session
    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
      customer: customer?.id,
      customer_email: customer ? undefined : customerEmail,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: pkg.name,
              description: pkg.description,
            },
            unit_amount: pkg.amount,
            ...(pkg.mode === 'subscription' && {
              recurring: {
                interval: 'month',
              },
            }),
          },
          quantity: 1,
        },
      ],
      mode: pkg.mode,
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/payment?canceled=true`,
      metadata: {
        package: packageId,
        source: 'enclavellc.net',
      },
    }

    const session = await stripe.checkout.sessions.create(sessionConfig)

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('Stripe checkout error:', error)
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    )
  }
}

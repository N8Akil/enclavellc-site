"use client"

import { useEffect, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { CheckCircle2, ArrowRight, Mail, Calendar } from "lucide-react"

function SuccessContent() {
  const searchParams = useSearchParams()
  const sessionId = searchParams.get("session_id")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Simulate loading state for smooth transition
    const timer = setTimeout(() => setLoading(false), 1000)
    return () => clearTimeout(timer)
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center">
        <div className="animate-pulse text-xl">Processing your payment...</div>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      {/* Navigation */}
      <nav className="fixed top-6 left-1/2 -translate-x-1/2 z-50">
        <Link href="/" className="flex items-center gap-3 bg-neutral-800/50 backdrop-blur-xl border border-white/10 rounded-full p-2 pl-5 pr-6">
          <div className="relative w-8 h-8">
            <Image
              src="/logo-icon.png"
              alt="Enclave"
              fill
              className="object-contain"
              priority
            />
          </div>
          <span className="text-white text-sm font-semibold tracking-tight">Enclave Development</span>
        </Link>
      </nav>

      {/* Success Content */}
      <section className="min-h-screen flex items-center justify-center px-4 py-32">
        <div className="max-w-xl mx-auto text-center">
          {/* Success Icon */}
          <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-8">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
          </div>

          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            Payment Successful!
          </h1>

          <p className="text-xl text-neutral-400 mb-8">
            Thank you for your purchase. We're excited to start working with you.
          </p>

          {/* What's Next */}
          <div className="bg-neutral-900/50 border border-white/10 rounded-2xl p-6 mb-8 text-left">
            <h2 className="text-lg font-semibold mb-4">What happens next?</h2>
            <ul className="space-y-4">
              <li className="flex items-start gap-3">
                <div className="w-8 h-8 bg-orange-500/20 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                  <Mail className="w-4 h-4 text-orange-500" />
                </div>
                <div>
                  <p className="font-medium">Check your email</p>
                  <p className="text-sm text-neutral-400">You'll receive a confirmation and receipt within minutes.</p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-8 h-8 bg-orange-500/20 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                  <Calendar className="w-4 h-4 text-orange-500" />
                </div>
                <div>
                  <p className="font-medium">Kickoff call scheduled</p>
                  <p className="text-sm text-neutral-400">We'll reach out within 24 hours to schedule your kickoff call.</p>
                </div>
              </li>
            </ul>
          </div>

          {/* Session ID */}
          {sessionId && (
            <p className="text-xs text-neutral-600 mb-8">
              Reference: {sessionId.slice(0, 20)}...
            </p>
          )}

          {/* CTA */}
          <Link
            href="/"
            className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold px-6 py-3 rounded-xl transition-colors"
          >
            <span>Back to Home</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>
    </main>
  )
}

export default function SuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center">
        <div className="animate-pulse text-xl">Loading...</div>
      </div>
    }>
      <SuccessContent />
    </Suspense>
  )
}

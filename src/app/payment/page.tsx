"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { ArrowRight, Check, Globe, Zap, FileText, Sparkles, ArrowLeft, Camera, Share2 } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"

const packages = [
  // Ordered by price: Free → $999/mo → $1,299/mo → $1,499 → $2,499 → $3,499
  {
    id: "website-audit",
    name: "Website Audit",
    price: "Free",
    description: "Comprehensive review of your website and lead process",
    features: [
      "Full site performance analysis",
      "Lead capture assessment",
      "Mobile responsiveness check",
      "SEO quick scan",
      "Actionable recommendations",
    ],
    icon: FileText,
    color: "gray",
    popular: false,
  },
  {
    id: "content-creation",
    name: "Content Creation",
    price: "$999/mo",
    description: "Professional content that builds trust and drives engagement",
    features: [
      "4 blog posts per month",
      "Social media graphics",
      "Email newsletter copy",
      "Content calendar planning",
      "SEO-optimized writing",
      "Revision rounds included",
    ],
    icon: Camera,
    color: "purple",
    popular: false,
  },
  {
    id: "social-media",
    name: "Social Media Management",
    price: "$1,299/mo",
    description: "Full-service social presence management",
    features: [
      "3 platforms managed",
      "Daily posting schedule",
      "Community engagement",
      "Monthly analytics report",
      "Content creation included",
      "Ad campaign management",
    ],
    icon: Share2,
    color: "blue",
    popular: false,
  },
  {
    id: "automation-setup",
    name: "Automation Setup",
    price: "$1,499",
    description: "Stop losing leads with automated follow-up systems",
    features: [
      "Form submission notifications",
      "Email auto-responders",
      "Calendar/scheduling integration",
      "CRM connection (if applicable)",
      "SMS follow-up (optional)",
      "Training session included",
    ],
    icon: Zap,
    color: "red",
    popular: false,
  },
  {
    id: "website-rebuild",
    name: "Website Rebuild",
    price: "$2,499",
    description: "Modern, mobile-first website that converts visitors to customers",
    features: [
      "Custom responsive design",
      "SEO optimization",
      "Fast load times",
      "Contact forms + lead capture",
      "Google Analytics setup",
      "2 rounds of revisions",
    ],
    icon: Globe,
    color: "orange",
    popular: false,
  },
  {
    id: "full-package",
    name: "Full Digital Overhaul",
    price: "$3,499",
    description: "Everything you need to modernize your digital presence",
    features: [
      "Everything in Website Rebuild",
      "Everything in Automation Setup",
      "Professional copywriting",
      "Brand refresh consultation",
      "Priority support for 30 days",
      "Quarterly check-in call",
    ],
    icon: Sparkles,
    color: "yellow",
    popular: true,
  },
]

export default function PaymentPage() {
  const [loading, setLoading] = useState<string | null>(null)
  const [email, setEmail] = useState("")

  const handleCheckout = async (packageId: string) => {
    setLoading(packageId)

    try {
      const response = await fetch("/api/payment/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageId,
          customerEmail: email || undefined,
        }),
      })

      const data = await response.json()

      if (data.free) {
        window.location.href = data.url
      } else if (data.url) {
        window.location.href = data.url
      } else {
        alert("Failed to create checkout session")
      }
    } catch (error) {
      console.error("Checkout error:", error)
      alert("Something went wrong. Please try again.")
    } finally {
      setLoading(null)
    }
  }

  const getColorClasses = (color: string) => {
    switch (color) {
      case "orange":
        return {
          bg: "bg-orange-500/10",
          text: "text-orange-500",
          border: "border-orange-500/20",
          button: "bg-orange-500 hover:bg-orange-600",
        }
      case "red":
        return {
          bg: "bg-red-500/10",
          text: "text-red-500",
          border: "border-red-500/20",
          button: "bg-red-500 hover:bg-red-600",
        }
      case "yellow":
        return {
          bg: "bg-amber-500/10",
          text: "text-amber-500",
          border: "border-amber-500/20",
          button: "bg-amber-500 hover:bg-amber-600",
        }
      case "purple":
        return {
          bg: "bg-purple-500/10",
          text: "text-purple-500",
          border: "border-purple-500/20",
          button: "bg-purple-500 hover:bg-purple-600",
        }
      case "blue":
        return {
          bg: "bg-blue-500/10",
          text: "text-blue-500",
          border: "border-blue-500/20",
          button: "bg-blue-500 hover:bg-blue-600",
        }
      case "gray":
        return {
          bg: "bg-neutral-500/10",
          text: "text-neutral-400",
          border: "border-neutral-500/20",
          button: "bg-neutral-500 hover:bg-neutral-600",
        }
      default:
        return {
          bg: "bg-neutral-500/10",
          text: "text-neutral-500",
          border: "border-neutral-500/20",
          button: "bg-neutral-500 hover:bg-neutral-600",
        }
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      {/* Navigation */}
      <nav className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-[95%] max-w-5xl">
        <div className="bg-neutral-800/50 backdrop-blur-xl border border-white/10 rounded-full p-2 pl-5 pr-2 flex items-center gap-6">
          <Link href="/" className="flex items-center gap-3 shrink-0">
            <div className="relative w-8 h-8">
              <Image
                src="/logo-icon.png"
                alt="Enclave"
                fill
                className="object-contain"
                priority
              />
            </div>
            <div className="hidden sm:flex flex-col leading-tight">
              <span className="text-white text-sm font-semibold tracking-tight">Enclave Development</span>
              <span className="text-neutral-400 text-[10px]">Web & Automation</span>
            </div>
          </Link>
          <div className="flex-1" />
          <Link href="/" className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors text-sm">
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back to Home</span>
          </Link>
          <div className="ml-1">
            <ThemeToggle />
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-16 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
            Choose Your Package
          </h1>
          <p className="text-xl text-neutral-400 max-w-2xl mx-auto">
            Simple, transparent pricing. No hidden fees. Start with a free audit or jump straight into a rebuild.
          </p>
        </div>
      </section>

      {/* Email Input */}
      <section className="px-4 pb-8">
        <div className="max-w-md mx-auto">
          <label className="block text-sm text-neutral-400 mb-2">Your email (optional, for receipt)</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-white placeholder:text-neutral-600 focus:outline-none focus:border-orange-500/50 transition-colors"
          />
        </div>
      </section>

      {/* Packages Grid */}
      <section className="px-4 pb-24">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {packages.map((pkg) => {
            const colors = getColorClasses(pkg.color)
            const Icon = pkg.icon

            return (
              <div
                key={pkg.id}
                className={`relative bg-neutral-900/50 border ${pkg.popular ? "border-amber-500/50" : "border-white/10"} rounded-2xl p-6 flex flex-col`}
              >
                {pkg.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-500 text-black text-xs font-bold px-3 py-1 rounded-full">
                    MOST POPULAR
                  </div>
                )}

                <div className="flex items-start justify-between mb-4">
                  <div className={`w-12 h-12 rounded-xl ${colors.bg} flex items-center justify-center`}>
                    <Icon className={`w-6 h-6 ${colors.text}`} />
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold">{pkg.price}</div>
                    {pkg.price !== "Free" && !pkg.price.includes("/mo") && (
                      <div className="text-xs text-neutral-500">one-time</div>
                    )}
                  </div>
                </div>

                <h3 className="text-xl font-semibold mb-2">{pkg.name}</h3>
                <p className="text-neutral-400 text-sm mb-6">{pkg.description}</p>

                <ul className="space-y-3 mb-8 flex-1">
                  {pkg.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Check className={`w-4 h-4 ${colors.text} mt-0.5 shrink-0`} />
                      <span className="text-neutral-300">{feature}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handleCheckout(pkg.id)}
                  disabled={loading === pkg.id}
                  className={`w-full py-3 px-4 rounded-xl font-semibold text-white ${colors.button} transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {loading === pkg.id ? (
                    <span>Processing...</span>
                  ) : pkg.price === "Free" ? (
                    <>
                      <span>Request Free Audit</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  ) : (
                    <>
                      <span>Get Started</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      </section>

      {/* Monthly Maintenance Add-on */}
      <section className="px-4 pb-24">
        <div className="max-w-2xl mx-auto bg-neutral-900/50 border border-white/10 rounded-2xl p-8 text-center">
          <h3 className="text-2xl font-bold mb-2">Need Ongoing Support?</h3>
          <p className="text-neutral-400 mb-6">
            Add monthly maintenance for $199/month. Includes hosting, updates, security patches, and priority support.
          </p>
          <p className="text-sm text-neutral-500">
            Available as an add-on after any package purchase. We'll discuss during your onboarding call.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-8 px-4">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-neutral-500">
          <p>© 2025 Enclave Development. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <span>Secure payments by Stripe</span>
          </div>
        </div>
      </footer>
    </main>
  )
}

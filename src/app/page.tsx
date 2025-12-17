"use client"

import Link from "next/link"
import Image from "next/image"
import { Sparkles, ArrowRight } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"
import { HeroSection } from "@/components/landing/hero-section"
import { FeaturesSection } from "@/components/landing/features-section"
import { IntegrationsSection } from "@/components/landing/integrations-section"
import { TestimonialsSection } from "@/components/landing/testimonials-section"
import { CTAFooter } from "@/components/landing/cta-footer"

export default function HomePage() {
  return (
    <main className="min-h-screen bg-black text-neutral-300 selection:bg-orange-900 selection:text-white overflow-x-hidden">

      {/* Navigation */}
      <nav className="fixed top-6 left-1/2 -translate-x-1/2 z-50">
        <div className="glass-card rounded-full p-2 pl-6 pr-2 flex items-center gap-4 animate-on-scroll">
          {/* Logo */}
          <Link href="/" className="relative w-28 h-8">
            <Image
              src="/logo-white.png"
              alt="Enclave"
              fill
              className="object-contain"
              priority
            />
          </Link>

          {/* Links (Hidden on mobile) */}
          <div className="hidden md:flex items-center px-4 gap-6">
            <Link href="#" className="text-sm font-medium text-white hover:text-neutral-200 transition-colors">Services</Link>
            <Link href="#" className="text-sm font-medium text-neutral-400 hover:text-white transition-colors">Process</Link>
            <Link href="#" className="text-sm font-medium text-neutral-400 hover:text-white transition-colors">Results</Link>
          </div>

          {/* CTA */}
          <a href="#contact" className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full px-4 py-2 transition-all group">
            <span className="text-sm font-medium text-white">Get Audit</span>
            <ArrowRight className="w-4 h-4 text-white group-hover:translate-x-0.5 transition-transform" />
          </a>

          <div className="ml-2">
            <ThemeToggle />
          </div>
        </div>
      </nav>

      <HeroSection />
      <FeaturesSection />
      <IntegrationsSection />
      <TestimonialsSection />
      <CTAFooter />

    </main>
  )
}

"use client"

import Link from "next/link"
import Image from "next/image"
import { ArrowRight } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"
import { MobileNav } from "@/components/mobile-nav"
import { HeroSection } from "@/components/landing/hero-section"
import { FeaturesSection } from "@/components/landing/features-section"
import { IntegrationsSection } from "@/components/landing/integrations-section"
import { TestimonialsSection } from "@/components/landing/testimonials-section"
import { CTAFooter } from "@/components/landing/cta-footer"

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[var(--color-background)] text-[var(--color-text-primary)] selection:bg-orange-200 dark:selection:bg-orange-900 selection:text-orange-800 dark:selection:text-white overflow-x-hidden transition-colors duration-300">

      {/* Navigation */}
      <nav className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-[95%] max-w-5xl">
        <div className="bg-neutral-800/50 backdrop-blur-xl border border-white/10 rounded-full p-2 pl-5 pr-2 flex items-center gap-6 animate-on-scroll">
          {/* Logo + Brand Name */}
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

          {/* Spacer */}
          <div className="flex-1" />

          {/* Links (Hidden on mobile) */}
          <div className="hidden md:flex items-center gap-6">
            <Link href="#services" className="text-sm font-medium text-neutral-300 hover:text-orange-400 transition-colors">Services</Link>
            <Link href="#process" className="text-sm font-medium text-neutral-400 hover:text-orange-400 transition-colors">How It Works</Link>
            <Link href="#results" className="text-sm font-medium text-neutral-400 hover:text-orange-400 transition-colors">Results</Link>
          </div>

          {/* Desktop CTAs (Hidden on mobile) */}
          <div className="hidden md:flex items-center gap-2">
            <a href="#contact" className="flex items-center gap-2 bg-white/10 hover:bg-orange-500/20 border border-white/10 hover:border-orange-500/30 rounded-full px-4 py-2 transition-all group">
              <span className="text-sm font-medium text-white">Free Audit</span>
              <ArrowRight className="w-4 h-4 text-white group-hover:translate-x-0.5 transition-transform" />
            </a>
            <Link href="/payment" className="flex items-center gap-2 bg-orange-500/75 hover:bg-orange-500/90 rounded-full px-4 py-2 transition-all group">
              <span className="text-sm font-medium text-white">Choose Package</span>
              <ArrowRight className="w-4 h-4 text-white group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </div>

          <div className="hidden md:block ml-1">
            <ThemeToggle />
          </div>

          {/* Mobile Hamburger Menu */}
          <MobileNav />
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

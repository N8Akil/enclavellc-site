"use client"

import { useEffect, useRef } from "react"
import Image from "next/image"
import { ArrowRight, CheckCircle2 } from "lucide-react"

export function HeroSection() {
    const observerRef = useRef<IntersectionObserver | null>(null);

    useEffect(() => {
        observerRef.current = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add("animate");
                    observerRef.current?.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1 });

        document.querySelectorAll(".animate-on-scroll").forEach((el) => {
            observerRef.current?.observe(el);
        });

        return () => observerRef.current?.disconnect();
    }, []);

    return (
        <section id="top" className="relative min-h-screen flex items-center justify-center overflow-hidden py-32 px-4">
            {/* Giant Logo Watermark */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60rem] h-[60rem] pointer-events-none z-0 opacity-[0.08] dark:opacity-[0.04]">
                <Image
                    src="/logo-icon.png"
                    alt=""
                    fill
                    className="object-contain"
                    priority
                />
            </div>

            {/* Ambient Background Glows */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80rem] h-[50rem] bg-[var(--glow-orange)] rounded-full blur-[120px] pointer-events-none z-0"></div>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40rem] h-[40rem] bg-[var(--glow-red)] rounded-full blur-[100px] pointer-events-none z-0"></div>
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[60rem] h-[40rem] bg-[var(--glow-yellow)] rounded-full blur-[120px] pointer-events-none z-0"></div>

            {/* CENTER CONTENT */}
            <div className="relative w-full max-w-4xl mx-auto flex flex-col items-center z-20">
                {/* Mobile Brand Header - Hidden on desktop where nav shows branding */}
                <div className="flex md:hidden flex-col items-center mb-8 animate-on-scroll">
                    <div className="relative w-20 h-20 mb-4">
                        <Image
                            src="/logo-icon.png"
                            alt="Enclave Development"
                            fill
                            className="object-contain"
                            priority
                        />
                    </div>
                    <h2 className="text-xl font-semibold text-[var(--color-text-primary)] tracking-tight">
                        Enclave Development
                    </h2>
                    <span className="text-sm text-[var(--color-text-secondary)]">
                        Web & Automation
                    </span>
                </div>

                {/* Badge */}
                <div className="flex gap-2 glass-card rounded-full px-4 py-1.5 items-center animate-on-scroll mb-8">
                    <div className="w-2 h-2 rounded-full bg-[var(--color-accent-orange)] animate-pulse"></div>
                    <span className="text-sm font-medium text-[var(--color-text-primary)]">
                        Professional Web Services
                    </span>
                </div>

                {/* Headline */}
                <h1 className="text-center text-4xl md:text-6xl lg:text-7xl font-semibold tracking-tight leading-[1.1] text-[var(--color-text-primary)] glow-text animate-on-scroll">
                    Modern websites and automation for small businesses.
                </h1>

                {/* Subheadline */}
                <p className="mt-8 text-lg md:text-xl text-[var(--color-text-secondary)] text-center max-w-2xl leading-relaxed font-normal animate-on-scroll">
                    We rebuild outdated websites and streamline lead follow-up so customers trust you faster—and you spend less time chasing.
                </p>

                {/* Feature bullets */}
                <div className="mt-8 flex flex-col sm:flex-row gap-4 sm:gap-8 animate-on-scroll">
                    <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-[var(--color-accent-orange)]" />
                        <span className="text-sm text-[var(--color-text-secondary)]">Fast, mobile-friendly website rebuild</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-[var(--color-accent-orange)]" />
                        <span className="text-sm text-[var(--color-text-secondary)]">Lead capture + follow-up automation</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-[var(--color-accent-orange)]" />
                        <span className="text-sm text-[var(--color-text-secondary)]">Clean design, light and dark mode</span>
                    </div>
                </div>

                {/* CTA Buttons */}
                <div className="flex flex-col sm:flex-row mt-10 gap-4 items-center animate-on-scroll">
                    {/* Primary CTA */}
                    <a href="#contact" className="group flex hover:opacity-95 transition-all duration-300 bg-orange-500/80 hover:bg-orange-500/90 w-auto rounded-full py-3 px-6 relative shadow-md gap-3 items-center overflow-hidden">
                        <span className="text-base font-semibold text-white">
                            Request a Free Audit
                        </span>
                        <ArrowRight className="w-5 h-5 text-white group-hover:translate-x-0.5 transition-transform" />
                    </a>

                    {/* Secondary CTA */}
                    <a href="#services" className="group flex items-center gap-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors py-3 px-4">
                        <span className="text-base font-medium">View Services</span>
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                    </a>
                </div>
            </div>
        </section>
    )
}

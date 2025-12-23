"use client"

import { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import Image from "next/image"
import { Menu, X, ArrowRight } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"

export function MobileNav() {
    const [isOpen, setIsOpen] = useState(false)
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)
    }, [])

    const closeMenu = () => setIsOpen(false)

    // Portal content - renders at document body level to escape nav container overflow
    const portalContent = mounted ? createPortal(
        <>
            {/* Backdrop */}
            {isOpen && (
                <div
                    className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] md:hidden"
                    onClick={closeMenu}
                />
            )}

            {/* Slide-out Panel */}
            <div
                className={`fixed top-0 right-0 h-full w-72 border-l border-white/10 z-[70] transform transition-transform duration-300 ease-in-out md:hidden shadow-2xl ${isOpen ? "translate-x-0" : "translate-x-full"
                    }`}
                style={{ backgroundColor: '#0a0a0a' }}
            >
                {/* Header with Logo and Close Button */}
                <div className="flex justify-between items-center p-4 border-b border-white/10">
                    <Link href="/" onClick={closeMenu} className="flex items-center gap-3">
                        <div className="relative w-10 h-10">
                            <Image
                                src="/logo-icon.png"
                                alt="Enclave"
                                fill
                                className="object-contain"
                            />
                        </div>
                        <div className="flex flex-col leading-tight">
                            <span className="text-white text-sm font-semibold tracking-tight">Enclave Development</span>
                            <span className="text-neutral-400 text-[10px]">Web & Automation</span>
                        </div>
                    </Link>
                    <button
                        onClick={closeMenu}
                        className="flex items-center justify-center w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                        aria-label="Close menu"
                    >
                        <X className="w-5 h-5 text-white" />
                    </button>
                </div>

                {/* Menu Content */}
                <div className="px-6 py-4 flex flex-col gap-2">
                    {/* Navigation Links */}
                    <nav className="flex flex-col gap-1">
                        <a
                            href="#services"
                            onClick={closeMenu}
                            className="text-lg font-medium text-neutral-300 hover:text-orange-400 transition-colors py-3 px-4 rounded-xl hover:bg-white/5"
                        >
                            Services
                        </a>
                        <a
                            href="#process"
                            onClick={closeMenu}
                            className="text-lg font-medium text-neutral-300 hover:text-orange-400 transition-colors py-3 px-4 rounded-xl hover:bg-white/5"
                        >
                            How It Works
                        </a>
                        <a
                            href="#results"
                            onClick={closeMenu}
                            className="text-lg font-medium text-neutral-300 hover:text-orange-400 transition-colors py-3 px-4 rounded-xl hover:bg-white/5"
                        >
                            Results
                        </a>
                    </nav>

                    {/* Divider */}
                    <div className="h-px bg-white/10 my-4" />

                    {/* CTA Buttons */}
                    <div className="flex flex-col gap-3">
                        <a
                            href="#contact"
                            onClick={closeMenu}
                            className="flex items-center justify-center gap-2 bg-white/10 hover:bg-orange-500/20 border border-white/10 hover:border-orange-500/30 rounded-xl px-4 py-3 transition-all group"
                        >
                            <span className="text-base font-medium text-white">Free Audit</span>
                            <ArrowRight className="w-4 h-4 text-white group-hover:translate-x-0.5 transition-transform" />
                        </a>
                        <Link
                            href="/payment"
                            onClick={closeMenu}
                            className="flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 rounded-xl px-4 py-3 transition-all group"
                        >
                            <span className="text-base font-medium text-white">Choose Package</span>
                            <ArrowRight className="w-4 h-4 text-white group-hover:translate-x-0.5 transition-transform" />
                        </Link>
                    </div>

                    {/* Divider */}
                    <div className="h-px bg-white/10 my-4" />

                    {/* Theme Toggle */}
                    <div className="flex items-center justify-between px-4 py-2">
                        <span className="text-sm text-neutral-400">Theme</span>
                        <ThemeToggle />
                    </div>
                </div>
            </div>
        </>,
        document.body
    ) : null

    return (
        <>
            {/* Hamburger Button - Only visible on mobile */}
            <button
                onClick={() => setIsOpen(true)}
                className="md:hidden flex items-center justify-center w-10 h-10 rounded-full bg-white/10 border border-white/10 hover:bg-orange-500/20 transition-colors"
                aria-label="Open menu"
            >
                <Menu className="w-5 h-5 text-white" />
            </button>

            {portalContent}
        </>
    )
}
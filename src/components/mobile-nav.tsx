"use client"

import { useState } from "react"
import Link from "next/link"
import { Menu, X, ArrowRight } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"

export function MobileNav() {
    const [isOpen, setIsOpen] = useState(false)

    const closeMenu = () => setIsOpen(false)

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

            {/* Backdrop */}
            {isOpen && (
                <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] md:hidden"
                    onClick={closeMenu}
                />
            )}

            {/* Slide-out Panel */}
            <div
                className={`fixed top-0 right-0 h-full w-72 bg-neutral-900 border-l border-white/10 z-[70] transform transition-transform duration-300 ease-in-out md:hidden ${isOpen ? "translate-x-0" : "translate-x-full"
                    }`}
            >
                {/* Header with Theme Toggle and Close Button */}
                <div className="flex justify-between items-center p-4">
                    <ThemeToggle />
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
                </div>
            </div>
        </>
    )
}

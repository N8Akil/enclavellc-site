"use client"

import { ContactForm } from "@/components/contact-form"
import { ArrowRight } from "lucide-react"

export function CTAFooter() {
    return (
        <footer id="contact" className="overflow-hidden md:px-10 bg-neutral-950 w-full max-w-7xl border-white/5 border rounded-3xl mt-24 mx-auto mb-12 px-10 relative">

            {/* Giant Heading Section */}
            <div className="md:pt-24 md:pb-12 flex overflow-hidden w-full border-white/5 border-b pt-16 pb-8 items-center justify-center animate-on-scroll">
                <h1 className="text-[13vw] md:text-[200px] leading-[0.8] whitespace-nowrap select-none text-4xl font-semibold text-white/10 tracking-tighter">
                    get started
                </h1>
            </div>

            <div className="px-6 pt-16 pb-12 md:px-4 relative z-10 animate-on-scroll">
                <div className="flex flex-col lg:flex-row justify-between gap-16 lg:gap-12">

                    {/* Contact Form Column */}
                    <div className="lg:w-1/2 max-w-2xl flex flex-col items-start justify-center">
                        <h2 className="text-3xl sm:text-4xl md:text-5xl font-medium tracking-tight mb-6 leading-[1.1]">
                            <span className="text-neutral-500">Ready to upgrade</span>
                            <span className="text-white block">your business?</span>
                        </h2>
                        <p className="text-neutral-400 text-lg mb-8 max-w-md">
                            Digital overhauls and automated systems, delivered without the headache.
                        </p>

                        <div className="w-full bg-neutral-900/50 border border-white/10 rounded-2xl p-6">
                            <ContactForm />
                        </div>
                    </div>

                    {/* Links Columns */}
                    <div className="flex flex-col sm:flex-row gap-16 lg:gap-24 lg:mr-10 pt-10 lg:pt-0">
                        <div className="flex flex-col gap-5">
                            <h3 className="text-white text-sm font-semibold">Services</h3>
                            <nav className="flex flex-col gap-3">
                                <a href="#" className="text-neutral-400 hover:text-white transition-colors text-sm font-medium">Website Rebuilds</a>
                                <a href="#" className="text-neutral-400 hover:text-white transition-colors text-sm font-medium">Automation Setup</a>
                                <a href="#" className="text-neutral-400 hover:text-white transition-colors text-sm font-medium">Content Strategy</a>
                            </nav>
                        </div>

                        <div className="flex flex-col gap-5">
                            <h3 className="text-white text-sm font-semibold">Company</h3>
                            <nav className="flex flex-col gap-3">
                                <a href="#" className="text-neutral-400 hover:text-white transition-colors text-sm font-medium">About</a>
                                <a href="#" className="text-neutral-400 hover:text-white transition-colors text-sm font-medium">Contact</a>
                                <a href="mailto:n.garrett@enclavellc.net" className="text-neutral-400 hover:text-white transition-colors text-sm font-medium">Email Us</a>
                            </nav>
                        </div>
                    </div>
                </div>

                {/* Bottom Bar */}
                <div className="mt-20 pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center text-xs text-neutral-500 font-medium gap-6 md:gap-4">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-neutral-900 border border-white/5">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                            <span className="text-neutral-300">Enclave Systems Operational</span>
                        </div>
                    </div>
                    <div className="text-center md:text-right">
                        <p>© 2025 Enclave LLC.</p>
                    </div>
                </div>
            </div>

            {/* Ambient Glow */}
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[40rem] h-[20rem] bg-orange-500/10 blur-[100px] pointer-events-none rounded-full"></div>
        </footer>
    )
}

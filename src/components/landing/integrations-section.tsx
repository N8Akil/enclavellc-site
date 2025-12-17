"use client"

import { Mail, Database, MessageSquare } from "lucide-react"

export function IntegrationsSection() {
    return (
        <section className="overflow-hidden md:px-10 md:pb-0 bg-neutral-950 w-full max-w-7xl border-white/5 border rounded-3xl mt-24 mx-auto pt-24 pr-6 pb-24 pl-6 relative">
            {/* Background Text */}
            <div className="-translate-x-1/2 z-0 pointer-events-none select-none text-center w-full absolute top-24 left-1/2" style={{ maskImage: "linear-gradient(180deg, transparent, black 0%, black 60%, transparent)", WebkitMaskImage: "linear-gradient(180deg, transparent, black 0%, black 60%, transparent)" }}>
                <span className="text-[10vw] lg:text-[12rem] leading-none whitespace-nowrap font-bold text-white/5 tracking-tighter">
                    Integrations
                </span>
            </div>

            <div className="z-10 relative">
                <div className="flex flex-col lg:flex-row gap-8 text-left mb-20 relative gap-x-8 gap-y-8 justify-between animate-on-scroll">
                    <div className="max-w-2xl">
                        <h2 className="md:text-6xl leading-tight text-5xl font-semibold text-white tracking-tight">Connects with everything.</h2>
                    </div>
                    <div className="max-w-md">
                        <p className="leading-relaxed text-lg font-light text-neutral-400">
                            Our solutions integrate smoothly with the tools you already use every day.
                        </p>
                    </div>
                </div>

                {/* Integrations Grid / Flow */}
                <div className="relative w-full max-w-6xl mx-auto flex flex-col items-center z-10 pt-24">

                    {/* Top Pill */}
                    <div className="relative z-20 mb-20 md:mb-28 animate-on-scroll">
                        <div className="px-8 py-3 rounded-full bg-[#0F0F0F] border border-white/10 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.5)] flex items-center justify-center relative backdrop-blur-sm">
                            <span className="text-neutral-300 font-medium text-sm tracking-wide">Built with</span>
                            {/* Connection Ports */}
                            <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 flex gap-4 pointer-events-none">
                                <div className="w-1 h-1 rounded-full bg-neutral-600 shadow-[0_0_5px_rgba(255,255,255,0.2)]"></div>
                                <div className="w-1 h-1 rounded-full bg-neutral-600 shadow-[0_0_5px_rgba(255,255,255,0.2)]"></div>
                                <div className="w-1 h-1 rounded-full bg-neutral-600 shadow-[0_0_5px_rgba(255,255,255,0.2)]"></div>
                            </div>
                        </div>
                    </div>

                    {/* SVG Connecting Lines */}
                    <svg className="absolute top-[48px] left-0 w-full h-[120px] z-0 pointer-events-none overflow-visible hidden md:block" preserveAspectRatio="none" viewBox="0 0 1200 120">
                        <defs>
                            {/* Left Gradient (Orange) */}
                            <linearGradient id="grad-left" gradientUnits="userSpaceOnUse" x1="600" y1="0" x2="200" y2="120">
                                <stop offset="0" stopColor="#f97316" stopOpacity="0" />
                                <stop offset="0.5" stopColor="#f97316" />
                                <stop offset="1" stopColor="#f97316" stopOpacity="0" />
                            </linearGradient>
                            {/* Center Gradient (Red) */}
                            <linearGradient id="grad-center" gradientUnits="userSpaceOnUse" x1="600" y1="0" x2="600" y2="120">
                                <stop offset="0" stopColor="#ef4444" stopOpacity="0" />
                                <stop offset="0.5" stopColor="#ef4444" />
                                <stop offset="1" stopColor="#ef4444" stopOpacity="0" />
                            </linearGradient>
                            {/* Right Gradient (Yellow) */}
                            <linearGradient id="grad-right" gradientUnits="userSpaceOnUse" x1="600" y1="0" x2="1000" y2="120">
                                <stop offset="0" stopColor="#eab308" stopOpacity="0" />
                                <stop offset="0.5" stopColor="#eab308" />
                                <stop offset="1" stopColor="#eab308" stopOpacity="0" />
                            </linearGradient>
                        </defs>

                        {/* Tracks */}
                        <path d="M 600 0 C 600 60, 200 60, 200 120" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1.5" />
                        <path d="M 600 0 L 600 120" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1.5" />
                        <path d="M 600 0 C 600 60, 1000 60, 1000 120" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1.5" />

                        {/* Animated Lines */}
                        <path d="M 600 0 C 600 60, 200 60, 200 120" fill="none" stroke="url(#grad-left)" strokeWidth="2" className="animate-[flow-line_4s_linear_infinite]" strokeLinecap="round" />
                        <path d="M 600 0 L 600 120" fill="none" stroke="url(#grad-center)" strokeWidth="2" className="animate-[flow-line_4s_linear_infinite]" strokeLinecap="round" style={{ animationDelay: "1s" }} />
                        <path d="M 600 0 C 600 60, 1000 60, 1000 120" fill="none" stroke="url(#grad-right)" strokeWidth="2" className="animate-[flow-line_4s_linear_infinite]" strokeLinecap="round" style={{ animationDelay: "2s" }} />
                    </svg>

                    {/* Cards Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 z-10 w-full relative">

                        {/* Gmail */}
                        <div className="glass-card rounded-2xl p-6 relative group transition-all duration-300 hover:bg-neutral-900/80 animate-on-scroll">
                            <div className="absolute -top-px left-1/2 -translate-x-1/2 w-1/2 h-[1px] bg-gradient-to-r from-transparent via-orange-500/50 to-transparent opacity-100"></div>
                            <div className="flex items-center gap-4 mb-8">
                                <div className="w-12 h-12 rounded-xl bg-[#1a1a1a] border border-white/10 flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
                                    <Mail className="w-6 h-6 text-white" />
                                </div>
                                <h3 className="text-lg font-medium text-white">Gmail</h3>
                            </div>
                            <p className="text-neutral-500 text-sm leading-relaxed font-normal">
                                Automated follow-ups and lead notifications straight to your inbox.
                            </p>
                        </div>

                        {/* Google Sheets */}
                        <div className="glass-card rounded-2xl p-6 relative group transition-all duration-300 hover:bg-neutral-900/80 animate-on-scroll">
                            <div className="absolute -top-px left-1/2 -translate-x-1/2 w-1/2 h-[1px] bg-gradient-to-r from-transparent via-red-500/50 to-transparent opacity-100"></div>
                            <div className="flex items-center gap-4 mb-8">
                                <div className="w-12 h-12 rounded-xl bg-[#1a1a1a] border border-white/10 flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
                                    <Database className="w-6 h-6 text-white" />
                                </div>
                                <h3 className="text-lg font-medium text-white">Sheets / Airtable</h3>
                            </div>
                            <p className="text-neutral-500 text-sm leading-relaxed font-normal">
                                Keep a live database of all your leads and customer data.
                            </p>
                        </div>

                        {/* Slack */}
                        <div className="glass-card rounded-2xl p-6 relative group transition-all duration-300 hover:bg-neutral-900/80 animate-on-scroll">
                            <div className="absolute -top-px left-1/2 -translate-x-1/2 w-1/2 h-[1px] bg-gradient-to-r from-transparent via-yellow-500/50 to-transparent opacity-100"></div>
                            <div className="flex items-center gap-4 mb-8">
                                <div className="w-12 h-12 rounded-xl bg-[#1a1a1a] border border-white/10 flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
                                    <MessageSquare className="w-6 h-6 text-white" />
                                </div>
                                <h3 className="text-lg font-medium text-white">Slack</h3>
                            </div>
                            <p className="text-neutral-500 text-sm leading-relaxed font-normal">
                                Instant team alerts when high-priority forms are submitted.
                            </p>
                        </div>

                    </div>
                </div>
            </div>
        </section>
    )
}

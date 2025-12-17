"use client"

import { Mail, Calendar, Database, MessageCircle } from "lucide-react"

export function IntegrationsSection() {
    return (
        <section className="scroll-mt-24 overflow-hidden md:px-10 md:pb-0 bg-[var(--color-surface)] w-full max-w-7xl border border-[var(--color-border)] rounded-3xl mt-24 mx-auto pt-24 pr-6 pb-24 pl-6 relative">
            {/* Background Text */}
            <div className="-translate-x-1/2 z-0 pointer-events-none select-none text-center w-full absolute top-24 left-1/2" style={{ maskImage: "linear-gradient(180deg, transparent, black 0%, black 60%, transparent)", WebkitMaskImage: "linear-gradient(180deg, transparent, black 0%, black 60%, transparent)" }}>
                <span className="text-[10vw] lg:text-[12rem] leading-none whitespace-nowrap font-bold text-[var(--color-text-primary)] opacity-[0.03] tracking-tighter">
                    Tools
                </span>
            </div>

            <div className="z-10 relative">
                <div className="flex flex-col lg:flex-row gap-8 text-left mb-16 relative gap-x-8 gap-y-8 justify-between animate-on-scroll">
                    <div className="max-w-2xl">
                        <h2 className="md:text-6xl leading-tight text-5xl font-semibold text-[var(--color-text-primary)] tracking-tight">Works With What You Already Use</h2>
                    </div>
                    <div className="max-w-md">
                        <p className="leading-relaxed text-lg font-light text-[var(--color-text-secondary)]">
                            Email, calendars, spreadsheets, and your current tools. We plug in cleanly—no drama.
                        </p>
                    </div>
                </div>

                {/* Tool Pills Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 z-10 w-full relative animate-on-scroll">

                    {/* Gmail */}
                    <div className="glass-card rounded-xl p-5 flex items-center gap-4 transition-all duration-300 hover:scale-[1.02]">
                        <div className="w-12 h-12 rounded-xl bg-[var(--color-accent-orange-dim)] flex items-center justify-center">
                            <Mail className="w-6 h-6 text-[var(--color-accent-orange)]" />
                        </div>
                        <div>
                            <h3 className="text-base font-medium text-[var(--color-text-primary)]">Gmail</h3>
                            <p className="text-xs text-[var(--color-text-muted)]">Email notifications</p>
                        </div>
                    </div>

                    {/* Google Calendar */}
                    <div className="glass-card rounded-xl p-5 flex items-center gap-4 transition-all duration-300 hover:scale-[1.02]">
                        <div className="w-12 h-12 rounded-xl bg-[var(--color-accent-red-dim)] flex items-center justify-center">
                            <Calendar className="w-6 h-6 text-[var(--color-accent-red)]" />
                        </div>
                        <div>
                            <h3 className="text-base font-medium text-[var(--color-text-primary)]">Calendar</h3>
                            <p className="text-xs text-[var(--color-text-muted)]">Scheduling sync</p>
                        </div>
                    </div>

                    {/* Sheets / Airtable */}
                    <div className="glass-card rounded-xl p-5 flex items-center gap-4 transition-all duration-300 hover:scale-[1.02]">
                        <div className="w-12 h-12 rounded-xl bg-[var(--color-accent-yellow-dim)] flex items-center justify-center">
                            <Database className="w-6 h-6 text-[var(--color-accent-yellow)]" />
                        </div>
                        <div>
                            <h3 className="text-base font-medium text-[var(--color-text-primary)]">Sheets</h3>
                            <p className="text-xs text-[var(--color-text-muted)]">Lead tracking</p>
                        </div>
                    </div>

                    {/* SMS / Messaging */}
                    <div className="glass-card rounded-xl p-5 flex items-center gap-4 transition-all duration-300 hover:scale-[1.02]">
                        <div className="w-12 h-12 rounded-xl bg-[var(--color-accent-orange-dim)] flex items-center justify-center">
                            <MessageCircle className="w-6 h-6 text-[var(--color-accent-orange)]" />
                        </div>
                        <div>
                            <h3 className="text-base font-medium text-[var(--color-text-primary)]">SMS</h3>
                            <p className="text-xs text-[var(--color-text-muted)]">Text follow-ups</p>
                        </div>
                    </div>

                </div>

                {/* Simple subtext */}
                <p className="mt-8 text-center text-sm text-[var(--color-text-muted)] animate-on-scroll">
                    We work with Google Workspace, Airtable, Slack, and most common business tools.
                </p>
            </div>
        </section>
    )
}

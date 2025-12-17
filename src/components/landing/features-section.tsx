"use client"

import { Globe, Zap, FileText, ClipboardCheck, Wrench, Rocket, Camera, Share2, Search } from "lucide-react"

export function FeaturesSection() {
    return (
        <>
            {/* Services Section */}
            <section id="services" className="scroll-mt-24 md:px-10 overflow-hidden bg-[var(--color-surface)] w-full max-w-7xl border border-[var(--color-border)] rounded-3xl mt-24 mx-auto pt-24 pr-6 pb-24 pl-6 relative">
                {/* Background Text */}
                <div className="-translate-x-1/2 z-0 pointer-events-none select-none text-center w-full absolute top-24 left-1/2" style={{ maskImage: "linear-gradient(180deg, transparent, black 0%, black 60%, transparent)", WebkitMaskImage: "linear-gradient(180deg, transparent, black 0%, black 60%, transparent)" }}>
                    <span className="text-[12vw] lg:text-[15rem] leading-none whitespace-nowrap font-bold text-[var(--color-text-primary)] opacity-[0.03] tracking-tighter">
                        Services
                    </span>
                </div>

                <div className="flex flex-col lg:flex-row text-left z-10 mb-20 relative gap-x-8 gap-y-8 justify-between animate-on-scroll">
                    <div className="max-w-2xl lg:text-left">
                        <h2 className="leading-[1.05] md:text-6xl text-5xl font-bold text-[var(--color-text-primary)] tracking-tight">
                            Services
                        </h2>
                    </div>
                    <div className="max-w-md lg:text-right">
                        <p className="md:text-lg leading-relaxed text-base font-light text-[var(--color-text-secondary)]">
                            Practical ways we modernize your business without adding complexity.
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 z-10 mt-16 pt-0 relative gap-8">

                    {/* Service 1: Website Audit (FREE) */}
                    <div className="group glass-card flex flex-col transition-all duration-500 overflow-hidden h-auto rounded-2xl p-6 relative animate-on-scroll">
                        <div className="absolute top-4 right-4 bg-neutral-500/20 text-neutral-400 text-xs font-bold px-2 py-1 rounded-full">
                            FREE
                        </div>
                        <div className="w-14 h-14 rounded-xl bg-neutral-500/10 flex items-center justify-center mb-6">
                            <Search className="w-7 h-7 text-neutral-400" />
                        </div>
                        <h3 className="text-xl font-semibold text-[var(--color-text-primary)] tracking-tight mb-3">Website Audit</h3>
                        <ul className="space-y-2 text-[var(--color-text-secondary)] text-sm leading-relaxed">
                            <li className="flex items-start gap-2">
                                <span className="text-neutral-400 mt-1">•</span>
                                <span>Full site performance analysis</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-neutral-400 mt-1">•</span>
                                <span>Lead capture assessment</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-neutral-400 mt-1">•</span>
                                <span>Actionable recommendations</span>
                            </li>
                        </ul>
                    </div>

                    {/* Service 2: Content Creation ($999/mo) */}
                    <div className="group glass-card flex flex-col transition-all duration-500 overflow-hidden h-auto rounded-2xl p-6 relative animate-on-scroll">
                        <div className="w-14 h-14 rounded-xl bg-purple-500/10 flex items-center justify-center mb-6">
                            <Camera className="w-7 h-7 text-purple-500" />
                        </div>
                        <h3 className="text-xl font-semibold text-[var(--color-text-primary)] tracking-tight mb-3">Content Creation</h3>
                        <ul className="space-y-2 text-[var(--color-text-secondary)] text-sm leading-relaxed">
                            <li className="flex items-start gap-2">
                                <span className="text-purple-500 mt-1">•</span>
                                <span>4 blog posts per month</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-purple-500 mt-1">•</span>
                                <span>Social media graphics</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-purple-500 mt-1">•</span>
                                <span>Email newsletter copy</span>
                            </li>
                        </ul>
                    </div>

                    {/* Service 3: Social Media Management ($1,299/mo) */}
                    <div className="group glass-card flex flex-col transition-all duration-500 overflow-hidden h-auto rounded-2xl p-6 relative animate-on-scroll">
                        <div className="w-14 h-14 rounded-xl bg-blue-500/10 flex items-center justify-center mb-6">
                            <Share2 className="w-7 h-7 text-blue-500" />
                        </div>
                        <h3 className="text-xl font-semibold text-[var(--color-text-primary)] tracking-tight mb-3">Social Media Management</h3>
                        <ul className="space-y-2 text-[var(--color-text-secondary)] text-sm leading-relaxed">
                            <li className="flex items-start gap-2">
                                <span className="text-blue-500 mt-1">•</span>
                                <span>3 platforms managed</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-blue-500 mt-1">•</span>
                                <span>Daily posting schedule</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-blue-500 mt-1">•</span>
                                <span>Community engagement + analytics</span>
                            </li>
                        </ul>
                    </div>

                    {/* Service 4: Automation Setup ($1,499) */}
                    <div className="group glass-card flex flex-col transition-all duration-500 overflow-hidden h-auto rounded-2xl p-6 relative animate-on-scroll">
                        <div className="w-14 h-14 rounded-xl bg-[var(--color-accent-red-dim)] flex items-center justify-center mb-6">
                            <Zap className="w-7 h-7 text-[var(--color-accent-red)]" />
                        </div>
                        <h3 className="text-xl font-semibold text-[var(--color-text-primary)] tracking-tight mb-3">Automation Setup</h3>
                        <ul className="space-y-2 text-[var(--color-text-secondary)] text-sm leading-relaxed">
                            <li className="flex items-start gap-2">
                                <span className="text-[var(--color-accent-red)] mt-1">•</span>
                                <span>Forms → notifications → follow-up</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-[var(--color-accent-red)] mt-1">•</span>
                                <span>Scheduling + intake flow</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-[var(--color-accent-red)] mt-1">•</span>
                                <span>Fewer missed leads, less admin work</span>
                            </li>
                        </ul>
                    </div>

                    {/* Service 5: Website Rebuild ($2,499) */}
                    <div className="group glass-card flex flex-col transition-all duration-500 overflow-hidden h-auto rounded-2xl p-6 relative animate-on-scroll">
                        <div className="w-14 h-14 rounded-xl bg-[var(--color-accent-orange-dim)] flex items-center justify-center mb-6">
                            <Globe className="w-7 h-7 text-[var(--color-accent-orange)]" />
                        </div>
                        <h3 className="text-xl font-semibold text-[var(--color-text-primary)] tracking-tight mb-3">Website Rebuild</h3>
                        <ul className="space-y-2 text-[var(--color-text-secondary)] text-sm leading-relaxed">
                            <li className="flex items-start gap-2">
                                <span className="text-[var(--color-accent-orange)] mt-1">•</span>
                                <span>Modern design (mobile-first)</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-[var(--color-accent-orange)] mt-1">•</span>
                                <span>Faster load times + SEO basics</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-[var(--color-accent-orange)] mt-1">•</span>
                                <span>Built to convert calls and form submissions</span>
                            </li>
                        </ul>
                    </div>

                    {/* Service 6: Full Digital Overhaul ($3,499) */}
                    <div className="group glass-card flex flex-col transition-all duration-500 overflow-hidden h-auto rounded-2xl p-6 relative animate-on-scroll">
                        <div className="w-14 h-14 rounded-xl bg-[var(--color-accent-yellow-dim)] flex items-center justify-center mb-6">
                            <FileText className="w-7 h-7 text-[var(--color-accent-yellow)]" />
                        </div>
                        <h3 className="text-xl font-semibold text-[var(--color-text-primary)] tracking-tight mb-3">Full Digital Overhaul</h3>
                        <ul className="space-y-2 text-[var(--color-text-secondary)] text-sm leading-relaxed">
                            <li className="flex items-start gap-2">
                                <span className="text-[var(--color-accent-yellow)] mt-1">•</span>
                                <span>Website rebuild + automation</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-[var(--color-accent-yellow)] mt-1">•</span>
                                <span>Professional copywriting</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-[var(--color-accent-yellow)] mt-1">•</span>
                                <span>Priority support for 30 days</span>
                            </li>
                        </ul>
                    </div>

                </div>
            </section>

            {/* How It Works Section */}
            <section id="process" className="scroll-mt-24 md:px-10 overflow-hidden bg-[var(--color-background)] w-full max-w-7xl border border-[var(--color-border)] rounded-3xl mt-24 mx-auto pt-24 pr-6 pb-24 pl-6 relative">
                {/* Background Text */}
                <div className="-translate-x-1/2 z-0 pointer-events-none select-none text-center w-full absolute top-24 left-1/2" style={{ maskImage: "linear-gradient(180deg, transparent, black 0%, black 60%, transparent)", WebkitMaskImage: "linear-gradient(180deg, transparent, black 0%, black 60%, transparent)" }}>
                    <span className="text-[12vw] lg:text-[15rem] leading-none whitespace-nowrap font-bold text-[var(--color-text-primary)] opacity-[0.03] tracking-tighter">
                        Process
                    </span>
                </div>

                <div className="flex flex-col lg:flex-row text-left z-10 mb-20 relative gap-x-8 gap-y-8 justify-between animate-on-scroll">
                    <div className="max-w-2xl lg:text-left">
                        <h2 className="leading-[1.05] md:text-6xl text-5xl font-bold text-[var(--color-text-primary)] tracking-tight">
                            How It Works
                        </h2>
                    </div>
                    <div className="max-w-md lg:text-right">
                        <p className="md:text-lg leading-relaxed text-base font-light text-[var(--color-text-secondary)]">
                            A straightforward engagement from assessment to launch.
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 z-10 mt-16 pt-0 relative gap-8">

                    {/* Step 1: Audit */}
                    <div className="group glass-card flex flex-col transition-all duration-500 overflow-hidden h-auto rounded-2xl p-6 relative animate-on-scroll">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="w-10 h-10 rounded-full bg-[var(--color-accent-orange)] flex items-center justify-center text-white font-bold">
                                1
                            </div>
                            <ClipboardCheck className="w-6 h-6 text-[var(--color-accent-orange)]" />
                        </div>
                        <h3 className="text-xl font-semibold text-[var(--color-text-primary)] tracking-tight mb-3">Audit</h3>
                        <p className="text-[var(--color-text-secondary)] text-sm leading-relaxed">
                            We review your site and your lead process. You get a clear punch list of what needs to change.
                        </p>
                    </div>

                    {/* Step 2: Build */}
                    <div className="group glass-card flex flex-col transition-all duration-500 overflow-hidden h-auto rounded-2xl p-6 relative animate-on-scroll">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="w-10 h-10 rounded-full bg-[var(--color-accent-red)] flex items-center justify-center text-white font-bold">
                                2
                            </div>
                            <Wrench className="w-6 h-6 text-[var(--color-accent-red)]" />
                        </div>
                        <h3 className="text-xl font-semibold text-[var(--color-text-primary)] tracking-tight mb-3">Build</h3>
                        <p className="text-[var(--color-text-secondary)] text-sm leading-relaxed">
                            We rebuild the site and wire up automation that fits your business. You stay in the loop without doing the work.
                        </p>
                    </div>

                    {/* Step 3: Launch */}
                    <div className="group glass-card flex flex-col transition-all duration-500 overflow-hidden h-auto rounded-2xl p-6 relative animate-on-scroll">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="w-10 h-10 rounded-full bg-[var(--color-accent-yellow)] flex items-center justify-center text-white font-bold">
                                3
                            </div>
                            <Rocket className="w-6 h-6 text-[var(--color-accent-yellow)]" />
                        </div>
                        <h3 className="text-xl font-semibold text-[var(--color-text-primary)] tracking-tight mb-3">Launch</h3>
                        <p className="text-[var(--color-text-secondary)] text-sm leading-relaxed">
                            We go live cleanly. You get a setup that's easy to run and maintain going forward.
                        </p>
                    </div>

                </div>
            </section>
        </>
    )
}

"use client"

import { RadioReceiver, Sparkles, Zap, Plus, ArrowRight } from "lucide-react"

export function FeaturesSection() {
    return (
        <section className="md:px-10 overflow-hidden bg-neutral-950 w-full max-w-7xl border-white/5 border rounded-3xl mt-24 mx-auto pt-24 pr-6 pb-24 pl-6 relative">
            {/* Background Text */}
            <div className="-translate-x-1/2 z-0 pointer-events-none select-none text-center w-full absolute top-24 left-1/2" style={{ maskImage: "linear-gradient(180deg, transparent, black 0%, black 60%, transparent)", WebkitMaskImage: "linear-gradient(180deg, transparent, black 0%, black 60%, transparent)" }}>
                <span className="text-[12vw] lg:text-[15rem] leading-none whitespace-nowrap font-bold text-white/5 tracking-tighter">
                    Capabilities
                </span>
            </div>

            <div className="flex flex-col lg:flex-row text-left z-10 mb-20 relative gap-x-8 gap-y-8 justify-between animate-on-scroll">
                <div className="max-w-2xl lg:text-left">
                    <h2 className="leading-[1.05] md:text-6xl text-5xl font-bold text-white tracking-tight">
                        Our Services
                    </h2>
                </div>
                <div className="max-w-md lg:text-right">
                    <p className="md:text-lg leading-relaxed text-base font-light text-neutral-400">
                        Discover the cutting-edge capabilities designed to transform your business operations.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 z-10 mt-32 pt-0 relative gap-x-8 gap-y-6">

                {/* CARD 1: Growth / Chart */}
                <div className="group flex flex-col transition-all duration-500 overflow-hidden shadow-black/50 bg-gradient-to-r from-white/10 to-white/0 h-[540px] rounded-2xl p-2 relative shadow-2xl backdrop-blur-md animate-on-scroll">
                    <div className="overflow-hidden flex-1 bg-gradient-to-br from-black/10 to-black/0 w-full rounded-xl mb-4 relative border border-white/10">
                        <div className="overflow-hidden w-full h-full relative" style={{ maskImage: "linear-gradient(90deg, transparent, black 0%, black 80%, transparent)" }}>
                            {/* Badge */}
                            <div className="absolute top-4 left-4 px-3 py-1.5 bg-black/70 border border-white/10 rounded-full text-xs text-white shadow-xl backdrop-blur-sm z-20 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse"></span>
                                <span>Performance: +42%</span>
                            </div>

                            {/* SVG Graph */}
                            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 500 260" preserveAspectRatio="none">
                                {/* Grid */}
                                <g stroke="#636b7a" strokeWidth="0.5" opacity="0.15">
                                    <path d="M0 40 H500" />
                                    <path d="M0 80 H500" />
                                    <path d="M0 120 H500" />
                                    <path d="M0 160 H500" />
                                    <path d="M0 200 H500" />
                                </g>

                                {/* Orange Curve (Main) */}
                                <path d="M0,180 C80,165 150,130 220,125 C290,120 340,130 390,148 C440,160 470,182 500,188"
                                    fill="none"
                                    stroke="#f97316"
                                    strokeWidth="2.5"
                                    className="animate-[draw-chart-line_2.5s_cubic-bezier(0.25,0.46,0.45,0.94)_forwards]"
                                />
                                {/* Fill Area */}
                                <path d="M0,180 C80,165 150,130 220,125 C290,120 340,130 390,148 C440,160 470,182 500,188 L500,260 L0,260 Z"
                                    fill="#f97316"
                                    fillOpacity="0.15"
                                    className="opacity-0 animate-[fade-in-chart_1.5s_ease-out_0.5s_forwards]"
                                />
                            </svg>
                        </div>
                    </div>
                    <div className="z-20 p-4 relative">
                        <h3 className="text-2xl font-semibold text-white tracking-tight mb-2">Results Driven</h3>
                        <p className="text-sm text-neutral-400 leading-relaxed font-light">
                            Websites designed to convert. Analytics proving the value.
                        </p>
                    </div>
                </div>

                {/* CARD 2: Workflow Steps */}
                <div className="group flex flex-col transition-all duration-500 overflow-hidden shadow-black/50 bg-gradient-to-r from-white/10 to-white/0 h-[540px] rounded-2xl p-2 relative shadow-2xl backdrop-blur-md animate-on-scroll">
                    <div className="flex-1 overflow-y-auto custom-scrollbar bg-neutral-950/40 rounded-lg p-4 relative border border-white/10">
                        <div className="relative flex flex-col items-center w-full max-w-md mx-auto">
                            {/* Step 1 */}
                            <div className="flex gap-3 bg-gradient-to-b from-black/10 to-black/0 w-full border border-white/10 rounded-xl px-4 py-3 relative shadow-lg items-center">
                                <div className="w-10 h-10 rounded-xl bg-neutral-700 flex items-center justify-center text-neutral-300 border border-white/10">
                                    <RadioReceiver className="w-5 h-5" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-xs uppercase tracking-[0.18em] text-white/40">Step 1</span>
                                    <span className="text-base font-medium text-white">Audit</span>
                                </div>
                            </div>
                            {/* Connector */}
                            <div className="flex w-full mt-4 mb-4 relative justify-center">
                                <div className="absolute inset-y-0 w-px bg-white/10"></div>
                                <div className="z-10 w-8 h-8 rounded-full bg-orange-600 flex items-center justify-center text-white ring-2 ring-neutral-800/80">
                                    <Plus className="w-4 h-4" />
                                </div>
                            </div>
                            {/* Step 2 */}
                            <div className="flex gap-3 bg-gradient-to-b from-black/10 to-black/0 w-full border border-orange-500/30 rounded-xl px-4 py-3 relative shadow-lg items-center">
                                <div className="w-10 h-10 rounded-xl bg-orange-600/20 flex items-center justify-center text-orange-300 border border-orange-600/30">
                                    <Sparkles className="w-5 h-5" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-xs uppercase tracking-[0.18em] text-orange-300/70">Core Phase</span>
                                    <span className="text-base font-medium text-white">Build & Automate</span>
                                </div>
                            </div>
                            {/* Connector */}
                            <div className="flex w-full mt-4 mb-4 relative justify-center">
                                <div className="absolute inset-y-0 w-px bg-white/10"></div>
                                <div className="z-10 w-8 h-8 rounded-full bg-orange-600 flex items-center justify-center text-white ring-2 ring-neutral-800/80">
                                    <Plus className="w-4 h-4" />
                                </div>
                            </div>
                            {/* Step 3 */}
                            <div className="flex gap-3 bg-gradient-to-b from-black/10 to-black/0 w-full border border-white/10 rounded-xl px-4 py-3 relative shadow-lg items-center">
                                <div className="w-10 h-10 rounded-xl bg-neutral-700 flex items-center justify-center text-neutral-200 border border-white/10">
                                    <Zap className="w-5 h-5" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-xs uppercase tracking-[0.18em] text-white/40">Step 3</span>
                                    <span className="text-base font-medium text-white">Launch & Scale</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="z-20 p-4 relative">
                        <h3 className="text-2xl font-semibold text-white tracking-tight mb-2">Process</h3>
                        <p className="text-sm text-neutral-400 leading-relaxed font-light">
                            Simple 3-step execution to modernize your business.
                        </p>
                    </div>
                </div>

                {/* CARD 3: Semantic/Data */}
                <div className="group flex flex-col transition-all duration-500 overflow-hidden shadow-black/50 bg-gradient-to-r from-white/10 to-white/0 h-[540px] rounded-2xl p-2 relative shadow-2xl backdrop-blur-md animate-on-scroll">
                    <div className="flex-1 overflow-y-auto custom-scrollbar bg-neutral-950/40 rounded-lg p-4 border border-white/10">
                        {/* Abstract Grid Visualization */}
                        <div className="grid grid-cols-3 gap-2.5">
                            <div className="aspect-[3/2] rounded-lg border border-white/5 bg-white/[0.01]"></div>
                            <div className="aspect-[3/2] rounded-lg border border-white/10 bg-white/[0.02] flex flex-col justify-center px-2.5 py-2 gap-1.5">
                                <div className="h-0.5 w-3 bg-neutral-600 rounded-full"></div>
                                <div className="h-0.5 w-full bg-neutral-700/50 rounded-full"></div>
                            </div>
                            <div className="aspect-[3/2] rounded-lg border border-white/5 bg-white/[0.01]"></div>

                            {/* Highlighted Tile */}
                            <div className="col-span-1 aspect-[3/2] rounded-lg border border-white/20 bg-white/[0.06] flex flex-col justify-center px-2.5 py-2 gap-1.5 shadow-[0_0_20px_-8px_rgba(255,255,255,0.2)] relative">
                                <div className="h-0.5 w-3 bg-neutral-400 rounded-full"></div>
                                <div className="h-0.5 w-full bg-neutral-600 rounded-full"></div>
                                <div className="absolute -right-3.5 top-1/2 -translate-y-1/2 w-7 h-7 bg-neutral-800 rounded-full border border-white/10 flex items-center justify-center shadow-lg z-20">
                                    <ArrowRight className="w-3 h-3 text-white" />
                                </div>
                            </div>

                            <div className="aspect-[3/2] rounded-lg border border-white/5 bg-white/[0.01]"></div>
                            <div className="aspect-[3/2] rounded-lg border border-white/5 bg-white/[0.01]"></div>
                        </div>
                    </div>
                    <div className="z-20 p-4 relative">
                        <h3 className="text-2xl font-semibold text-white tracking-tight mb-2">Intelligence</h3>
                        <p className="text-sm text-neutral-400 leading-relaxed font-light">
                            Context-aware automations that understand your business needs.
                        </p>
                    </div>
                </div>

            </div>
        </section>
    )
}

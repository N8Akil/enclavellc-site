"use client"

import { useEffect, useRef } from "react"
import { ArrowRight, Cpu, Webhook, Mail, Database, Clock, BrainCircuit, FileText, MessageSquare, GitBranch, BellRing, Plus, Terminal } from "lucide-react"

export function HeroSection() {
    const observerRef = useRef<IntersectionObserver | null>(null);

    useEffect(() => {
        // Simple intersection observer for 'animate-on-scroll' elements
        // This replicates the script logic from the template
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
        <section className="relative min-h-[900px] flex flex-col items-center justify-center overflow-hidden pt-32 pb-20 px-4">
            {/* Ambient Background Glows (Red/Orange/Yellow Fire Theme) */}
            <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[80rem] h-[50rem] bg-orange-900/10 rounded-full blur-[120px] pointer-events-none z-0"></div>
            <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40rem] h-[40rem] bg-red-900/10 rounded-full blur-[100px] pointer-events-none z-0"></div>
            <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[60rem] h-[40rem] bg-yellow-900/5 rounded-full blur-[120px] pointer-events-none z-0"></div>

            {/* Content Wrapper for Layout Stability */}
            <div className="relative w-full max-w-[90rem] mx-auto flex flex-col items-center z-20">

                {/* Badge */}
                <div className="z-10 flex gap-2 glass-card bg-orange-950/20 border-orange-500/20 rounded-full mt-8 px-4 py-1.5 items-center animate-on-scroll">
                    <Cpu className="w-4 h-4 text-orange-400" />
                    <span className="text-sm font-medium text-orange-100">
                        Digital Overhaul in Progress
                    </span>
                </div>

                {/* NEURAL / AUTOMATION stacked headline */}
                <h1 className="mt-10 text-center text-[12vw] md:text-[8rem] font-semibold tracking-[-0.05em] leading-[0.8] bg-clip-text text-transparent bg-gradient-to-b from-white via-neutral-200 to-neutral-600 glow-text z-40 relative animate-on-scroll">
                    <span className="block">DIGITAL</span>
                    <span className="block mt-2 text-white/50">OVERHAUL</span>
                </h1>

                {/* Description */}
                <p className="mt-8 text-lg md:text-xl text-neutral-400 text-center max-w-2xl leading-relaxed font-normal animate-on-scroll z-40 relative">
                    We rebuild outdated websites and set up simple automations so your business looks legit and runs smoother — without you learning any “tech stuff.”
                </p>

                {/* CTA Buttons */}
                <div className="flex mt-10 gap-x-3 gap-y-3 items-center animate-on-scroll z-40 relative">
                    <a href="#contact" className="group flex hover:bg-orange-900/20 transition-all duration-300 bg-gradient-to-b from-orange-500/10 via-orange-500/0 to-orange-500/10 w-auto border-white/10 border rounded-full pt-2 pr-8 pb-2 pl-2 relative shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-2xl gap-x-4 gap-y-4 items-center overflow-hidden">
                        {/* Border Beam Animation Layer */}
                        <div className="absolute inset-0 rounded-full" style={{ maskImage: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)", maskComposite: "exclude", padding: "1px", pointerEvents: "none" }}>
                            <div className="absolute -inset-[100%] animate-[spin_3s_linear_infinite] bg-[conic-gradient(from_0deg,transparent_0_300deg,#f97316_360deg)]"></div>
                        </div>
                        <div className="relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-orange-600 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.3),0_4px_10px_rgba(249,115,22,0.3)]">
                            <ArrowRight className="w-5 h-5" />
                        </div>
                        <span className="relative z-10 text-lg font-medium text-white tracking-tight">
                            Get a Free Audit
                        </span>
                    </a>
                </div>

                {/* CARD 1: Top Left (Triggers) - Flanking H1 */}
                <div className="hidden 2xl:block glass-card w-72 rounded-2xl p-4 absolute top-1/2 -translate-y-[60%] left-0 animate-[aura-float-1_8s_ease-in-out_infinite] z-10 opacity-80 hover:opacity-100 transition-opacity">
                    <div className="flex mb-4 items-center justify-between">
                        <span className="text-xs font-medium text-neutral-400">Trigger Source</span>
                        <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]"></div>
                    </div>
                    <div className="w-full bg-neutral-900/50 border border-orange-500/30 rounded-lg p-2.5 flex items-center justify-between mb-3 shadow-[0_0_15px_-3px_rgba(249,115,22,0.1)]">
                        <div className="flex items-center gap-2.5">
                            <Webhook className="w-4 h-4 text-orange-400" />
                            <span className="text-sm text-white font-medium">Contact Form</span>
                        </div>
                        <span className="text-xs font-mono text-neutral-500">POST</span>
                    </div>
                    <div className="space-y-1">
                        <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors opacity-60">
                            <Mail className="w-4 h-4 text-neutral-400" />
                            <span className="text-sm font-medium">New Email</span>
                        </div>
                        <div className="flex items-center gap-3 p-2 rounded-lg bg-white/5 border border-white/5">
                            <Database className="w-4 h-4 text-neutral-400" />
                            <span className="text-sm font-medium">Row Created</span>
                        </div>
                        <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors opacity-60">
                            <Clock className="w-4 h-4 text-neutral-500" />
                            <span className="text-sm font-medium">Scheduled</span>
                        </div>
                    </div>
                </div>

                {/* CARD 2: Top Right (AI Models) - Flanking H1 */}
                <div className="hidden 2xl:block absolute right-0 top-1/2 -translate-y-[60%] w-64 glass-card rounded-2xl p-1.5 space-y-1 animate-[aura-float-2_9s_ease-in-out_1s_infinite] z-10 opacity-80 hover:opacity-100 transition-opacity">
                    <div className="group flex items-center gap-3 p-3 rounded-xl border border-white/5 bg-neutral-900/40 hover:border-orange-500/30 transition-all cursor-pointer">
                        <div className="w-8 h-8 rounded-lg bg-neutral-800 flex items-center justify-center border border-white/5 group-hover:bg-orange-500/10 group-hover:text-orange-400 transition-colors">
                            <BrainCircuit className="w-4 h-4" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-sm font-medium">Analyze Lead</span>
                            <span className="text-[10px] text-neutral-500">AI Logic</span>
                        </div>
                    </div>
                    <div className="group flex items-center gap-3 p-3 rounded-xl border border-white/5 bg-neutral-900/40 hover:border-red-500/30 transition-all cursor-pointer">
                        <div className="w-8 h-8 rounded-lg bg-neutral-800 flex items-center justify-center border border-white/5 group-hover:bg-red-500/10 group-hover:text-red-400 transition-colors">
                            <FileText className="w-4 h-4" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-sm font-medium">Draft Proposal</span>
                            <span className="text-[10px] text-neutral-500">Auto-Generate</span>
                        </div>
                    </div>
                    <div className="group flex items-center gap-3 p-3 rounded-xl border border-white/5 bg-neutral-900/40 hover:border-yellow-500/30 transition-all cursor-pointer">
                        <div className="w-8 h-8 rounded-lg bg-neutral-800 flex items-center justify-center border border-white/5 group-hover:bg-yellow-500/10 group-hover:text-yellow-400 transition-colors">
                            <MessageSquare className="w-4 h-4" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-sm font-medium">Notify Team</span>
                            <span className="text-[10px] text-neutral-500">Slack / SMS</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* CARD 3: Bottom Left (Workflow Logic - n8n style) */}
            <div className="hidden lg:block glass-card w-72 rounded-2xl p-5 absolute bottom-[5%] left-[8%] animate-[aura-float-3_10s_ease-in-out_2s_infinite]">
                {/* Root Node */}
                <div className="relative z-10 flex items-center gap-3 p-3 rounded-xl border border-white/10 bg-neutral-900 shadow-sm">
                    <GitBranch className="w-4 h-4 text-neutral-400" />
                    <span className="text-sm font-medium">Conditional Route</span>
                </div>

                {/* Branches */}
                <div className="pl-4 py-2 space-y-2 relative">
                    <div className="absolute left-[29px] top-0 bottom-6 w-px bg-white/10"></div>

                    {/* Branch 1 */}
                    <div className="relative flex items-center">
                        <div className="w-4 h-6 border-b border-l border-white/10 rounded-bl-xl absolute -left-[3px] -top-3"></div>
                        <div className="ml-6 w-full relative group">
                            <div className="text-[10px] uppercase font-bold text-orange-500/80 mb-1 tracking-wider ml-1">High Value</div>
                            <div className="flex items-center justify-between p-2.5 rounded-lg border border-orange-500/30 bg-orange-950/20">
                                <div className="flex items-center gap-2">
                                    <BellRing className="w-4 h-4 text-orange-400" />
                                    <span className="text-sm font-medium text-orange-100">SMS Alert</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    {/* Branch 2 */}
                    <div className="relative flex items-center pt-2">
                        <div className="w-4 h-6 border-b border-l border-white/10 rounded-bl-xl absolute -left-[3px] -top-3"></div>
                        <div className="ml-6 w-full">
                            <div className="flex items-center gap-2 p-2.5 rounded-lg border border-white/5 bg-neutral-900/50 hover:bg-neutral-800 transition-colors text-neutral-500">
                                <Plus className="w-4 h-4" />
                                <span className="text-sm font-medium">Add Step</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* CARD 4: Bottom Right (Live Log) */}
            <div className="hidden lg:block absolute right-[12%] bottom-[8%] w-80 glass-card rounded-2xl p-5 animate-[aura-float-4_11s_ease-in-out_0.5s_infinite]">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <Terminal className="w-4 h-4 text-neutral-400" />
                        <span className="text-xs font-medium text-neutral-300">Live Execution</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        <span className="text-xs font-mono text-emerald-500">RUNNING</span>
                    </div>
                </div>

                <div className="space-y-2 font-mono text-xs max-h-32 overflow-hidden relative">
                    <div className="absolute bottom-0 left-0 w-full h-8 bg-gradient-to-t from-black/40 to-transparent pointer-events-none"></div>
                    <div className="flex gap-2">
                        <span className="text-neutral-600">10:42:01</span>
                        <span className="text-blue-400">info</span>
                        <span className="text-neutral-300">New submission</span>
                    </div>
                    <div className="flex gap-2">
                        <span className="text-neutral-600">10:42:02</span>
                        <span className="text-purple-400">processing</span>
                        <span className="text-neutral-300">Parsing data...</span>
                    </div>
                    <div className="flex gap-2">
                        <span className="text-neutral-600">10:42:03</span>
                        <span className="text-yellow-400">decision</span>
                        <span className="text-neutral-300">High Priority: True</span>
                    </div>
                    <div className="flex gap-2">
                        <span className="text-neutral-600">10:42:04</span>
                        <span className="text-emerald-400">success</span>
                        <span className="text-neutral-300">Alert Sent</span>
                    </div>
                </div>
            </div>

        </section>
    )
}

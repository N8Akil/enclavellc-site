"use client"

const TESTIMONIALS_1 = [
    {
        quote: "People finally stopped saying our site looked outdated. Calls went up the first week.",
        author: "Local Service Business",
        role: "Owner"
    },
    {
        quote: "The follow-up texts alone paid for it. No more leads falling through the cracks.",
        author: "Contractor / Trades",
        role: "General Manager"
    }
]

const TESTIMONIALS_2 = [
    {
        quote: "I don’t want to learn software. I just wanted it handled. That’s what I got.",
        author: "Small Business Owner",
        role: "Founder"
    },
    {
        quote: "Simple, clean, and fast. Exactly what we needed to look professional.",
        author: "Consultancy Firm",
        role: "Partner"
    }
]

export function TestimonialsSection() {
    return (
        <section className="bg-neutral-950 w-full max-w-7xl border-white/5 border rounded-3xl mt-24 mx-auto pt-24 pr-6 pb-24 pl-6 relative overflow-hidden">
            {/* Background Text */}
            <div className="-translate-x-1/2 z-0 pointer-events-none select-none text-center w-full absolute top-24 left-1/2" style={{ maskImage: "linear-gradient(180deg, transparent, black 0%, black 60%, transparent)", WebkitMaskImage: "linear-gradient(180deg, transparent, black 0%, black 60%, transparent)" }}>
                <span className="text-[10vw] lg:text-[12rem] leading-none whitespace-nowrap font-bold text-white/5 tracking-tighter">
                    Reviews
                </span>
            </div>

            <div className="z-10 flex flex-col lg:flex-row gap-8 text-left mb-20 relative gap-x-8 gap-y-8 justify-between animate-on-scroll">
                <div className="max-w-2xl">
                    <h2 className="leading-[1.05] md:text-6xl text-5xl font-bold text-white tracking-tight">Trusted by Locals</h2>
                </div>
                <div className="max-w-md">
                    <p className="md:text-lg leading-relaxed text-base font-light text-neutral-400">
                        Real results for real businesses. No fluff, just functional upgrades.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 z-10 mt-32 relative gap-x-6 gap-y-6 h-[600px] overflow-hidden animate-on-scroll" style={{ maskImage: "linear-gradient(to bottom, transparent, black 10%, black 90%, transparent)", WebkitMaskImage: "linear-gradient(to bottom, transparent, black 10%, black 90%, transparent)" }}>

                {/* Column 1 (Scrolls Up) */}
                <div className="relative w-full h-full overflow-hidden">
                    <div className="animate-[marquee-up_20s_linear_infinite] flex flex-col gap-6 pb-6">
                        {[...TESTIMONIALS_1, ...TESTIMONIALS_1, ...TESTIMONIALS_1].map((t, i) => (
                            <TestimonialCard key={i} {...t} />
                        ))}
                    </div>
                </div>

                {/* Column 2 (Scrolls Down) */}
                <div className="relative w-full h-full overflow-hidden">
                    <div className="animate-[marquee-down_25s_linear_infinite] flex flex-col gap-6 pb-6">
                        {[...TESTIMONIALS_2, ...TESTIMONIALS_2, ...TESTIMONIALS_2].map((t, i) => (
                            <TestimonialCard key={i} {...t} />
                        ))}
                    </div>
                </div>

                {/* Column 3 (Scrolls Up) */}
                <div className="relative w-full h-full overflow-hidden hidden lg:block">
                    <div className="animate-[marquee-up_30s_linear_infinite] flex flex-col gap-6 pb-6">
                        {[...TESTIMONIALS_1, ...TESTIMONIALS_2, ...TESTIMONIALS_1].map((t, i) => (
                            <TestimonialCard key={i} {...t} />
                        ))}
                    </div>
                </div>

            </div>
        </section>
    )
}

function TestimonialCard({ quote, author, role }: { quote: string, author: string, role: string }) {
    return (
        <div className="group transition-all duration-500 hover:border-white/10 shadow-black/50 bg-gradient-to-br from-white/10 to-white/0 rounded-2xl p-8 relative shadow-2xl backdrop-blur-md border border-white/5">
            <p className="text-neutral-300 text-lg font-light leading-relaxed mb-8">"{quote}"</p>
            <div className="flex items-center justify-between border-t border-white/5 pt-6">
                <div>
                    <h4 className="text-white font-semibold tracking-tight">{author}</h4>
                    <p className="text-sm text-neutral-500 font-light">{role}</p>
                </div>
            </div>
        </div>
    )
}

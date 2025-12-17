"use client"

const TESTIMONIALS = [
    {
        quote: "People stopped saying our site looked outdated. Calls increased within the first week.",
        author: "Local Service Business",
        role: "Owner"
    },
    {
        quote: "Follow-up automation paid for itself. Leads stopped slipping through the cracks.",
        author: "Contractor / Trades",
        role: "General Manager"
    },
    {
        quote: "I didn't want more software. I wanted it handled—and it was.",
        author: "Small Business Owner",
        role: "Founder"
    }
]

export function TestimonialsSection() {
    return (
        <section id="results" className="scroll-mt-24 bg-[var(--color-surface)] w-full max-w-7xl border border-[var(--color-border)] rounded-3xl mt-24 mx-auto pt-24 pr-6 pb-24 pl-6 relative overflow-hidden">
            {/* Background Text */}
            <div className="-translate-x-1/2 z-0 pointer-events-none select-none text-center w-full absolute top-24 left-1/2" style={{ maskImage: "linear-gradient(180deg, transparent, black 0%, black 60%, transparent)", WebkitMaskImage: "linear-gradient(180deg, transparent, black 0%, black 60%, transparent)" }}>
                <span className="text-[10vw] lg:text-[12rem] leading-none whitespace-nowrap font-bold text-[var(--color-text-primary)] opacity-[0.03] tracking-tighter">
                    Results
                </span>
            </div>

            <div className="z-10 flex flex-col lg:flex-row gap-8 text-left mb-16 relative gap-x-8 gap-y-8 justify-between animate-on-scroll">
                <div className="max-w-2xl">
                    <h2 className="leading-[1.05] md:text-6xl text-5xl font-bold text-[var(--color-text-primary)] tracking-tight">Results</h2>
                </div>
                <div className="max-w-md">
                    <p className="md:text-lg leading-relaxed text-base font-light text-[var(--color-text-secondary)]">
                        Clearer trust. Faster follow-up. Less chaos.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 z-10 relative gap-6 animate-on-scroll">
                {TESTIMONIALS.map((t, i) => (
                    <TestimonialCard key={i} {...t} />
                ))}
            </div>
        </section>
    )
}

function TestimonialCard({ quote, author, role }: { quote: string, author: string, role: string }) {
    return (
        <div className="group glass-card transition-all duration-500 rounded-2xl p-8 relative">
            <p className="text-[var(--color-text-secondary)] text-lg font-light leading-relaxed mb-8">"{quote}"</p>
            <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-6">
                <div>
                    <h4 className="text-[var(--color-text-primary)] font-semibold tracking-tight">{author}</h4>
                    <p className="text-sm text-[var(--color-text-muted)] font-light">{role}</p>
                </div>
            </div>
        </div>
    )
}

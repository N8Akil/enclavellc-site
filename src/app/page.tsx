import Link from "next/link"
import { ArrowRight, Check, Clock, Layers, Sparkles, Wrench } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"
import { ContactForm } from "@/components/contact-form"

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[color:var(--color-background)] text-[color:var(--color-text-primary)]">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-[color:var(--color-border)] bg-[color:color-mix(in_oklab,var(--color-background)_85%,transparent)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight">Enclave LLC</div>
              <div className="text-xs text-[color:var(--color-text-secondary)]">Websites + Automation</div>
            </div>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-[color:var(--color-text-secondary)] md:flex">
            <a href="#services" className="hover:text-[color:var(--color-text-primary)]">Services</a>
            <a href="#how" className="hover:text-[color:var(--color-text-primary)]">How it works</a>
            <a href="#results" className="hover:text-[color:var(--color-text-primary)]">Results</a>
            <a href="#contact" className="hover:text-[color:var(--color-text-primary)]">Contact</a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <a
              href="#contact"
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white"
              style={{ background: "var(--color-accent-red)" }}
            >
              Get a Free Audit <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pt-20">
        <div className="grid gap-10 md:grid-cols-2 md:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-1 text-xs text-[color:var(--color-text-secondary)]">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: "var(--color-accent-orange)" }}
              />
              Built for busy small business owners
            </div>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
              A modern website — plus automation that saves you time.
            </h1>
            <p className="mt-4 max-w-prose text-base leading-relaxed text-[color:var(--color-text-secondary)]">
              We rebuild outdated websites and set up simple automations (forms, follow-ups, scheduling, lead capture)
              so your business looks legit and runs smoother — without you learning any “tech stuff.”
            </p>
            <ul className="mt-6 space-y-2 text-sm text-[color:var(--color-text-secondary)]">
              {[
                "Clear, readable design (light + dark mode)",
                "Fast load times and mobile-friendly layout",
                "Contact form goes straight into your workflow (n8n ready)",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4" style={{ color: "var(--color-accent-yellow)" }} />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="#contact"
                className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white"
                style={{ background: "var(--color-accent-red)" }}
              >
                Get a Free Audit <ArrowRight className="h-4 w-4" />
              </a>
              <a
                href="#services"
                className="inline-flex items-center justify-center rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-5 py-3 text-sm font-semibold"
              >
                See Services
              </a>
            </div>
            <p className="mt-3 text-xs text-[color:var(--color-text-secondary)]">
              No pressure. If we’re not a fit, we’ll tell you straight.
            </p>
          </div>

          {/* “Brushed metal” visual card */}
          <div className="relative">
            <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Digital Overhaul Snapshot</div>
                <div className="text-xs text-[color:var(--color-text-secondary)]">Example</div>
              </div>
              <div className="mt-6 grid gap-3">
                {[
                  { label: "Website Speed", value: "Improved", icon: Clock },
                  { label: "Lead Follow-Up", value: "Automated", icon: Layers },
                  { label: "Site Updates", value: "Handled for you", icon: Wrench },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between rounded-xl border border-[color:var(--color-border)] bg-[color:color-mix(in_oklab,var(--color-surface)_70%,transparent)] px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <row.icon className="h-4 w-4" style={{ color: "var(--color-accent-orange)" }} />
                      <div className="text-sm">{row.label}</div>
                    </div>
                    <div className="text-sm font-semibold">{row.value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-6 rounded-xl border border-[color:var(--color-border)] p-4">
                <div className="text-xs text-[color:var(--color-text-secondary)]">What you get</div>
                <div className="mt-2 text-sm">
                  A clean site + a simple system that captures leads and follows up automatically.
                </div>
              </div>
            </div>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-6 -z-10 rounded-[28px] blur-2xl"
              style={{
                background:
                  "radial-gradient(60% 60% at 30% 20%, color-mix(in_oklab, var(--color-accent-red) 30%, transparent), transparent 60%), radial-gradient(60% 60% at 70% 60%, color-mix(in_oklab, var(--color-accent-yellow) 25%, transparent), transparent 60%)",
              }}
            />
          </div>
        </div>
      </section>

      {/* Services */}
      <section id="services" className="border-t border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Services</h2>
          <p className="mt-3 max-w-prose text-sm text-[color:var(--color-text-secondary)]">
            Simple, practical upgrades. We keep it clean and we keep it moving.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <ServiceCard
              icon={<Sparkles className="h-5 w-5" style={{ color: "var(--color-accent-yellow)" }} />}
              title="Website Rebuild"
              bullets={[
                "Modern design (mobile friendly)",
                "Fast loading, clear layout",
                "Basic SEO + lead capture",
              ]}
            />
            <ServiceCard
              icon={<Layers className="h-5 w-5" style={{ color: "var(--color-accent-orange)" }} />}
              title="Automation Setup"
              bullets={[
                "Contact forms → follow-ups",
                "Scheduling + intake flow",
                "Less admin, fewer missed leads",
              ]}
            />
            <ServiceCard
              icon={<Wrench className="h-5 w-5" style={{ color: "var(--color-accent-red)" }} />}
              title="Content + Cleanup"
              bullets={[
                "Better copy (plain English)",
                "Trust-building layout",
                "Polished brand presentation",
              ]}
            />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-t border-[color:var(--color-border)]">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">How it works</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <StepCard n="01" title="Audit" desc="We review your site and your lead process. You get a clear punch list." />
            <StepCard n="02" title="Build" desc="We rebuild the site and wire up simple automation that fits your business." />
            <StepCard n="03" title="Launch" desc="We go live cleanly. You get a setup that’s easy to run." />
          </div>
        </div>
      </section>

      {/* Results */}
      <section id="results" className="border-t border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Results</h2>
          <p className="mt-3 max-w-prose text-sm text-[color:var(--color-text-secondary)]">
            This is the outcome we’re after: clearer trust, faster follow-up, and less chaos.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <QuoteCard
              quote="“People finally stopped saying our site looked outdated. Calls went up the first week.”"
              meta="Local service business"
            />
            <QuoteCard
              quote="“The follow-up texts alone paid for it. No more leads falling through the cracks.”"
              meta="Contractor / trades"
            />
            <QuoteCard
              quote="“I don’t want to learn software. I just wanted it handled. That’s what I got.”"
              meta="Small business owner"
            />
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="border-t border-[color:var(--color-border)]">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="grid gap-10 md:grid-cols-2">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Request a free audit</h2>
              <p className="mt-3 max-w-prose text-sm text-[color:var(--color-text-secondary)]">
                Tell us what you need. We’ll respond with next steps and a straight answer.
              </p>
              <div className="mt-6 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6">
                <ContactForm />
              </div>
            </div>
            <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6">
              <h3 className="text-lg font-semibold">Prefer phone?</h3>
              <p className="mt-2 text-sm text-[color:var(--color-text-secondary)]">
                Call or text and we’ll keep it simple.
              </p>
              <div className="mt-4 space-y-2 text-sm">
                <div>
                  <div className="text-xs text-[color:var(--color-text-secondary)]">Phone</div>
                  <a className="font-semibold hover:underline" href="tel:+14242027591">
                    (424) 202-7591
                  </a>
                </div>
                <div>
                  <div className="text-xs text-[color:var(--color-text-secondary)]">Email</div>
                  <a className="font-semibold hover:underline" href="mailto:n.garrett@enclavellc.net">
                    n.garrett@enclavellc.net
                  </a>
                </div>
              </div>
              <div className="mt-6 rounded-xl border border-[color:var(--color-border)] p-4">
                <div className="text-xs text-[color:var(--color-text-secondary)]">What happens next</div>
                <ul className="mt-2 space-y-2 text-sm text-[color:var(--color-text-secondary)]">
                  <li className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4" style={{ color: "var(--color-accent-yellow)" }} />
                    We confirm what you want to fix.
                  </li>
                  <li className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4" style={{ color: "var(--color-accent-orange)" }} />
                    We give you a simple plan + timeline.
                  </li>
                  <li className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4" style={{ color: "var(--color-accent-red)" }} />
                    If you approve, we build and launch.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
            <div className="text-sm">
              <div className="font-semibold">Enclave LLC</div>
              <div className="text-xs text-[color:var(--color-text-secondary)]">
                Platinum clean. Fire accents. No fluff.
              </div>
            </div>
            <div className="flex gap-6 text-sm text-[color:var(--color-text-secondary)]">
              <a href="#services" className="hover:text-[color:var(--color-text-primary)]">Services</a>
              <a href="#how" className="hover:text-[color:var(--color-text-primary)]">How it works</a>
              <a href="#contact" className="hover:text-[color:var(--color-text-primary)]">Contact</a>
            </div>
          </div>
        </div>
      </footer>
    </main>
  )
}

function ServiceCard({
  icon,
  title,
  bullets,
}: {
  icon: React.ReactNode
  title: string
  bullets: string[]
}) {
  return (
    <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:color-mix(in_oklab,var(--color-background)_60%,transparent)] p-6">
      <div className="flex items-center gap-3">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
          {icon}
        </div>
        <div className="text-base font-semibold">{title}</div>
      </div>
      <ul className="mt-4 space-y-2 text-sm text-[color:var(--color-text-secondary)]">
        {bullets.map((b) => (
          <li key={b} className="flex gap-2">
            <Check className="mt-0.5 h-4 w-4" style={{ color: "var(--color-accent-orange)" }} />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StepCard({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6">
      <div className="text-xs font-semibold" style={{ color: "var(--color-accent-orange)" }}>
        {n}
      </div>
      <div className="mt-2 text-base font-semibold">{title}</div>
      <div className="mt-2 text-sm text-[color:var(--color-text-secondary)]">{desc}</div>
    </div>
  )
}

function QuoteCard({ quote, meta }: { quote: string; meta: string }) {
  return (
    <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] p-6">
      <div className="text-sm text-[color:var(--color-text-secondary)]">{quote}</div>
      <div className="mt-4 text-xs font-semibold" style={{ color: "var(--color-accent-orange)" }}>
        {meta}
      </div>
    </div>
  )
}

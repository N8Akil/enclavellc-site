"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"

const schema = z.object({
    name: z.string().min(2, "Please enter your name."),
    email: z.string().email("Please enter a valid email."),
    phone: z.string().optional(),
    service: z.enum(["Website Rebuild", "Automation Setup", "Content + Cleanup", "Not sure yet"]).optional(),
    message: z.string().min(10, "Please add a short message (at least 10 characters)."),
})

type FormValues = z.infer<typeof schema>

export function ContactForm() {
    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
        reset,
    } = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            service: "Not sure yet",
        },
    })

    const onSubmit = async (values: FormValues) => {
        const res = await fetch("/api/contact", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(values),
        })

        if (!res.ok) {
            toast.error("Something failed. Try again or call/text us.")
            return
        }

        toast.success("Sent. We’ll get back to you ASAP.")
        reset()
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Field label="Name" error={errors.name?.message}>
                <input
                    {...register("name")}
                    autoComplete="name"
                    className="h-11 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 text-sm outline-none"
                    placeholder="Your name"
                />
            </Field>

            <Field label="Email" error={errors.email?.message}>
                <input
                    {...register("email")}
                    autoComplete="email"
                    className="h-11 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 text-sm outline-none"
                    placeholder="you@company.com"
                />
            </Field>

            <Field label="Phone (optional)" error={errors.phone?.message}>
                <input
                    {...register("phone")}
                    autoComplete="tel"
                    inputMode="tel"
                    className="h-11 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 text-sm outline-none"
                    placeholder="(###) ###-####"
                />
            </Field>

            <Field label="What do you need?" error={errors.service?.message}>
                <select
                    {...register("service")}
                    className="h-11 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 text-sm outline-none"
                >
                    <option>Website Rebuild</option>
                    <option>Automation Setup</option>
                    <option>Content + Cleanup</option>
                    <option>Not sure yet</option>
                </select>
            </Field>

            <Field label="Message" error={errors.message?.message}>
                <textarea
                    {...register("message")}
                    className="min-h-[120px] w-full resize-none rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] p-3 text-sm outline-none"
                    placeholder="Tell us what’s going on (current site, what you want fixed, etc.)"
                />
            </Field>

            <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex w-full items-center justify-center rounded-xl px-5 py-3 text-sm font-semibold text-white disabled:opacity-70"
                style={{ background: "var(--color-accent-red)" }}
            >
                {isSubmitting ? "Sending…" : "Send Request"}
            </button>

            <p className="text-xs text-[color:var(--color-text-secondary)]">
                Heads up: we keep this simple. No spam, no weird sales funnel.
            </p>
        </form>
    )
}

function Field({
    label,
    error,
    children,
}: {
    label: string
    error?: string
    children: React.ReactNode
}) {
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-4">
                <label className="text-xs font-semibold text-[color:var(--color-text-secondary)]">{label}</label>
                {error ? <span className="text-xs" style={{ color: "var(--color-accent-red)" }}>{error}</span> : null}
            </div>
            {children}
        </div>
    )
}

"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { CheckCircle2, Loader2, Globe, Mail, User } from "lucide-react"

const schema = z.object({
    websiteUrl: z.string()
        .min(1, "Website URL is required")
        .refine((url) => {
            try {
                const normalized = url.startsWith('http') ? url : `https://${url}`;
                const parsed = new URL(normalized);
                return parsed.hostname.includes('.');
            } catch {
                return false;
            }
        }, "Please enter a valid website URL"),
    userEmail: z.string().email("Please enter a valid email address"),
    userName: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

export function WebsiteAuditForm() {
    const [status, setStatus] = React.useState<'idle' | 'loading' | 'success' | 'error'>('idle')
    const [resultMessage, setResultMessage] = React.useState('')

    const {
        register,
        handleSubmit,
        formState: { errors },
        reset,
    } = useForm<FormValues>({
        resolver: zodResolver(schema),
    })

    const onSubmit = async (values: FormValues) => {
        setStatus('loading')

        try {
            // Normalize URL - add https:// if not present
            const normalizedUrl = values.websiteUrl.startsWith('http')
                ? values.websiteUrl
                : `https://${values.websiteUrl}`;

            const res = await fetch("/api/audit/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...values,
                    websiteUrl: normalizedUrl
                }),
            })

            const data = await res.json()

            if (data.success) {
                setStatus('success')
                setResultMessage(`Your professional audit document is being delivered to ${values.userEmail}. Check your inbox in 2-3 minutes!`)
                toast.success("Audit sent! Check your inbox.")
                reset()
            } else {
                setStatus('error')
                setResultMessage(data.message || 'Something went wrong. Please try again.')
                toast.error(data.message || "Failed to start audit")
            }
        } catch (error) {
            setStatus('error')
            setResultMessage('Unable to process your request. Please try again later.')
            toast.error("Network error. Please try again.")
        }
    }

    if (status === 'success') {
        return (
            <div className="text-center py-8 animate-in fade-in duration-500">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">Audit Sent!</h3>
                <p className="text-neutral-400 mb-6">{resultMessage}</p>
                <button
                    onClick={() => {
                        setStatus('idle')
                        setResultMessage('')
                    }}
                    className="text-sm text-orange-400 hover:text-orange-300 transition-colors"
                >
                    Request another audit
                </button>
            </div>
        )
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Field label="Website URL" error={errors.websiteUrl?.message} icon={<Globe className="w-4 h-4" />}>
                <input
                    {...register("websiteUrl")}
                    type="text"
                    autoComplete="url"
                    className="h-11 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 pl-10 text-sm outline-none focus:border-orange-500/50 transition-colors"
                    placeholder="yourwebsite.com"
                    disabled={status === 'loading'}
                />
            </Field>

            <Field label="Your Email" error={errors.userEmail?.message} icon={<Mail className="w-4 h-4" />}>
                <input
                    {...register("userEmail")}
                    type="email"
                    autoComplete="email"
                    className="h-11 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 pl-10 text-sm outline-none focus:border-orange-500/50 transition-colors"
                    placeholder="you@company.com"
                    disabled={status === 'loading'}
                />
            </Field>

            <Field label="Your Name (optional)" error={errors.userName?.message} icon={<User className="w-4 h-4" />}>
                <input
                    {...register("userName")}
                    type="text"
                    autoComplete="name"
                    className="h-11 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 pl-10 text-sm outline-none focus:border-orange-500/50 transition-colors"
                    placeholder="John Smith"
                    disabled={status === 'loading'}
                />
            </Field>

            {status === 'error' && resultMessage && (
                <p className="text-sm text-red-400 bg-red-500/10 rounded-lg p-3 border border-red-500/20">
                    {resultMessage}
                </p>
            )}

            <button
                type="submit"
                disabled={status === 'loading'}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white disabled:opacity-70 bg-orange-500 hover:bg-orange-600 transition-colors"
            >
                {status === 'loading' ? (
                    <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Analyzing & Sending...
                    </>
                ) : (
                    "Get Instant Audit →"
                )}
            </button>

            <p className="text-xs text-[color:var(--color-text-secondary)] text-center">
                ⚡ AI-powered • Professional .docx report • Delivered in 2-3 minutes
            </p>
        </form>
    )
}

function Field({
    label,
    error,
    icon,
    children,
}: {
    label: string
    error?: string
    icon?: React.ReactNode
    children: React.ReactNode
}) {
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-4">
                <label className="text-xs font-semibold text-[color:var(--color-text-secondary)]">{label}</label>
                {error ? <span className="text-xs text-red-400">{error}</span> : null}
            </div>
            <div className="relative">
                {icon && (
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500">
                        {icon}
                    </div>
                )}
                {children}
            </div>
        </div>
    )
}

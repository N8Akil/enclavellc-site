"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import { Moon, Sun } from "lucide-react"

export function ThemeToggle() {
    const { theme, setTheme, resolvedTheme } = useTheme()
    const current = theme === "system" ? resolvedTheme : theme

    return (
        <button
            type="button"
            onClick={() => setTheme(current === "dark" ? "light" : "dark")}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)]"
            aria-label="Toggle theme"
            title="Toggle theme"
        >
            {current === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
    )
}

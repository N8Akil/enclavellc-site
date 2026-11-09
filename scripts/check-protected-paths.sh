#!/usr/bin/env bash
# Fails if this branch changes anything that takes money, spends an AI call or sends email.
# Usage: scripts/check-protected-paths.sh <base-ref>      (compares <base-ref>...HEAD)
set -euo pipefail

base="${1:?usage: $0 <base-ref>}"

# A trailing slash protects the whole directory; anything else is one file.
protected=(
  src/app/api/payment/            # Stripe checkout + webhook
  src/app/api/audit/              # audit endpoint (AI call + email)
  src/app/api/contact/            # contact endpoint (Resend, enclavellc-site #3)
  src/lib/audit/                  # audit pipeline
  src/lib/email/                  # shared Resend client + escapeHtml (enclavellc-site #3)
  # found by grepping src/ for `new Stripe(`, `@anthropic-ai/sdk`, `resend`, `Resend(`:
  src/app/api/payment/create-checkout/route.ts   # new Stripe(
  src/app/api/payment/webhook/route.ts           # new Stripe(
  src/lib/audit/run-audit.ts                     # @anthropic-ai/sdk
  src/lib/audit/send-emails.ts                   # resend / new Resend(
  # the live callers of those services, which /night mirrors and must not edit:
  src/app/payment/                               # posts to /api/payment/create-checkout
  src/components/website-audit-form.tsx          # posts to /api/audit/generate
  src/components/contact-form.tsx                # posts to /api/contact
)

git rev-parse --verify --quiet "$base^{commit}" >/dev/null || { echo "unknown base ref: $base" >&2; exit 2; }

hits=()
while IFS= read -r f; do
  [ -n "$f" ] || continue
  for p in "${protected[@]}"; do
    if [[ "$p" == */ ]]; then [[ "$f" == "$p"* ]] && { hits+=("$f"); break; }
    else [[ "$f" == "$p" ]] && { hits+=("$f"); break; }
    fi
  done
done < <(git diff --name-only "$base"...HEAD)

echo "git diff --stat $base...HEAD over the protected set (must be empty):"
git diff --stat "$base"...HEAD -- "${protected[@]}"
echo "(end of stat)"

if [ "${#hits[@]}" -gt 0 ]; then
  echo "FAIL: protected paths changed:" >&2
  printf '  %s\n' "${hits[@]}" >&2
  exit 1
fi
echo "OK: no protected path changed since $base"

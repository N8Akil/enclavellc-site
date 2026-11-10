# Free audit: operating notes

## Restarts
An accepted audit runs after the response has been sent, inside the server process. Measured on 2026-11-10 (Next 15.5.26, `next start`): a 130-second job runs to the end, and a SIGTERM ends the process within a second and drops the job. No failure mail is sent.

- Do not restart or deploy this site while an audit is running.
- After any restart, check the admin lead mail for an accept with no report after it, and re-run that audit by hand.

The admin is mailed the lead when the request is accepted, so a restart loses a report, never a lead.

## Before the preview gate is removed
While `AUDIT_PREVIEW_EMAILS` limits reports to listed addresses, the limit above is accepted. Opening the audit to the public is blocked until this exists, with a test:

- On SIGTERM, mail the admin the audits in flight (visitor address and site URL) before the process exits.

A visitor who was told a report is coming must not be left hearing nothing.

## Building locally
The payment webhook route builds its client when it is imported, so `next build` needs a payment key in the environment. A made-up placeholder on the command line is enough for a local build; never a real key.

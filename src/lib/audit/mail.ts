// src/lib/audit/mail.ts
// Every mail the audit sends goes through sendMail: one Resend call with a time limit. The Resend client has no
// timeout of its own, and a send that never answers would otherwise hold a queue place (or a visitor's request)
// for ever. A send that runs past MAIL_TIMEOUT_MS is a failed send with the code "timeout"; whatever it does later
// is ignored. Failures come back as codes only: the provider's messages can echo the addresses.
import { getResendClient } from '@/lib/email/resend-client';

export const MAIL_TIMEOUT_MS = 20_000;

type Resend = ReturnType<typeof getResendClient>;
export type Mail = Parameters<Resend['emails']['send']>[0];
export type MailOutcome = { sent: true } | { sent: false; error: string };

export async function sendMail(who: string, mail: Mail, timeoutMs: number = MAIL_TIMEOUT_MS): Promise<MailOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const sending = getResendClient().emails.send(mail);
    // a send that settles after the time limit must not become an unhandled rejection
    sending.catch(() => {});
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    const result = await Promise.race([sending, timeout]);
    if (result === 'timeout') return { sent: false, error: `${who}: timeout` };
    const { data, error } = result;
    if (error) return { sent: false, error: `${who}: ${error.statusCode ?? '-'} ${error.name}` };
    if (!data?.id) return { sent: false, error: `${who}: no id` };
    return { sent: true };
  } catch (error) {
    return { sent: false, error: `${who}: threw ${error instanceof Error ? error.name : typeof error}` };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

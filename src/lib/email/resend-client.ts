// src/lib/email/resend-client.ts
import { Resend } from 'resend';

// One Resend client for every sender (contact form, audit emails), created on first use
// so that building without RESEND_API_KEY still works.
let resend: Resend | null = null;

export function getResendClient(): Resend {
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

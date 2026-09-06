/**
 * Transactional email — verification and password-reset links.
 *
 * Firebase Auth sent these for us; now they are ours. The transport is any
 * Resend-compatible JSON endpoint (`MAIL_ENDPOINT` + `MAIL_API_KEY`); swapping to
 * SendGrid or Mailgun is a change to {@link send} alone.
 *
 * With no API key configured — local dev, CI, a contributor without secrets — the
 * message is logged instead of sent, so sign-up still works end to end and the
 * link is copy-pasteable from the server output.
 */
import { config } from "./config.js";

interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

async function send(mail: Mail): Promise<void> {
  if (!config.mail.apiKey) {
    console.info(`[mail] would send "${mail.subject}" to ${mail.to}\n${mail.text}`);
    return;
  }
  const res = await fetch(config.mail.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.mail.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.mail.from,
      to: [mail.to],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    }),
  });
  if (!res.ok) {
    // Never fail the surrounding request on a mail outage — the user can retry
    // the resend, and a failed send must not roll back a completed sign-up.
    console.error(`[mail] send failed (${res.status}):`, await res.text());
  }
}

function layout(heading: string, body: string, cta: { href: string; label: string }): string {
  return `<!doctype html>
<html lang="en"><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
  <h1 style="font-size:20px">${heading}</h1>
  <p>${body}</p>
  <p><a href="${cta.href}"
        style="display:inline-block;padding:10px 18px;background:#0b3d2c;color:#fff;
               border-radius:6px;text-decoration:none">${cta.label}</a></p>
  <p style="color:#666;font-size:13px">If the button doesn't work, paste this into your browser:<br>
    <span style="word-break:break-all">${cta.href}</span></p>
  <p style="color:#666;font-size:13px">If you didn't request this, you can ignore this email.</p>
</body></html>`;
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const href = `${config.apiOrigin}/api/auth/verify-email/confirm?token=${encodeURIComponent(token)}`;
  await send({
    to,
    subject: "Confirm your Fly GACA email",
    html: layout("Confirm your email", "Confirm this address to activate your Fly GACA account.", {
      href,
      label: "Confirm email",
    }),
    text: `Confirm your Fly GACA email:\n${href}\n`,
  });
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const href = `${config.appOrigin}/account/reset?token=${encodeURIComponent(token)}`;
  await send({
    to,
    subject: "Reset your Fly GACA password",
    html: layout(
      "Reset your password",
      "Choose a new password for your Fly GACA account. This link expires in one hour.",
      { href, label: "Reset password" },
    ),
    text: `Reset your Fly GACA password (expires in 1 hour):\n${href}\n`,
  });
}

export async function sendPasswordlessSigninEmail(to: string, token: string, code: string): Promise<void> {
  const href = `${config.appOrigin}/account/signin?token=${encodeURIComponent(token)}`;
  await send({
    to,
    subject: "Sign in to Fly GACA",
    html: layout(
      "Your Fly GACA sign-in link",
      `<p>Click below to sign in to your account. This link expires in 10 minutes.</p>
       <p><strong>One-time code:</strong> ${code} (if the button doesn't work)</p>`,
      { href, label: "Sign in" },
    ),
    text: `Sign in to Fly GACA (expires in 10 minutes):\n${href}\n\nOne-time code: ${code}\n`,
  });
}

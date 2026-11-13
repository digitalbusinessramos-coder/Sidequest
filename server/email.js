// Email sending. Works with Resend (https://resend.com) when RESEND_API_KEY and EMAIL_FROM are set.
// Without a provider, nothing is sent: the link is only written to the server log so the team can test locally.
export const emailConfigured = () => !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

export const outbox = []; // last few emails, for automated tests and local debugging (never exposed over HTTP)

export async function sendEmail({ to, subject, text }) {
  outbox.push({ to, subject, text, at: new Date().toISOString() });
  if (outbox.length > 20) outbox.shift();
  if (!emailConfigured()) {
    if (process.env.NODE_ENV !== 'test') console.log(`[email not configured] To: ${to} | ${subject}\n${text}\n`);
    return { sent: false };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, text }),
  });
  if (!res.ok) {
    console.error('Email provider error', res.status, await res.text().catch(() => ''));
    return { sent: false, error: true };
  }
  return { sent: true };
}

interface PasswordSetupEmailInput {
  to: string;
  name: string;
  setupUrl: string;
}

const mailgunApiKey = process.env.MAILGUN_API_KEY?.trim();
const mailgunDomain = process.env.MAILGUN_DOMAIN?.trim();
const mailgunFrom =
  process.env.MAILGUN_FROM?.trim() ||
  process.env.MAIL_FROM?.trim() ||
  (mailgunDomain ? `YaoTu Admin <noreply@${mailgunDomain}>` : "");

function isMailConfigured(): boolean {
  return Boolean(mailgunApiKey && mailgunDomain && mailgunFrom);
}

export async function sendAdminPasswordSetupEmail(input: PasswordSetupEmailInput): Promise<boolean> {
  const text = `Your admin account has been created. Please set your password here: ${input.setupUrl}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <p>Hello ${input.name},</p>
      <p>Your admin account has been created.</p>
      <p>Please set your password here:</p>
      <p><a href="${input.setupUrl}">${input.setupUrl}</a></p>
      <p>This one-time link expires in 24 hours.</p>
    </div>
  `;

  if (!isMailConfigured()) {
    console.warn("[email] Mailgun is not configured. Password setup email was not sent.");
    if (process.env.NODE_ENV !== "production") {
      console.warn("[email] Password setup link:", input.setupUrl);
    }
    return process.env.NODE_ENV !== "production";
  }

  const body = new URLSearchParams({
    from: mailgunFrom,
    to: input.to,
    subject: "Set up your YaoTu admin password",
    text,
    html,
  });

  const response = await fetch(`https://api.mailgun.net/v3/${mailgunDomain}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${mailgunApiKey}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[email] Mailgun password setup email failed:", response.status, errorText);
    return false;
  }

  return true;
}

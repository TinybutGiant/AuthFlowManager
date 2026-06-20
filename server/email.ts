import type { AdminRole } from "@shared/schema";

interface PasswordSetupEmailInput {
  to: string;
  name: string;
  setupUrl: string;
  role: AdminRole;
}

const ROLE_DISPLAY_NAMES: Record<AdminRole, string> = {
  super_admin: "Super Admin",
  admin_finance: "Finance Admin",
  admin_verifier: "Verifier Admin",
  admin_support: "Support Admin",
  trainee_access: "Trainee Access",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getMailgunConfig() {
  const apiKey = process.env.MAILGUN_API_KEY?.trim();
  const domain = process.env.MAILGUN_DOMAIN?.trim();
  const from =
    process.env.MAILGUN_FROM?.trim() ||
    process.env.MAIL_FROM?.trim() ||
    (domain ? `YaoTu Admin <noreply@${domain}>` : "");

  return {
    apiKey,
    domain,
    from,
    configured: Boolean(apiKey && domain && from),
  };
}

export async function sendAdminPasswordSetupEmail(input: PasswordSetupEmailInput): Promise<boolean> {
  const mailgun = getMailgunConfig();
  const roleLabel = ROLE_DISPLAY_NAMES[input.role] ?? "YaoTu";
  const escapedName = escapeHtml(input.name);
  const escapedSetupUrl = escapeHtml(input.setupUrl);
  const subject = `Set up your YaoTu ${roleLabel} password`;
  const text = `Your ${roleLabel} account has been created. Please set your password here: ${input.setupUrl}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <p>Hello ${escapedName},</p>
      <p>Your ${roleLabel} account has been created.</p>
      <p>Please set your password here:</p>
      <p><a href="${escapedSetupUrl}">${escapedSetupUrl}</a></p>
      <p>This one-time link expires in 24 hours.</p>
    </div>
  `;

  if (!mailgun.configured) {
    console.warn("[email] Mailgun is not configured. Password setup email was not sent.");
    if (process.env.NODE_ENV !== "production") {
      console.warn("[email] Password setup link:", input.setupUrl);
    }
    return false;
  }

  const body = new URLSearchParams({
    from: mailgun.from!,
    to: input.to,
    subject,
    text,
    html,
  });

  const response = await fetch(`https://api.mailgun.net/v3/${mailgun.domain}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${mailgun.apiKey}`).toString("base64")}`,
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

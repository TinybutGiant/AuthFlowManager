import type { AdminRole } from "@shared/schema";

interface PasswordSetupEmailInput {
  to: string;
  name: string;
  setupUrl: string;
  role: AdminRole;
}

interface OfferLetterEmailInput {
  to: string;
  name: string;
  workspaceUrl: string;
  title: string;
}

interface TraineeOfferSetupEmailInput extends OfferLetterEmailInput {
  setupUrl: string;
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

async function sendMailgunMessage(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
  logLabel: string;
  developmentFallbackUrl?: string;
}): Promise<boolean> {
  const mailgun = getMailgunConfig();

  if (!mailgun.configured) {
    console.warn(`[email] Mailgun is not configured. ${input.logLabel} email was not sent.`);
    if (input.developmentFallbackUrl && process.env.NODE_ENV !== "production") {
      console.warn(`[email] ${input.logLabel} link:`, input.developmentFallbackUrl);
    }
    return false;
  }

  const body = new URLSearchParams({
    from: mailgun.from!,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
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
    console.error(`[email] Mailgun ${input.logLabel} email failed:`, response.status, errorText);
    return false;
  }

  return true;
}

export async function sendAdminPasswordSetupEmail(input: PasswordSetupEmailInput): Promise<boolean> {
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

  return sendMailgunMessage({
    to: input.to,
    subject,
    text,
    html,
    logLabel: "Password setup",
    developmentFallbackUrl: input.setupUrl,
  });
}

export async function sendOfferLetterReadyEmail(input: OfferLetterEmailInput): Promise<boolean> {
  const escapedName = escapeHtml(input.name);
  const escapedWorkspaceUrl = escapeHtml(input.workspaceUrl);
  const escapedTitle = escapeHtml(input.title);
  const subject = "Your Yaotu trainee offer letter is ready for review";
  const text = [
    `Hello ${input.name},`,
    "",
    `Your trainee offer letter "${input.title}" is ready for review.`,
    "Please log in to your trainee workspace to review and accept it.",
    "",
    input.workspaceUrl,
  ].join("\n");
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <p>Hello ${escapedName},</p>
      <p>Your trainee offer letter <strong>${escapedTitle}</strong> is ready for review.</p>
      <p>Please log in to your trainee workspace to review and accept it.</p>
      <p><a href="${escapedWorkspaceUrl}">${escapedWorkspaceUrl}</a></p>
    </div>
  `;

  return sendMailgunMessage({
    to: input.to,
    subject,
    text,
    html,
    logLabel: "Offer letter",
    developmentFallbackUrl: input.workspaceUrl,
  });
}

export async function sendTraineeOfferSetupEmail(input: TraineeOfferSetupEmailInput): Promise<boolean> {
  const escapedName = escapeHtml(input.name);
  const escapedSetupUrl = escapeHtml(input.setupUrl);
  const escapedWorkspaceUrl = escapeHtml(input.workspaceUrl);
  const escapedTitle = escapeHtml(input.title);
  const subject = "Your Yaotu trainee offer letter is ready for review";
  const text = [
    `Hello ${input.name},`,
    "",
    `Your trainee offer letter "${input.title}" is ready for review.`,
    "Please set up your account, log in to the Trainee Workspace, and review and accept the offer letter.",
    "",
    `Set up your account: ${input.setupUrl}`,
    `Trainee Workspace: ${input.workspaceUrl}`,
  ].join("\n");
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <p>Hello ${escapedName},</p>
      <p>Your trainee offer letter <strong>${escapedTitle}</strong> is ready for review.</p>
      <p>Please set up your account, log in to the Trainee Workspace, and review and accept the offer letter.</p>
      <p><a href="${escapedSetupUrl}">Set up your account</a></p>
      <p><a href="${escapedWorkspaceUrl}">Open Trainee Workspace</a></p>
      <p>This one-time setup link expires in 24 hours.</p>
    </div>
  `;

  return sendMailgunMessage({
    to: input.to,
    subject,
    text,
    html,
    logLabel: "Trainee offer setup",
    developmentFallbackUrl: input.setupUrl,
  });
}

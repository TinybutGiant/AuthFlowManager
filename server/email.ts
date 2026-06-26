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
  positionTitle: string;
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

function normalizeOfferPositionTitle(value: string): string {
  let positionTitle = value.trim();

  for (const pattern of [
    /^offer\s+of\s+internship\s+for\s+/i,
    /^offer\s+letter\s+for\s+/i,
    /^trainee\s+offer\s+letter\s+for\s+/i,
  ]) {
    positionTitle = positionTitle.replace(pattern, "").trim();
  }

  positionTitle = positionTitle.replace(/\s+offer\s+letter$/i, "").trim();

  if (!positionTitle || /^offer\s+letter$/i.test(positionTitle)) {
    return "Internship Position";
  }

  return positionTitle;
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
  const positionTitle = normalizeOfferPositionTitle(input.positionTitle);
  const escapedPositionTitle = escapeHtml(positionTitle);
  const subject = `Offer of Internship for ${positionTitle}`;
  const text = [
    `Hi ${input.name},`,
    "",
    `Congratulations! Yaotu Technologies, LLC is pleased to extend you an offer for the position of ${positionTitle}.`,
    "",
    "Your formal offer letter is now available in the Trainee Workspace. Please log in to review the offer details.",
    "",
    `Review Offer Letter: ${input.workspaceUrl}`,
    "",
    "If you have any questions or would like clarification on any aspect of the position, responsibilities, schedule, or next steps, please let us know.",
    "",
    "We would appreciate your response at your earliest convenience so we may proceed with the next steps.",
    "",
    "Congratulations again, and we look forward to the possibility of working together.",
    "",
    "Best regards,",
    "Shengyu",
    "Yaotu Technologies, LLC",
  ].join("\n");
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <p>Hi ${escapedName},</p>
      <p>Congratulations! Yaotu Technologies, LLC is pleased to extend you an offer for the position of <strong>${escapedPositionTitle}</strong>.</p>
      <p>Your formal offer letter is now available in the Trainee Workspace. Please log in to review the offer details.</p>
      <p><a href="${escapedWorkspaceUrl}">Review Offer Letter</a></p>
      <p>If you have any questions or would like clarification on any aspect of the position, responsibilities, schedule, or next steps, please let us know.</p>
      <p>We would appreciate your response at your earliest convenience so we may proceed with the next steps.</p>
      <p>Congratulations again, and we look forward to the possibility of working together.</p>
      <p>Best regards,<br />Shengyu<br />Yaotu Technologies, LLC</p>
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
  const positionTitle = normalizeOfferPositionTitle(input.positionTitle);
  const escapedPositionTitle = escapeHtml(positionTitle);
  const subject = `Offer of Internship for ${positionTitle}`;
  const text = [
    `Hi ${input.name},`,
    "",
    `Congratulations! Yaotu Technologies, LLC is pleased to extend you an offer for the position of ${positionTitle}.`,
    "",
    "Your formal offer letter is now available in the Trainee Workspace. Please set up your account, then review the offer details there.",
    "",
    `Set Up Your Account: ${input.setupUrl}`,
    `Review Offer Letter: ${input.workspaceUrl}`,
    "",
    "If you have any questions or would like clarification on any aspect of the position, responsibilities, schedule, or next steps, please let us know.",
    "",
    "Please note that the one-time account setup link expires in 24 hours.",
    "",
    "Congratulations again, and we look forward to the possibility of working together.",
    "",
    "Best regards,",
    "Shengyu",
    "Yaotu Technologies, LLC",
  ].join("\n");
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <p>Hi ${escapedName},</p>
      <p>Congratulations! Yaotu Technologies, LLC is pleased to extend you an offer for the position of <strong>${escapedPositionTitle}</strong>.</p>
      <p>Your formal offer letter is now available in the Trainee Workspace. Please set up your account, then review the offer details there.</p>
      <p><a href="${escapedSetupUrl}">Set Up Your Account</a></p>
      <p><a href="${escapedWorkspaceUrl}">Review Offer Letter</a></p>
      <p>If you have any questions or would like clarification on any aspect of the position, responsibilities, schedule, or next steps, please let us know.</p>
      <p>Please note that the one-time account setup link expires in 24 hours.</p>
      <p>Congratulations again, and we look forward to the possibility of working together.</p>
      <p>Best regards,<br />Shengyu<br />Yaotu Technologies, LLC</p>
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

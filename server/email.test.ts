import assert from "node:assert/strict";
import test from "node:test";

import { sendAdminPasswordSetupEmail, sendOfferLetterReadyEmail, sendTraineeOfferSetupEmail } from "./email";

const mailEnvKeys = [
  "MAILGUN_API_KEY",
  "MAILGUN_DOMAIN",
  "MAILGUN_FROM",
  "MAIL_FROM",
  "NODE_ENV",
] as const;

function withCleanMailEnv() {
  const previous = Object.fromEntries(mailEnvKeys.map((key) => [key, process.env[key]]));

  for (const key of mailEnvKeys) {
    delete process.env[key];
  }

  return () => {
    for (const key of mailEnvKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

test("password setup email fails clearly when Mailgun is not configured", async () => {
  const restoreEnv = withCleanMailEnv();
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  let fetchCalled = false;

  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error("fetch should not be called without Mailgun config");
  }) as typeof fetch;
  console.warn = () => {};

  try {
    process.env.NODE_ENV = "development";
    const sent = await sendAdminPasswordSetupEmail({
      to: "trainee@example.com",
      name: "Trainee User",
      setupUrl: "http://localhost:5001/set-password?token=test",
      role: "trainee_access",
    });

    assert.equal(sent, false);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    restoreEnv();
  }
});

test("password setup email sends through configured Mailgun", async () => {
  const restoreEnv = withCleanMailEnv();
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedBody = "";

  globalThis.fetch = (async (input, init) => {
    requestedUrl = String(input);
    requestedBody = String(init?.body);
    return new Response("OK", { status: 200 });
  }) as typeof fetch;

  try {
    process.env.MAILGUN_API_KEY = "test-api-key";
    process.env.MAILGUN_DOMAIN = "mg.example.com";
    process.env.MAILGUN_FROM = "YaoTu Admin <admin@mg.example.com>";

    const sent = await sendAdminPasswordSetupEmail({
      to: "trainee@example.com",
      name: "Trainee User",
      setupUrl: "https://admin.example.com/set-password?token=test",
      role: "trainee_access",
    });

    assert.equal(sent, true);
    assert.equal(requestedUrl, "https://api.mailgun.net/v3/mg.example.com/messages");
    assert.match(requestedBody, /to=trainee%40example\.com/);
    assert.match(requestedBody, /subject=Set\+up\+your\+YaoTu\+Trainee\+Access\+password/);
    assert.match(requestedBody, /Your\+Trainee\+Access\+account\+has\+been\+created/);
    assert.doesNotMatch(requestedBody, /Your\+admin\+account\+has\+been\+created/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("password setup email uses access role label in subject and body", async () => {
  const restoreEnv = withCleanMailEnv();
  const originalFetch = globalThis.fetch;
  let requestedBody = "";

  globalThis.fetch = (async (_input, init) => {
    requestedBody = String(init?.body);
    return new Response("OK", { status: 200 });
  }) as typeof fetch;

  try {
    process.env.MAILGUN_API_KEY = "test-api-key";
    process.env.MAILGUN_DOMAIN = "mg.example.com";
    process.env.MAILGUN_FROM = "YaoTu Admin <admin@mg.example.com>";

    const sent = await sendAdminPasswordSetupEmail({
      to: "finance@example.com",
      name: "Finance User",
      setupUrl: "https://admin.example.com/set-password?token=test",
      role: "admin_finance",
    });

    assert.equal(sent, true);
    assert.match(requestedBody, /subject=Set\+up\+your\+YaoTu\+Finance\+Admin\+password/);
    assert.match(requestedBody, /Your\+Finance\+Admin\+account\+has\+been\+created/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("offer letter ready email is formal, link-only, and uses trainee workspace URL", async () => {
  const restoreEnv = withCleanMailEnv();
  const originalFetch = globalThis.fetch;
  let requestedBody = "";

  globalThis.fetch = (async (_input, init) => {
    requestedBody = String(init?.body);
    return new Response("OK", { status: 200 });
  }) as typeof fetch;

  try {
    process.env.MAILGUN_API_KEY = "test-api-key";
    process.env.MAILGUN_DOMAIN = "mg.example.com";
    process.env.MAILGUN_FROM = "YaoTu Admin <admin@mg.example.com>";

    const sent = await sendOfferLetterReadyEmail({
      to: "trainee@example.com",
      name: "Trainee User",
      workspaceUrl: "https://admin.example.com/trainee",
      positionTitle: "Offer Letter for Full-Stack Engineer Intern",
    });

    const form = new URLSearchParams(requestedBody);
    const text = form.get("text") ?? "";
    const html = form.get("html") ?? "";

    assert.equal(sent, true);
    assert.equal(form.get("subject"), "Offer of Internship for Full-Stack Engineer Intern");
    assert.match(text, /Yaotu Technologies, LLC is pleased to extend you an offer/);
    assert.match(text, /Review Offer Letter: https:\/\/admin\.example\.com\/trainee/);
    assert.match(html, />Review Offer Letter<\/a>/);
    assert.doesNotMatch(text, /Set Up Your Account|expires in 24 hours/);
    assert.doesNotMatch(text, /Your trainee offer letter|Offer Letter for Full-Stack Engineer Intern is ready/i);
    assert.doesNotMatch(requestedBody, /attachment|token|bearer|documentId/i);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("trainee offer setup email uses setup and workspace links without document secrets", async () => {
  const restoreEnv = withCleanMailEnv();
  const originalFetch = globalThis.fetch;
  let requestedBody = "";

  globalThis.fetch = (async (_input, init) => {
    requestedBody = String(init?.body);
    return new Response("OK", { status: 200 });
  }) as typeof fetch;

  try {
    process.env.MAILGUN_API_KEY = "test-api-key";
    process.env.MAILGUN_DOMAIN = "mg.example.com";
    process.env.MAILGUN_FROM = "YaoTu Admin <admin@mg.example.com>";

    const sent = await sendTraineeOfferSetupEmail({
      to: "trainee@example.com",
      name: "Trainee User",
      setupUrl: "https://admin.example.com/set-password?token=test",
      workspaceUrl: "https://admin.example.com/trainee",
      positionTitle: "Full-Stack Engineer Intern",
    });

    const form = new URLSearchParams(requestedBody);
    const text = form.get("text") ?? "";
    const html = form.get("html") ?? "";

    assert.equal(sent, true);
    assert.equal(form.get("subject"), "Offer of Internship for Full-Stack Engineer Intern");
    assert.match(text, /Yaotu Technologies, LLC is pleased to extend you an offer/);
    assert.match(text, /Set Up Your Account: https:\/\/admin\.example\.com\/set-password\?token=test/);
    assert.match(text, /Review Offer Letter: https:\/\/admin\.example\.com\/trainee/);
    assert.match(text, /one-time account setup link expires in 24 hours/);
    assert.match(html, />Set Up Your Account<\/a>/);
    assert.match(html, />Review Offer Letter<\/a>/);
    assert.doesNotMatch(text, /Your trainee offer letter|Trainee Workspace:/i);
    assert.doesNotMatch(requestedBody, /attachment|bearer|documentId|fileKey|signedUrl/i);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

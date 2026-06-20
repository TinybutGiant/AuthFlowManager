import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, getApiErrorMessage, throwIfResNotOk } from "./queryClient";

test("throwIfResNotOk exposes JSON error message and status", async () => {
  const response = new Response(
    JSON.stringify({
      message:
        "Admin was activated, but password setup email failed. Use resend setup link after fixing email delivery.",
    }),
    {
      status: 502,
      statusText: "Bad Gateway",
      headers: { "content-type": "application/json" },
    },
  );

  await assert.rejects(
    () => throwIfResNotOk(response),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 502);
      assert.equal(
        error.serverMessage,
        "Admin was activated, but password setup email failed. Use resend setup link after fixing email delivery.",
      );
      assert.match(error.message, /^502:/);
      return true;
    },
  );
});

test("getApiErrorMessage returns server message for API errors", () => {
  const error = new ApiError(400, "Backend validation failed", { message: "Backend validation failed" }, "");

  assert.equal(getApiErrorMessage(error, "Fallback"), "Backend validation failed");
});

test("throwIfResNotOk falls back to text response body", async () => {
  const response = new Response("Plain text failure", {
    status: 500,
    statusText: "Internal Server Error",
  });

  await assert.rejects(
    () => throwIfResNotOk(response),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.serverMessage, "Plain text failure");
      return true;
    },
  );
});

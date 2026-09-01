import assert from "node:assert/strict";
import test from "node:test";

import { comparePassword, hashPassword } from "./passwordHash";

test("password-bearing admin rows still validate through bcrypt", async () => {
  const hash = await hashPassword("correct-password");

  assert.equal(await comparePassword("correct-password", hash), true);
  assert.equal(await comparePassword("wrong-password", hash), false);
});

test("passwordless admin rows fail legacy password login safely", async () => {
  assert.equal(await comparePassword("anything", null), false);
  assert.equal(await comparePassword("anything", undefined), false);
  assert.equal(await comparePassword("anything", ""), false);
});

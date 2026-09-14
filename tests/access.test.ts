import { test } from "node:test";
import assert from "node:assert/strict";
import { issueToken, validToken, matches } from "../server/access.ts";

test("access tokens reject tampering, expiry, and password rotation", () => {
  const password = "a-test-only-password";
  const now = 1_000_000;
  const token = issueToken(password, now);
  assert.equal(validToken(token, password, now), true);
  assert.equal(validToken(token, password, now + 8 * 3600_000), false);
  assert.equal(validToken(token, "rotated-password", now), false);
  assert.equal(
    validToken(
      `${Number(token.split(".")[0]) + 1}.${token.split(".")[1]}`,
      password,
      now,
    ),
    false,
  );
  for (const invalid of ["", "undefined", "1.2.3", `${token}.extra`])
    assert.equal(validToken(invalid, password, now), false);
  assert.equal(matches("abc", "abc"), true);
  assert.equal(matches("abc", "abcd"), false);
});

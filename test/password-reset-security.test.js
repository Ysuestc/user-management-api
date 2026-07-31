import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, jest } from "@jest/globals";
import request from "supertest";
import { createApp } from "../src/app.js";
import { initializeDatabase } from "../src/database.js";
import {
  createPasswordResetTokenService,
  digestPasswordResetToken,
} from "../src/password-reset-tokens.js";

const jwtSecret = "test-only-secret-that-is-at-least-32-characters";
const originalPassword = "correct horse battery staple";

describe("password reset endpoint security", () => {
  let app;
  let database;
  let deliveredTokens;
  let onPasswordResetToken;

  beforeEach(async () => {
    database = initializeDatabase(":memory:");
    deliveredTokens = [];
    onPasswordResetToken = jest.fn(({ token }) => deliveredTokens.push(token));
    app = createApp({ database, jwtSecret, onPasswordResetToken });

    const registered = await request(app).post("/auth/register").send({
      email: "user@example.com",
      password: originalPassword,
      displayName: "Reset User",
    });
    assert.equal(registered.status, 201);
  });

  afterEach(() => database.close());

  async function requestReset(email = "user@example.com") {
    return request(app).post("/auth/password-reset/request").send({ email });
  }

  async function confirmReset(token, password = "a newly secure password") {
    return request(app)
      .post("/auth/password-reset/confirm")
      .send({ token, password });
  }

  it("does not reveal account existence or return a reset token", async () => {
    const existing = await requestReset(" USER@example.com ");
    const missing = await requestReset("missing@example.com");

    assert.equal(existing.status, 202);
    assert.equal(missing.status, 202);
    assert.deepEqual(existing.body, missing.body);
    assert.equal("token" in existing.body, false);
    assert.equal(onPasswordResetToken.mock.calls.length, 1);
  });

  it("delivers the raw token but persists only its digest", async () => {
    await requestReset();
    const [token] = deliveredTokens;
    const stored = database
      .prepare("SELECT token_digest FROM password_reset_tokens")
      .get();

    assert.equal(typeof token, "string");
    assert.equal(stored.token_digest, digestPasswordResetToken(token));
    assert.notEqual(stored.token_digest, token);
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM password_reset_tokens
           WHERE token_digest = ?`,
        )
        .get(token).count,
      0,
    );
  });

  it("rejects expired and incorrect tokens without changing the password", async () => {
    let currentTime = new Date("2026-07-31T08:00:00.000Z");
    const passwordResetTokens = createPasswordResetTokenService({
      database,
      ttlMs: 1_000,
      now: () => currentTime,
      generateToken: () => "expiring-secret-token",
    });
    app = createApp({
      database,
      jwtSecret,
      passwordResetTokens,
      onPasswordResetToken,
    });

    await requestReset();
    const incorrect = await confirmReset("incorrect-secret-token");
    currentTime = new Date("2026-07-31T08:00:01.000Z");
    const expired = await confirmReset("expiring-secret-token");

    assert.equal(incorrect.status, 400);
    assert.equal(incorrect.body.error.code, "INVALID_RESET_TOKEN");
    assert.equal(expired.status, 400);
    assert.deepEqual(expired.body, incorrect.body);

    const login = await request(app).post("/auth/login").send({
      email: "user@example.com",
      password: originalPassword,
    });
    assert.equal(login.status, 200);
  });

  it("does not consume a valid token when the replacement password is weak", async () => {
    await requestReset();
    const [token] = deliveredTokens;

    const weak = await confirmReset(token, "short");
    const strong = await confirmReset(token, "a sufficiently strong password");

    assert.equal(weak.status, 400);
    assert.equal(weak.body.error.code, "VALIDATION_ERROR");
    assert.equal(strong.status, 200);
  });

  it("allows exactly one of two concurrent confirmations", async () => {
    await requestReset();
    const [token] = deliveredTokens;

    const confirmations = await Promise.all([
      confirmReset(token, "first replacement password"),
      confirmReset(token, "second replacement password"),
    ]);

    assert.deepEqual(
      confirmations.map(({ status }) => status).sort(),
      [200, 400],
    );
    assert.equal(
      confirmations.find(({ status }) => status === 400).body.error.code,
      "INVALID_RESET_TOKEN",
    );
  });

  it("switches login credentials and rejects token replay", async () => {
    await requestReset();
    const [token] = deliveredTokens;
    const replacementPassword = "a newly secure password";

    assert.equal((await confirmReset(token, replacementPassword)).status, 200);
    const replay = await confirmReset(token, "another secure password");
    assert.equal(replay.status, 400);
    assert.equal(replay.body.error.code, "INVALID_RESET_TOKEN");

    const oldLogin = await request(app).post("/auth/login").send({
      email: "user@example.com",
      password: originalPassword,
    });
    const newLogin = await request(app).post("/auth/login").send({
      email: "user@example.com",
      password: replacementPassword,
    });
    assert.equal(oldLogin.status, 401);
    assert.equal(newLogin.status, 200);
  });
});

import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, it } from "@jest/globals";
import bcrypt from "bcrypt";
import request from "supertest";
import { createApp } from "../src/app.js";
import { initializeDatabase } from "../src/database.js";

const jwtSecret = "test-only-secret-that-is-at-least-32-characters";

describe("authentication", () => {
  let app;
  let database;

  beforeAll(() => {
    database = initializeDatabase(":memory:");
    app = createApp({ database, jwtSecret });
  });

  afterAll(() => database.close());

  it("registers users with a bcrypt hash and no password disclosure", async () => {
    const response = await request(app).post("/auth/register").send({
      email: " User@Example.com ",
      password: "correct horse battery staple",
      displayName: "Example User",
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.user.email, "user@example.com");
    assert.equal(response.body.user.displayName, "Example User");
    assert.equal("password" in response.body.user, false);
    assert.equal("passwordHash" in response.body.user, false);

    const stored = database
      .prepare("SELECT password_hash FROM users WHERE email = ?")
      .get("user@example.com");
    assert.notEqual(stored.password_hash, "correct horse battery staple");
    assert.equal(
      await bcrypt.compare(
        "correct horse battery staple",
        stored.password_hash,
      ),
      true,
    );
  });

  it("rejects a duplicate email regardless of case", async () => {
    const response = await request(app).post("/auth/register").send({
      email: "USER@example.com",
      password: "another secure password",
      displayName: "Duplicate",
    });

    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, "EMAIL_ALREADY_EXISTS");
  });

  it("returns the same error for an unknown user and a wrong password", async () => {
    const wrongPassword = await request(app).post("/auth/login").send({
      email: "user@example.com",
      password: "wrong password",
    });
    const unknownUser = await request(app).post("/auth/login").send({
      email: "missing@example.com",
      password: "wrong password",
    });

    assert.equal(wrongPassword.status, 401);
    assert.deepEqual(wrongPassword.body, unknownUser.body);
    assert.equal(wrongPassword.body.error.code, "INVALID_CREDENTIALS");
  });

  it("issues a JWT that grants access to a protected route", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "user@example.com",
      password: "correct horse battery staple",
    });
    assert.equal(login.status, 200);
    assert.equal(typeof login.body.token, "string");

    const authenticated = await request(app)
      .get("/auth/session")
      .set("authorization", `Bearer ${login.body.token}`);
    assert.equal(authenticated.status, 200);
    assert.equal(authenticated.body.user.email, "user@example.com");

    const unauthenticated = await request(app).get("/auth/session");
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.body.error.code, "UNAUTHORIZED");
  });

  it("resets a password without revealing whether the email exists", async () => {
    const existing = await request(app)
      .post("/auth/password-reset/request")
      .send({ email: "user@example.com" });
    const missing = await request(app)
      .post("/auth/password-reset/request")
      .send({ email: "missing@example.com" });

    assert.equal(existing.status, 202);
    assert.deepEqual(existing.body, missing.body);
    assert.equal("token" in existing.body, false);
  });

  it("accepts a valid reset token once and changes login credentials", async () => {
    const testApp = createApp({
      database,
      jwtSecret,
      exposePasswordResetToken: true,
    });
    const requested = await request(testApp)
      .post("/auth/password-reset/request")
      .send({ email: "user@example.com" });

    const confirmed = await request(testApp)
      .post("/auth/password-reset/confirm")
      .send({
        token: requested.body.token,
        password: "a newly secure password",
      });
    assert.equal(confirmed.status, 200);

    const oldLogin = await request(app).post("/auth/login").send({
      email: "user@example.com",
      password: "correct horse battery staple",
    });
    const newLogin = await request(app).post("/auth/login").send({
      email: "user@example.com",
      password: "a newly secure password",
    });
    assert.equal(oldLogin.status, 401);
    assert.equal(newLogin.status, 200);

    const reused = await request(testApp)
      .post("/auth/password-reset/confirm")
      .send({
        token: requested.body.token,
        password: "another secure password",
      });
    assert.equal(reused.status, 400);
    assert.equal(reused.body.error.code, "INVALID_RESET_TOKEN");
  });

  it("rejects invalid reset tokens and passwords outside policy", async () => {
    const invalidToken = await request(app)
      .post("/auth/password-reset/confirm")
      .send({ token: "invalid", password: "valid new password" });
    assert.equal(invalidToken.status, 400);
    assert.equal(invalidToken.body.error.code, "INVALID_RESET_TOKEN");

    const weakPassword = await request(app)
      .post("/auth/password-reset/confirm")
      .send({ token: "invalid", password: "short" });
    assert.equal(weakPassword.status, 400);
    assert.equal(weakPassword.body.error.code, "VALIDATION_ERROR");
  });
});

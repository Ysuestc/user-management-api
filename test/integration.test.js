import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../src/app.js";
import { initializeDatabase } from "../src/database.js";

const jwtSecret = "integration-test-secret-that-is-at-least-32-characters";

describe("REST API integration", () => {
  let app;
  let database;
  let userToken;
  let adminToken;

  beforeAll(async () => {
    database = initializeDatabase(":memory:");
    app = createApp({ database, jwtSecret });

    const userRegistration = await request(app).post("/auth/register").send({
      email: "user@example.com",
      password: "correct horse battery staple",
      displayName: "Regular User",
    });
    const adminRegistration = await request(app).post("/auth/register").send({
      email: "admin@example.com",
      password: "admin horse battery staple",
      displayName: "Administrator",
    });

    assert.equal(userRegistration.status, 201);
    assert.equal(adminRegistration.status, 201);
    database
      .prepare("UPDATE users SET role = 'admin' WHERE email = ?")
      .run("admin@example.com");

    const userLogin = await request(app).post("/auth/login").send({
      email: "user@example.com",
      password: "correct horse battery staple",
    });
    const adminLogin = await request(app).post("/auth/login").send({
      email: "admin@example.com",
      password: "admin horse battery staple",
    });
    assert.equal(userLogin.status, 200);
    assert.equal(adminLogin.status, 200);
    userToken = userLogin.body.token;
    adminToken = adminLogin.body.token;
  });

  afterAll(() => database.close());

  it("reports health and validates registration parameters", async () => {
    const health = await request(app).get("/health");
    assert.deepEqual(health.body, { status: "ok" });

    const invalid = await request(app).post("/auth/register").send({
      email: "not-an-email",
      password: "short",
      displayName: "",
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, "VALIDATION_ERROR");

    const duplicate = await request(app).post("/auth/register").send({
      email: "USER@example.com",
      password: "another secure password",
      displayName: "Duplicate",
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.code, "EMAIL_ALREADY_EXISTS");
  });

  it("rejects invalid login credentials and invalid JWTs", async () => {
    const login = await request(app).post("/auth/login").send({
      email: "user@example.com",
      password: "incorrect password",
    });
    assert.equal(login.status, 401);
    assert.equal(login.body.error.code, "INVALID_CREDENTIALS");

    const missingToken = await request(app).get("/users/me");
    assert.equal(missingToken.status, 401);
    assert.equal(missingToken.body.error.code, "UNAUTHORIZED");

    const invalidToken = await request(app)
      .get("/users/me")
      .set("authorization", "Bearer invalid.jwt.token");
    assert.equal(invalidToken.status, 401);
    assert.equal(invalidToken.body.error.code, "UNAUTHORIZED");
  });

  it("uses a JWT to read and update the current profile", async () => {
    const profile = await request(app)
      .get("/users/me")
      .set("authorization", `Bearer ${userToken}`);
    assert.equal(profile.status, 200);
    assert.equal(profile.body.user.email, "user@example.com");
    assert.equal("password_hash" in profile.body.user, false);

    const update = await request(app)
      .patch("/users/me")
      .set("authorization", `Bearer ${userToken}`)
      .send({ display_name: "Updated User" });
    assert.equal(update.status, 200);
    assert.equal(update.body.user.display_name, "Updated User");

    const invalidUpdate = await request(app)
      .patch("/users/me")
      .set("authorization", `Bearer ${userToken}`)
      .send({ role: "admin" });
    assert.equal(invalidUpdate.status, 400);
    assert.equal(invalidUpdate.body.error.code, "VALIDATION_ERROR");
  });

  it("enforces administrator access and omits password hashes", async () => {
    const forbidden = await request(app)
      .get("/admin/users")
      .set("authorization", `Bearer ${userToken}`);
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.error.code, "FORBIDDEN");

    const allowed = await request(app)
      .get("/admin/users")
      .set("authorization", `Bearer ${adminToken}`);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.users.length, 2);
    assert.equal(
      allowed.body.users.some((user) => "password_hash" in user),
      false,
    );
  });
});

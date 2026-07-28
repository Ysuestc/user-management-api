import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import { initializeDatabase } from "../src/database.js";

function testAuthenticate(request, response, next) {
  void response;
  const id = Number(request.get("x-test-user-id"));
  if (Number.isInteger(id)) {
    request.user = request.app.locals.database
      .prepare("SELECT id, role FROM users WHERE id = ?")
      .get(id);
  }
  next();
}

describe("user profiles and administration", () => {
  let app;
  let database;
  let userId;
  let adminId;

  beforeEach(() => {
    database = initializeDatabase(":memory:");
    const insert = database.prepare(
      "INSERT INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, ?)",
    );
    userId = Number(
      insert.run("user@example.com", "secret-user-hash", "User", "user")
        .lastInsertRowid,
    );
    adminId = Number(
      insert.run("admin@example.com", "secret-admin-hash", "Admin", "admin")
        .lastInsertRowid,
    );
    app = createApp({ database, authenticate: testAuthenticate });
    app.locals.database = database;
  });

  afterEach(() => database.close());

  it("requires authentication to read a profile", async () => {
    const response = await request(app).get("/users/me");

    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, "UNAUTHORIZED");
  });

  it("returns the current profile without sensitive fields", async () => {
    const response = await request(app)
      .get("/users/me")
      .set("x-test-user-id", String(userId));

    assert.equal(response.status, 200);
    assert.equal(response.body.user.email, "user@example.com");
    assert.equal(response.body.user.role, "user");
    assert.equal(response.body.user.password_hash, undefined);
  });

  it("updates only allowed profile fields", async () => {
    const response = await request(app)
      .patch("/users/me")
      .set("x-test-user-id", String(userId))
      .send({ email: "new@example.com", display_name: "New Name" });

    assert.equal(response.status, 200);
    assert.equal(response.body.user.email, "new@example.com");
    assert.equal(response.body.user.display_name, "New Name");
    assert.equal(response.body.user.role, "user");
    assert.equal(response.body.user.password_hash, undefined);
  });

  it("rejects unsupported profile fields and duplicate emails", async () => {
    const roleResponse = await request(app)
      .patch("/users/me")
      .set("x-test-user-id", String(userId))
      .send({ role: "admin" });
    assert.equal(roleResponse.status, 400);
    assert.equal(roleResponse.body.error.code, "VALIDATION_ERROR");

    const emailResponse = await request(app)
      .patch("/users/me")
      .set("x-test-user-id", String(userId))
      .send({ email: "admin@example.com" });
    assert.equal(emailResponse.status, 409);
    assert.equal(emailResponse.body.error.code, "EMAIL_IN_USE");
  });

  it("forbids regular users from listing users", async () => {
    const response = await request(app)
      .get("/admin/users")
      .set("x-test-user-id", String(userId));

    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, "FORBIDDEN");
  });

  it("allows admins to list users without password hashes", async () => {
    const response = await request(app)
      .get("/admin/users")
      .set("x-test-user-id", String(adminId));

    assert.equal(response.status, 200);
    assert.equal(response.body.users.length, 2);
    assert.deepEqual(
      response.body.users.map((user) => user.role),
      ["user", "admin"],
    );
    assert.equal(
      response.body.users.some((user) => "password_hash" in user),
      false,
    );
  });
});

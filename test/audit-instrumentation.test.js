import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../src/app.js";
import { initializeDatabase } from "../src/database.js";

const jwtSecret = "test-only-secret-that-is-at-least-32-characters";

function events(database) {
  const rows = database
    .prepare(
      `SELECT actor_user_id, action, target_type, target_id, metadata
       FROM audit_events ORDER BY id`,
    )
    .all();
  return [...rows].map((event) => ({
    ...event,
    metadata: JSON.parse(event.metadata),
  }));
}

describe("audit instrumentation", () => {
  let app;
  let database;

  beforeEach(() => {
    database = initializeDatabase(":memory:");
    app = createApp({
      database,
      jwtSecret,
      exposePasswordResetToken: true,
    });
  });

  afterEach(() => database.close());

  it("records registration and successful and failed login without secrets", async () => {
    const password = "correct horse battery staple";
    const registered = await request(app).post("/auth/register").send({
      email: "person@example.com",
      password,
      displayName: "Person",
    });
    const userId = registered.body.user.id;

    await request(app).post("/auth/login").send({
      email: "person@example.com",
      password,
    });
    await request(app).post("/auth/login").send({
      email: "person@example.com",
      password: "wrong password",
    });

    assert.deepEqual(
      events(database).map(({ action, actor_user_id, target_id }) => ({
        action,
        actor_user_id,
        target_id,
      })),
      [
        {
          action: "user.registered",
          actor_user_id: userId,
          target_id: String(userId),
        },
        {
          action: "auth.login_succeeded",
          actor_user_id: userId,
          target_id: String(userId),
        },
        {
          action: "auth.login_failed",
          actor_user_id: null,
          target_id: "person@example.com",
        },
      ],
    );
    const stored = JSON.stringify(events(database));
    assert.equal(stored.includes(password), false);
    assert.equal(stored.includes("wrong password"), false);
  });

  it("records profile updates and password reset request and success", async () => {
    const registered = await request(app).post("/auth/register").send({
      email: "person@example.com",
      password: "original password",
      displayName: "Person",
    });
    const userId = registered.body.user.id;
    const login = await request(app).post("/auth/login").send({
      email: "person@example.com",
      password: "original password",
    });

    await request(app)
      .patch("/users/me")
      .set("authorization", `Bearer ${login.body.token}`)
      .send({ display_name: "Changed" });
    const requested = await request(app)
      .post("/auth/password-reset/request")
      .send({ email: "person@example.com" });
    await request(app).post("/auth/password-reset/confirm").send({
      token: requested.body.token,
      password: "replacement password",
    });

    const relevant = events(database).slice(2);
    assert.deepEqual(
      relevant.map((event) => ({
        action: event.action,
        actor_user_id: event.actor_user_id,
        target_id: event.target_id,
      })),
      [
        {
          action: "user.profile_updated",
          actor_user_id: userId,
          target_id: String(userId),
        },
        {
          action: "password_reset.requested",
          actor_user_id: null,
          target_id: String(userId),
        },
        {
          action: "password_reset.succeeded",
          actor_user_id: userId,
          target_id: String(userId),
        },
      ],
    );
    assert.deepEqual(relevant[0].metadata, { fields: ["display_name"] });
    assert.equal(
      JSON.stringify(relevant).includes(requested.body.token),
      false,
    );
    assert.equal(
      JSON.stringify(relevant).includes("replacement password"),
      false,
    );
  });

  it("keeps operations available and reports sanitized context if auditing fails", async () => {
    const failures = [];
    const failingApp = createApp({
      database,
      jwtSecret,
      audit: {
        record() {
          throw new Error("audit storage unavailable");
        },
      },
      onAuditError(error, context) {
        failures.push({ error, context });
      },
    });

    const response = await request(failingApp).post("/auth/register").send({
      email: "available@example.com",
      password: "must not be reported",
      displayName: "Available",
    });

    assert.equal(response.status, 201);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].error.message, "audit storage unavailable");
    assert.deepEqual(failures[0].context, {
      action: "user.registered",
      actor_user_id: response.body.user.id,
      target_type: "user",
      target_id: String(response.body.user.id),
    });
    assert.equal(
      JSON.stringify(failures).includes("must not be reported"),
      false,
    );
  });

  it("stays fail-open if the audit error reporter also fails", async () => {
    const failingApp = createApp({
      database,
      jwtSecret,
      audit: {
        record() {
          throw new Error("audit storage unavailable");
        },
      },
      onAuditError() {
        throw new Error("reporter unavailable");
      },
    });

    const response = await request(failingApp).post("/auth/register").send({
      email: "still-available@example.com",
      password: "must remain available",
      displayName: "Still Available",
    });

    assert.equal(response.status, 201);
  });
});

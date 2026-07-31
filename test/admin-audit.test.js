import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "@jest/globals";
import jwt from "jsonwebtoken";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createAuditService } from "../src/audit.js";
import { initializeDatabase } from "../src/database.js";

const jwtSecret = "admin-audit-test-secret-that-is-at-least-32-characters";

describe("admin audit log API", () => {
  let adminToken;
  let app;
  let audit;
  let database;
  let userToken;

  beforeEach(() => {
    database = initializeDatabase(":memory:");
    const insertUser = database.prepare(
      `INSERT INTO users (email, password_hash, display_name, role)
       VALUES (?, 'unused', ?, ?)`,
    );
    const userId = Number(
      insertUser.run("user@example.com", "User", "user").lastInsertRowid,
    );
    const adminId = Number(
      insertUser.run("admin@example.com", "Admin", "admin").lastInsertRowid,
    );

    userToken = jwt.sign({ role: "user" }, jwtSecret, {
      subject: String(userId),
      algorithm: "HS256",
    });
    adminToken = jwt.sign({ role: "admin" }, jwtSecret, {
      subject: String(adminId),
      algorithm: "HS256",
    });
    audit = createAuditService({ database });
    app = createApp({ database, jwtSecret, audit });
  });

  afterEach(() => database.close());

  it("requires authentication and administrator access", async () => {
    const anonymous = await request(app).get("/admin/audit-logs");
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.body.error.code, "UNAUTHORIZED");

    const forbidden = await request(app)
      .get("/admin/audit-logs")
      .set("authorization", `Bearer ${userToken}`);
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.error.code, "FORBIDDEN");
  });

  it("paginates newest-first and filters by action and actor", async () => {
    for (let index = 1; index <= 5; index += 1) {
      audit.record({
        actor_user_id: index % 2 === 0 ? 2 : 1,
        action: index === 3 ? "user.deleted" : "user.updated",
        target_type: "user",
        target_id: String(index),
        metadata: { index },
      });
    }

    const first = await request(app)
      .get("/admin/audit-logs?limit=2&action=user.updated&actor=1")
      .set("authorization", `Bearer ${adminToken}`);
    assert.equal(first.status, 200);
    assert.deepEqual(
      first.body.events.map((event) => event.id),
      [5, 1],
    );
    assert.equal(first.body.next_cursor, null);

    const page = await request(app)
      .get("/admin/audit-logs?limit=2")
      .set("authorization", `Bearer ${adminToken}`);
    assert.equal(page.status, 200);
    assert.deepEqual(
      page.body.events.map((event) => event.id),
      [5, 4],
    );
    assert.equal(page.body.next_cursor, 4);

    const nextPage = await request(app)
      .get(`/admin/audit-logs?limit=2&cursor=${page.body.next_cursor}`)
      .set("authorization", `Bearer ${adminToken}`);
    assert.equal(nextPage.status, 200);
    assert.deepEqual(
      nextPage.body.events.map((event) => event.id),
      [3, 2],
    );
  });

  it("validates pagination and uses bound filter values without leaking secrets", async () => {
    audit.record({
      actor_user_id: 2,
      action: "user' OR 1=1 --",
      target_type: "user",
      target_id: "1",
      metadata: {
        password: "never-return-this",
        token: "nor-this",
        safe: "visible",
      },
    });
    audit.record({
      actor_user_id: 2,
      action: "ordinary",
      target_type: "user",
      target_id: "2",
      metadata: {},
    });

    const filtered = await request(app)
      .get("/admin/audit-logs")
      .query({ action: "user' OR 1=1 --" })
      .set("authorization", `Bearer ${adminToken}`);
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.events.length, 1);
    assert.deepEqual(filtered.body.events[0].metadata, { safe: "visible" });
    assert.equal(
      JSON.stringify(filtered.body).includes("never-return-this"),
      false,
    );
    assert.equal(JSON.stringify(filtered.body).includes("nor-this"), false);

    for (const query of [
      "limit=0",
      "limit=101",
      "cursor=invalid",
      "actor=1 OR 1=1",
    ]) {
      const invalid = await request(app)
        .get(`/admin/audit-logs?${query}`)
        .set("authorization", `Bearer ${adminToken}`);
      assert.equal(invalid.status, 400);
      assert.equal(invalid.body.error.code, "VALIDATION_ERROR");
    }
  });
});

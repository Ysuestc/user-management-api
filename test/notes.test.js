import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../src/app.js";
import { initializeDatabase } from "../src/database.js";

describe("notes", () => {
  let app;
  let database;

  beforeEach(() => {
    database = initializeDatabase(":memory:");
    app = createApp({ database });
  });

  afterEach(() => database.close());

  it("creates notes and lists them in creation order", async () => {
    const firstResponse = await request(app)
      .post("/notes")
      .send({ content: "  First note  " });
    const secondResponse = await request(app)
      .post("/notes")
      .send({ content: "Second note" });

    assert.equal(firstResponse.status, 201);
    assert.deepEqual(firstResponse.body, {
      id: 1,
      content: "First note",
      tags: [],
    });
    assert.equal(secondResponse.status, 201);
    assert.deepEqual(secondResponse.body, {
      id: 2,
      content: "Second note",
      tags: [],
    });

    const listResponse = await request(app).get("/notes");

    assert.equal(listResponse.status, 200);
    assert.deepEqual(listResponse.body, [
      { id: 1, content: "First note", tags: [] },
      { id: 2, content: "Second note", tags: [] },
    ]);
  });

  it("normalizes, saves, and returns tags", async () => {
    const createResponse = await request(app)
      .post("/notes")
      .send({
        content: "Tagged note",
        tags: [" work ", "urgent", "", "work", "   "],
      });

    assert.equal(createResponse.status, 201);
    assert.deepEqual(createResponse.body, {
      id: 1,
      content: "Tagged note",
      tags: ["work", "urgent"],
    });

    const listResponse = await request(app).get("/notes");
    assert.deepEqual(listResponse.body, [createResponse.body]);
  });

  it.each([
    { content: "Note", tags: "work" },
    { content: "Note", tags: [42] },
    {
      content: "Note",
      tags: Array.from({ length: 11 }, (_, index) => `tag-${index}`),
    },
    { content: "Note", tags: ["x".repeat(51)] },
  ])("rejects invalid tags: %j", async (body) => {
    const response = await request(app).post("/notes").send(body);

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "VALIDATION_ERROR");
  });

  it.each([{}, { content: "" }, { content: "   " }, { content: 42 }])(
    "rejects invalid note input: %j",
    async (body) => {
      const response = await request(app).post("/notes").send(body);

      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, "VALIDATION_ERROR");
    },
  );

  it("keeps notes isolated between app instances", async () => {
    await request(app).post("/notes").send({ content: "Local note" });

    const otherDatabase = initializeDatabase(":memory:");
    const otherApp = createApp({ database: otherDatabase });

    try {
      const response = await request(otherApp).get("/notes");
      assert.deepEqual(response.body, []);
    } finally {
      otherDatabase.close();
    }
  });
});

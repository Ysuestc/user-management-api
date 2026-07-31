import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../src/app.js";
import { initializeDatabase } from "../src/database.js";

describe("notes tag API regression", () => {
  let app;
  let database;

  beforeEach(() => {
    database = initializeDatabase(":memory:");
    app = createApp({ database });
  });

  afterEach(() => database.close());

  async function createNote(content, tags) {
    return request(app).post("/notes").send({ content, tags });
  }

  it("creates multiple normalized tags and preserves untagged compatibility", async () => {
    const tagged = await createNote("Release checklist", [
      " work ",
      "urgent",
      "work",
      "",
      "   ",
    ]);
    const untagged = await request(app)
      .post("/notes")
      .send({ content: "Plain note" });

    assert.equal(tagged.status, 201);
    assert.deepEqual(tagged.body, {
      id: 1,
      content: "Release checklist",
      tags: ["work", "urgent"],
    });
    assert.equal(untagged.status, 201);
    assert.deepEqual(untagged.body, {
      id: 2,
      content: "Plain note",
      tags: [],
    });

    const allNotes = await request(app).get("/notes");

    assert.equal(allNotes.status, 200);
    assert.deepEqual(allNotes.body, [tagged.body, untagged.body]);
  });

  it("filters by a normalized exact tag without returning other notes", async () => {
    const work = await createNote("Work", ["work", "urgent"]);
    await createNote("Personal", ["personal"]);
    await createNote("Different case", ["Work"]);
    await request(app).post("/notes").send({ content: "Untagged" });

    const response = await request(app).get("/notes").query({ tag: " work " });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, [work.body]);
  });

  it("returns an empty list for an unknown tag", async () => {
    await createNote("Known", ["known"]);

    const response = await request(app).get("/notes").query({ tag: "unknown" });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, []);
  });

  it.each([
    ["non-array tags", { content: "Note", tags: "work" }],
    ["non-string tag", { content: "Note", tags: ["work", 1] }],
    [
      "too many tags",
      {
        content: "Note",
        tags: Array.from({ length: 11 }, (_, index) => `tag-${index}`),
      },
    ],
    ["overlong tag", { content: "Note", tags: ["x".repeat(51)] }],
  ])("rejects %s", async (_description, body) => {
    const response = await request(app).post("/notes").send(body);

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "VALIDATION_ERROR");
  });

  it.each([
    ["blank", ""],
    ["whitespace-only", "   "],
    ["overlong", "x".repeat(51)],
  ])("rejects a %s tag query", async (_description, tag) => {
    const response = await request(app).get("/notes").query({ tag });

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "VALIDATION_ERROR");
  });

  it("rejects repeated tag query parameters", async () => {
    const response = await request(app).get("/notes?tag=work&tag=urgent");

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "VALIDATION_ERROR");
  });
});

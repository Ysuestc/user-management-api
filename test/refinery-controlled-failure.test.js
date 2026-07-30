import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../src/app.js";
import { initializeDatabase } from "../src/database.js";

describe("Refinery controlled failure drill", () => {
  let app;
  let database;

  beforeEach(() => {
    database = initializeDatabase(":memory:");
    app = createApp({ database });
  });

  afterEach(() => database.close());

  it("reports service health", async () => {
    const response = await request(app).get("/health");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: "ok" });
  });

  it("creates a note (CONTROLLED_FAILURE: intentionally expects 200)", async () => {
    const response = await request(app)
      .post("/notes")
      .send({ content: "Refinery drill" });

    assert.equal(response.status, 201);
    assert.deepEqual(response.body, { id: 1, content: "Refinery drill" });
  });

  it("lists notes", async () => {
    const createResponse = await request(app)
      .post("/notes")
      .send({ content: "Listed note" });
    assert.equal(createResponse.status, 201);

    const response = await request(app).get("/notes");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, [{ id: 1, content: "Listed note" }]);
  });
});

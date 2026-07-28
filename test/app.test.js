import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import express from "express";
import request from "supertest";
import { z } from "zod";
import { createApp } from "../src/app.js";
import { initializeDatabase } from "../src/database.js";
import { errorHandler } from "../src/errors.js";
import { validate } from "../src/validate.js";

describe("API foundation", () => {
  let app;
  let database;

  before(() => {
    database = initializeDatabase(":memory:");
    app = createApp({ database });
  });

  after(() => database.close());

  it("reports service and database health", async () => {
    const response = await request(app).get("/health");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: "ok" });
  });

  it("uses the shared error response for unknown routes", async () => {
    const response = await request(app).get("/missing");

    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, "NOT_FOUND");
    assert.equal(typeof response.body.error.message, "string");
  });

  it("rejects malformed JSON with the shared error response", async () => {
    const response = await request(app)
      .post("/health")
      .set("content-type", "application/json")
      .send('{"broken":');

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "BAD_REQUEST");
  });

  it("validates and normalizes request input for handlers", async () => {
    const validationApp = express();
    validationApp.get(
      "/items",
      validate({
        query: z.object({ limit: z.coerce.number().int().positive() }),
      }),
      (incomingRequest, response) => {
        response.json(incomingRequest.validated.query);
      },
    );
    validationApp.use(errorHandler);

    const validResponse = await request(validationApp).get("/items?limit=3");
    assert.deepEqual(validResponse.body, { limit: 3 });

    const invalidResponse = await request(validationApp).get("/items?limit=no");
    assert.equal(invalidResponse.status, 400);
    assert.equal(invalidResponse.body.error.code, "VALIDATION_ERROR");
  });
});

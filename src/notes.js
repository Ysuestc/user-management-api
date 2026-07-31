import express from "express";
import { z } from "zod";
import { validate } from "./validate.js";

const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 50;

const tagsSchema = z
  .array(z.string().trim().max(MAX_TAG_LENGTH))
  .max(MAX_TAGS)
  .transform((tags) => [...new Set(tags.filter(Boolean))])
  .default([]);

const createNoteSchema = z.object({
  content: z.string().trim().min(1),
  tags: tagsSchema,
});

export function createNotesRouter() {
  const router = express.Router();
  const notes = [];
  let nextId = 1;

  router.post(
    "/notes",
    validate({ body: createNoteSchema }),
    (request, response) => {
      const note = {
        id: nextId,
        content: request.validated.body.content,
        tags: request.validated.body.tags,
      };

      nextId += 1;
      notes.push(note);
      response.status(201).json(note);
    },
  );

  router.get("/notes", (request, response) => {
    void request;
    response.status(200).json(notes);
  });

  return router;
}

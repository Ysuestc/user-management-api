import express from "express";
import { z } from "zod";
import { validate } from "./validate.js";

const createNoteSchema = z.object({
  content: z.string().trim().min(1),
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

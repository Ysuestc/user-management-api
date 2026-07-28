import "dotenv/config";
import path from "node:path";
import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().min(1).default("./data/users.sqlite"),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().min(1).default("1h"),
});

export function loadConfig(environment = process.env) {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    throw new Error(`Invalid configuration: ${result.error.message}`);
  }

  return {
    env: result.data.NODE_ENV,
    port: result.data.PORT,
    databasePath:
      result.data.DATABASE_PATH === ":memory:"
        ? ":memory:"
        : path.resolve(result.data.DATABASE_PATH),
    jwtSecret: result.data.JWT_SECRET,
    jwtExpiresIn: result.data.JWT_EXPIRES_IN,
  };
}

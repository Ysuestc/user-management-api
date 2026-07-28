import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { initializeDatabase } from "./database.js";

const config = loadConfig();
const database = initializeDatabase(config.databasePath);
const app = createApp({ database });

const server = app.listen(config.port, () => {
  console.log(`User management API listening on port ${config.port}`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

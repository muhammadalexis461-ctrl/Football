import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./worker/scheduler";
import { startWorker } from "./worker/worker";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  try {
    const worker = await startWorker();
    if (worker) {
      const scheduler = startScheduler();
      const shutdown = async (signal: string): Promise<void> => {
        logger.info({ signal }, "Shutting down intent engine");
        scheduler.stop();
        await worker.stop();
        server.close(() => process.exit(0));
      };
      process.once("SIGINT", () => void shutdown("SIGINT"));
      process.once("SIGTERM", () => void shutdown("SIGTERM"));
    } else {
      logger.warn("Worker lease unavailable; API will remain available without background processing");
    }
  } catch (error) {
    logger.error({ err: error }, "Failed to start intent engine worker");
  }
});

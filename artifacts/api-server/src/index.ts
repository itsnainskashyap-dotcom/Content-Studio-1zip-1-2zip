import app from "./app";
import { logger } from "./lib/logger";
import { sweepStaleVideoJobs } from "./video/bootSweep";
import { runVideoStudioPreflight } from "./video/preflight";

// Verify FFmpeg + critical env vars BEFORE we start accepting requests
// so a missing dependency surfaces at boot instead of mid-job.
runVideoStudioPreflight();

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Mark any jobs left mid-render by a previous process as failed so
  // the polling UI never sees a frozen "running" state. Fire and
  // forget — failures are logged inside the sweeper.
  void sweepStaleVideoJobs();
});

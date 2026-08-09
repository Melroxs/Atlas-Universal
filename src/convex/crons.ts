// ---------------------------------------------------------------------------
// Scheduled jobs. Health checks run on a real API call — a connection is only
// ever marked healthy by an actual successful test.
// ---------------------------------------------------------------------------

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "connector-health-sweep",
  { hours: 12 },
  internal.connectionsSync.runHealthSweep,
  {},
);

export default crons;

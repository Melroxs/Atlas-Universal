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

// Google Drive event source — honest change POLLING (not webhooks). The
// Drive changes API is polled every 5 minutes; each change is normalized
// into an event envelope and processed through the event substrate.
crons.interval(
  "drive-event-poll",
  { minutes: 5 },
  internal.events.api.pollDriveEvents,
  {},
);

// Workflow durability sweep — expires stale approvals and surfaces drift.
// Timeouts are enforced inside the engine's limits check on every advance.
crons.interval(
  "workflow-sweep",
  { minutes: 15 },
  internal.workflows.engine.sweepWorkflows,
  {},
);

export default crons;

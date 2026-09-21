/**
 * Daily scheduler — no-op in serverless environments.
 * Scheduling is handled by Vercel Cron or external uptime monitors.
 */
export function startDailyScheduler(): void {
  // No-op in serverless — cron jobs run via /api/cron/process-jobs
  console.log('[scheduler] Serverless mode — cron handled externally')
}

/**
 * Next.js Instrumentation
 *
 * Starts background workers and scheduler in the web process.
 * Called once when the Next.js server starts (both dev and production).
 *
 * In production Docker: the standalone worker container handles jobs.
 * In development without the worker: this file provides inline fallback.
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run in Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Check if we should start workers in this process
    // In Docker production, WORKER_MODE=standalone means separate worker container handles jobs
    const workerMode = process.env.WORKER_MODE ?? 'embedded'

    if (workerMode !== 'standalone') {
      // Start BullMQ workers embedded in the web process
      // This is the default for development and single-container deployments
      try {
        const { startWorkers } = await import('./lib/workers/runner')
        await startWorkers()
        console.log('[instrumentation] BullMQ workers started in embedded mode')
      } catch (err) {
        // Non-fatal: if Redis unavailable, jobs run inline as fallback
        console.warn('[instrumentation] Workers not started (Redis may be unavailable):', err)
      }

      // Start the cron scheduler
      try {
        const { startScheduler } = await import('./lib/scheduler/daily')
        startScheduler()
        console.log('[instrumentation] Daily scheduler started')
      } catch (err) {
        console.warn('[instrumentation] Scheduler not started:', err)
      }
    } else {
      console.log('[instrumentation] Worker mode: standalone — workers handled by separate process')
    }
  }
}

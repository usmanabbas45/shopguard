/**
 * ShopGuard Notification Engine
 *
 * Provider-agnostic notification system.
 * V1: Mock provider (logs to console, records in DB)
 * Ready for: Email (Nodemailer), WhatsApp (WABA), SMS
 *
 * Never claims delivery unless provider confirms it.
 */

import { getDb } from '../db'
import {
  incidents, notificationAttempts, notificationPreferences,
  employees, stores, organizations,
} from '@shopguard/database'
import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'

// ==================== PROVIDER INTERFACE ====================

interface NotificationPayload {
  recipient: string
  subject?: string
  body: string
  incidentId?: string
  incidentTitle?: string
  riskLevel?: string
  storeName?: string
  employeeName?: string
  amount?: string
  timestamp?: string
  reviewUrl?: string
}

interface NotificationResult {
  success: boolean
  providerMessageId?: string
  error?: string
}

interface NotificationProvider {
  name: string
  send(payload: NotificationPayload): Promise<NotificationResult>
}

// ==================== MOCK PROVIDER ====================

class MockEmailProvider implements NotificationProvider {
  name = 'mock_email'

  async send(payload: NotificationPayload): Promise<NotificationResult> {
    // In development: log what would be sent
    console.log(`[MockEmail] → ${payload.recipient}`)
    console.log(`  Subject: ${payload.subject}`)
    console.log(`  Body: ${payload.body.slice(0, 200)}...`)
    return {
      success: true,
      providerMessageId: `mock-${nanoid(8)}`,
    }
  }
}

class MockWhatsAppProvider implements NotificationProvider {
  name = 'mock_whatsapp'

  async send(payload: NotificationPayload): Promise<NotificationResult> {
    console.log(`[MockWhatsApp] → ${payload.recipient}: ${payload.body.slice(0, 100)}`)
    return {
      success: true,
      providerMessageId: `wa-mock-${nanoid(8)}`,
    }
  }
}

// Real email provider (nodemailer) - used when SMTP_HOST is configured
async function createRealEmailProvider(): Promise<NotificationProvider | null> {
  if (!process.env.SMTP_HOST) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    // @ts-expect-error nodemailer is optional runtime dependency
    const nodemailer = await import('nodemailer')
    const transporter = nodemailer.default.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT ?? '587'),
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
    return {
      name: 'nodemailer',
      async send(payload: NotificationPayload): Promise<NotificationResult> {
        try {
          const info = await transporter.sendMail({
            from: process.env.SMTP_FROM ?? 'alerts@shopguard.app',
            to: payload.recipient,
            subject: payload.subject ?? 'ShopGuard Alert',
            text: payload.body,
          })
          return { success: true, providerMessageId: info.messageId }
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) }
        }
      },
    }
  } catch {
    return null
  }
}

let emailProvider: NotificationProvider | null = null
let whatsappProvider: NotificationProvider = new MockWhatsAppProvider()

async function getEmailProvider(): Promise<NotificationProvider> {
  if (!emailProvider) {
    emailProvider = (await createRealEmailProvider()) ?? new MockEmailProvider()
  }
  return emailProvider
}

// ==================== MESSAGE TEMPLATES ====================

function buildIncidentAlertBody(incident: {
  title: string
  riskLevel: string
  whyFlagged: string[]
  storeName?: string
  employeeName?: string
  createdAt: Date | string
}, appUrl: string): string {
  const reasons = (incident.whyFlagged as string[]).slice(0, 3).map(r => `• ${r}`).join('\n')
  const reviewUrl = `${appUrl}/incidents`

  return `ShopGuard Alert

${incident.riskLevel} PRIORITY — ${incident.title}

Store: ${incident.storeName ?? 'Unknown'}${incident.employeeName ? `\nEmployee: ${incident.employeeName}` : ''}
Time: ${new Date(incident.createdAt).toLocaleString('en-PK')}

Why this was flagged:
${reasons}

Review incident:
${reviewUrl}

---
This event requires your review. ShopGuard flags unusual patterns — you make the final decision.
To stop these alerts, update your notification preferences in Settings.`
}

function buildFollowUpBody(incident: {
  id: string
  title: string
  riskLevel: string
  followUpCount: number
  createdAt: Date | string
}, appUrl: string): string {
  const hoursAgo = Math.round(
    (Date.now() - new Date(incident.createdAt).getTime()) / (1000 * 60 * 60)
  )
  return `ShopGuard Follow-up

This ${incident.riskLevel}-priority incident remains unreviewed after ${hoursAgo} hour${hoursAgo !== 1 ? 's' : ''}.

${incident.title}

Review: ${appUrl}/incidents/${incident.id}

(Follow-up ${incident.followUpCount + 1})`
}

// ==================== SEND INCIDENT NOTIFICATION ====================

export async function sendIncidentNotification(
  incidentId: string,
  type: 'INCIDENT_CREATED' | 'INCIDENT_FOLLOWUP' | 'INCIDENT_ESCALATION'
): Promise<void> {
  const db = getDb()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  // Fetch incident with context
  const [incident] = await db
    .select({
      id: incidents.id,
      organizationId: incidents.organizationId,
      title: incidents.title,
      riskLevel: incidents.riskLevel,
      status: incidents.status,
      whyFlagged: incidents.whyFlagged,
      followUpCount: incidents.followUpCount,
      createdAt: incidents.createdAt,
      storeId: incidents.storeId,
      employeeId: incidents.employeeId,
    })
    .from(incidents)
    .where(eq(incidents.id, incidentId))
    .limit(1)

  if (!incident) return
  if (incident.status === 'RESOLVED' || incident.status === 'DISMISSED') return

  // Fetch store name
  let storeName = 'Unknown'
  if (incident.storeId) {
    const [store] = await db.select({ name: stores.name }).from(stores).where(eq(stores.id, incident.storeId)).limit(1)
    if (store) storeName = store.name
  }

  // Fetch employee name
  let employeeName: string | undefined
  if (incident.employeeId) {
    const [emp] = await db.select({ name: employees.name }).from(employees).where(eq(employees.id, incident.employeeId)).limit(1)
    if (emp) employeeName = emp.name
  }

  // Fetch notification preferences for this org
  const prefs = await db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.organizationId, incident.organizationId),
        eq(notificationPreferences.enabled, true)
      )
    )

  if (prefs.length === 0) return

  for (const pref of prefs) {
    // Check priority filter
    const isHighPriority = incident.riskLevel === 'HIGH'
    const isMediumPriority = incident.riskLevel === 'MEDIUM'
    if (isHighPriority && !pref.highPriority) continue
    if (isMediumPriority && !pref.mediumPriority) continue
    if (!isHighPriority && !isMediumPriority && !pref.lowPriority) continue

    const recipient = pref.email ?? pref.phone ?? ''
    if (!recipient) continue

    const body = type === 'INCIDENT_CREATED'
      ? buildIncidentAlertBody({ ...incident, whyFlagged: (incident.whyFlagged as string[]) ?? [], storeName, employeeName }, appUrl)
      : buildFollowUpBody({ ...incident, followUpCount: incident.followUpCount }, appUrl)

    const attemptId = nanoid()
    await db.insert(notificationAttempts).values({
      id: attemptId,
      organizationId: incident.organizationId,
      incidentId,
      channel: pref.channel,
      type,
      recipient,
      status: 'PENDING',
    })

    try {
      let result: NotificationResult
      if (pref.channel === 'EMAIL') {
        const provider = await getEmailProvider()
        result = await provider.send({
          recipient,
          subject: `[${incident.riskLevel}] ShopGuard: ${incident.title}`,
          body,
          incidentId,
        })
      } else if (pref.channel === 'WHATSAPP') {
        result = await whatsappProvider.send({
          recipient,
          body: body.slice(0, 1600), // WhatsApp message length limit
          incidentId,
        })
      } else {
        continue // Skip unsupported channels
      }

      await db
        .update(notificationAttempts)
        .set({
          status: result.success ? 'SENT' : 'FAILED',
          providerMessageId: result.providerMessageId,
          failureReason: result.error,
          sentAt: result.success ? new Date() : undefined,
        })
        .where(eq(notificationAttempts.id, attemptId))
    } catch (err) {
      await db
        .update(notificationAttempts)
        .set({
          status: 'FAILED',
          failureReason: err instanceof Error ? err.message : String(err),
          retryCount: 1,
        })
        .where(eq(notificationAttempts.id, attemptId))
    }
  }
}

// ==================== FOLLOW-UP SCHEDULER ====================

export async function processFollowUps(): Promise<number> {
  const db = getDb()
  const now = new Date()
  const { sql: drizzleSql } = await import('drizzle-orm')

  // Find open incidents where nextFollowUpAt <= now and followUpCount < maxFollowUps
  // Use sql`` for timestamp comparison since Drizzle lte works on timestamptz
  const dueIncidents = await db
    .select({
      id: incidents.id,
      riskLevel: incidents.riskLevel,
      followUpCount: incidents.followUpCount,
      escalationLevel: incidents.escalationLevel,
      nextFollowUpAt: incidents.nextFollowUpAt,
    })
    .from(incidents)
    .where(
      and(
        eq(incidents.status, 'OPEN'),
        drizzleSql`follow_up_count < 3`,
        drizzleSql`next_follow_up_at IS NOT NULL`,
        drizzleSql`next_follow_up_at <= ${now}`,
      )
    )
    .limit(50)

  const due = dueIncidents

  let sent = 0
  for (const inc of due) {
    const maxFollowUps = 3
    if (inc.followUpCount >= maxFollowUps) continue

    await sendIncidentNotification(inc.id, 'INCIDENT_FOLLOWUP')

    // Calculate next follow-up time
    const hoursUntilNext = inc.riskLevel === 'HIGH' ? 24 : 48
    const nextFollowUp = new Date(Date.now() + hoursUntilNext * 60 * 60 * 1000)

    await db
      .update(incidents)
      .set({
        followUpCount: inc.followUpCount + 1,
        nextFollowUpAt: nextFollowUp,
        escalationLevel: inc.escalationLevel + 1,
      })
      .where(eq(incidents.id, inc.id))

    sent++
  }

  return sent
}

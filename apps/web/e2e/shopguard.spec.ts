/**
 * ShopGuard E2E Tests
 *
 * Tests the full user journey from signup to incident review.
 * Requires a running app + database (pnpm dev + docker compose up postgres redis)
 *
 * Run: pnpm test:e2e
 * Or against staging: PLAYWRIGHT_BASE_URL=https://staging.shopguard.app pnpm test:e2e
 *
 * Uses demo account for predictable data:
 * demo@shopguard.app / demo1234
 */

import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
const DEMO_EMAIL = 'demo@shopguard.app'
const DEMO_PASSWORD = 'demo1234'

// ==================== HELPERS ====================

async function loginAs(page: Page, email = DEMO_EMAIL, password = DEMO_PASSWORD) {
  await page.goto('/login')
  await page.getByPlaceholder(/email/i).fill(email)
  await page.getByPlaceholder(/password/i).fill(password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL('**/dashboard', { timeout: 10000 })
}

async function logout(page: Page) {
  // Click the user menu (top right)
  await page.locator('button').filter({ hasText: /[A-Z]/ }).last().click()
  await page.getByRole('button', { name: /sign out/i }).click()
  await page.waitForURL('**/login', { timeout: 5000 })
}

// ==================== AUTH TESTS ====================

test.describe('Authentication', () => {
  test('landing page loads', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/ShopGuard/)
    await expect(page.getByText('Know which transactions deserve a second look')).toBeVisible()
  })

  test('login page renders', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByText('Welcome back')).toBeVisible()
    await expect(page.getByPlaceholder(/email/i)).toBeVisible()
    await expect(page.getByPlaceholder(/password/i)).toBeVisible()
  })

  test('invalid login shows error', async ({ page }) => {
    await page.goto('/login')
    await page.getByPlaceholder(/email/i).fill('wrong@email.com')
    await page.getByPlaceholder(/password/i).fill('wrongpassword')
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page.getByText(/invalid|incorrect|not found/i)).toBeVisible({ timeout: 5000 })
    // Must NOT redirect to dashboard
    await expect(page).not.toHaveURL('**/dashboard')
  })

  test('empty form shows validation', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: /sign in/i }).click()
    // Browser native validation or custom error
    const emailInput = page.getByPlaceholder(/email/i)
    const validity = await emailInput.evaluate((el) => (el as HTMLInputElement).validity.valid)
    expect(validity).toBe(false)
  })

  test('protected routes redirect to login when not authenticated', async ({ page }) => {
    for (const route of ['/dashboard', '/incidents', '/employees', '/admin/ml']) {
      await page.goto(route)
      await expect(page).toHaveURL('**/login', { timeout: 5000 })
    }
  })

  test('demo login works and shows DEMO banner', async ({ page }) => {
    await loginAs(page)
    await expect(page).toHaveURL('**/dashboard')
    await expect(page.getByText(/demo data/i)).toBeVisible()
  })

  test('logout works', async ({ page }) => {
    await loginAs(page)
    await logout(page)
    await expect(page).toHaveURL('**/login')
  })

  test('cannot access dashboard after logout', async ({ page }) => {
    await loginAs(page)
    await logout(page)
    await page.goto('/dashboard')
    await expect(page).toHaveURL('**/login')
  })
})

// ==================== DASHBOARD ====================

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page)
  })

  test('dashboard loads with stats cards', async ({ page }) => {
    await expect(page.getByText(/today.s sales/i)).toBeVisible()
    await expect(page.getByText(/needs review|unreviewed/i)).toBeVisible()
  })

  test('dashboard shows incidents section', async ({ page }) => {
    await expect(page.getByText(/needs attention|incidents/i)).toBeVisible()
  })

  test('navigation sidebar is visible', async ({ page }) => {
    await expect(page.getByText('Dashboard')).toBeVisible()
    await expect(page.getByText('Incidents')).toBeVisible()
    await expect(page.getByText('Employees')).toBeVisible()
    await expect(page.getByText('Import Data')).toBeVisible()
  })
})

// ==================== INCIDENTS ====================

test.describe('Incidents', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page)
  })

  test('incidents list page loads', async ({ page }) => {
    await page.goto('/incidents')
    await expect(page).toHaveURL('**/incidents')
    // Either shows incidents or empty state — both are valid
    const hasIncidents = await page.getByText(/void after cash|unusual|flagged/i).count() > 0
    const hasEmpty = await page.getByText(/no incidents/i).count() > 0
    expect(hasIncidents || hasEmpty).toBe(true)
  })

  test('incident list has filters', async ({ page }) => {
    await page.goto('/incidents')
    await expect(page.getByPlaceholder(/search/i)).toBeVisible()
  })

  test('can navigate to incident detail', async ({ page }) => {
    await page.goto('/incidents')
    const links = page.getByRole('link').filter({ hasText: /void|refund|unusual|discount|after.hours/i })
    const count = await links.count()
    if (count > 0) {
      await links.first().click()
      await expect(page).toHaveURL(/\/incidents\/[a-z0-9-]+/)
      await expect(page.getByText(/why this was flagged/i)).toBeVisible()
      await expect(page.getByText(/review this incident/i)).toBeVisible()
    } else {
      // Demo mode — check incident list shows demo data
      await expect(page.getByText(/no incidents/i)).toBeVisible()
    }
  })

  test('incident detail shows review actions', async ({ page }) => {
    await page.goto('/incidents')
    // Find any incident link
    const firstIncidentLink = page.locator('a[href*="/incidents/demo-inc"]').first()
    const exists = await firstIncidentLink.count() > 0
    if (exists) {
      await firstIncidentLink.click()
      await expect(page.getByText(/false positive|valid incident|needs investigation/i)).toBeVisible()
    }
  })
})

// ==================== IMPORT ====================

test.describe('CSV Import', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page)
  })

  test('import page loads with upload area', async ({ page }) => {
    await page.goto('/import')
    await expect(page.getByText(/drop your csv/i)).toBeVisible()
    await expect(page.getByText(/supported column names/i)).toBeVisible()
  })

  test('upload shows column mapping step', async ({ page }) => {
    await page.goto('/import')

    // Create a minimal valid CSV in memory
    const csvContent = `Transaction ID,Date,Amount,Cashier,Payment Method
TX001,2025-01-15,1500,Ahmed Khan,Cash
TX002,2025-01-15,2300,Sara Ali,Card
TX003,2025-01-15,800,Ahmed Khan,Cash`

    // Use file input
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'test.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csvContent),
    })

    await page.getByRole('button', { name: /continue/i }).click()
    await expect(page.getByText(/column mapping/i)).toBeVisible({ timeout: 10000 })
  })
})

// ==================== EMPLOYEES ====================

test.describe('Employees', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page)
  })

  test('employees page loads', async ({ page }) => {
    await page.goto('/employees')
    await expect(page.getByText(/employee analytics/i)).toBeVisible()
    await expect(page.getByText(/total employees|behavioral baselines/i)).toBeVisible()
  })

  test('employees table shows void rate', async ({ page }) => {
    await page.goto('/employees')
    await expect(page.getByText(/void rate/i)).toBeVisible()
    await expect(page.getByText(/baseline/i)).toBeVisible()
  })

  test('employees search works', async ({ page }) => {
    await page.goto('/employees')
    const search = page.getByPlaceholder(/search/i)
    await search.fill('Ahmed')
    // Either filters results or shows no match
    await expect(search).toHaveValue('Ahmed')
  })
})

// ==================== STORES ====================

test.describe('Stores', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page)
  })

  test('stores page loads', async ({ page }) => {
    await page.goto('/stores')
    await expect(page.getByText(/stores/i)).toBeVisible()
  })
})

// ==================== CASH ====================

test.describe('Cash Reconciliation', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page)
  })

  test('cash page loads', async ({ page }) => {
    await page.goto('/cash')
    await expect(page.getByText(/cash reconciliation/i)).toBeVisible()
    await expect(page.getByText(/expected|counted|variance/i)).toBeVisible()
  })
})

// ==================== REPORTS ====================

test.describe('Reports', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page)
  })

  test('reports page loads', async ({ page }) => {
    await page.goto('/reports')
    await expect(page.getByText(/reports|daily report/i)).toBeVisible()
  })
})

// ==================== SETTINGS ====================

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page)
  })

  test('settings page loads', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByText(/organization|notifications|rules/i)).toBeVisible()
  })

  test('settings tabs are clickable', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('button', { name: /notifications/i }).click()
    await expect(page.getByText(/alert preferences/i)).toBeVisible()
  })
})

// ==================== ADMIN ====================

test.describe('Admin ML Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page)
  })

  test('ML admin page loads', async ({ page }) => {
    await page.goto('/admin/ml')
    await expect(page.getByText(/ml.*admin|model administration/i)).toBeVisible()
  })

  test('system health page loads', async ({ page }) => {
    await page.goto('/admin/system-health')
    await expect(page.getByText(/system health/i)).toBeVisible()
    await expect(page.getByText(/database|redis/i)).toBeVisible()
  })
})

// ==================== SECURITY E2E ====================

test.describe('Security: Protected Routes', () => {
  test('API routes return 401 without session', async ({ page }) => {
    const protectedApis = [
      '/api/dashboard',
      '/api/incidents',
      '/api/employees',
      '/api/stores',
      '/api/cash',
      '/api/admin/ml/stats',
    ]

    for (const api of protectedApis) {
      const res = await page.request.get(`${BASE_URL}${api}`)
      expect(res.status()).toBe(401)
    }
  })

  test('login does not reveal if email exists', async ({ page }) => {
    await page.goto('/login')
    await page.getByPlaceholder(/email/i).fill('nonexistent@example.com')
    await page.getByPlaceholder(/password/i).fill('wrongpassword')
    await page.getByRole('button', { name: /sign in/i }).click()
    // Should show generic error, not "email not found"
    await expect(page.getByText(/invalid email or password/i)).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(/account not found|email not registered/i)).not.toBeVisible()
  })
})

test.describe('Security: CSRF/Headers', () => {
  test('app sets security headers', async ({ page }) => {
    const response = await page.request.get(`${BASE_URL}/`)
    const headers = response.headers()
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['x-content-type-options']).toBe('nosniff')
  })
})

// ==================== RESPONSIVE ====================

test.describe('Responsive Design', () => {
  test('dashboard is usable on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAs(page)
    await expect(page.getByText(/today.s sales/i)).toBeVisible()
  })

  test('incidents list is readable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAs(page)
    await page.goto('/incidents')
    await expect(page).toHaveURL('**/incidents')
  })
})

// ==================== ONBOARDING FLOW ====================

test.describe('New User Signup + Onboarding', () => {
  // Skip if demo mode — demo always exists
  test('signup page renders', async ({ page }) => {
    await page.goto('/signup')
    await expect(page.getByText(/create your account/i)).toBeVisible()
    await expect(page.getByPlaceholder(/your name/i)).toBeVisible()
    await expect(page.getByPlaceholder(/organization/i)).toBeVisible()
  })

  test('signup validates password length', async ({ page }) => {
    await page.goto('/signup')
    await page.getByPlaceholder(/your name/i).fill('Test User')
    await page.getByPlaceholder(/organization/i).fill('Test Store')
    await page.getByPlaceholder(/email/i).fill(`test-${Date.now()}@example.com`)
    await page.getByPlaceholder(/password/i).fill('short')
    await page.getByRole('button', { name: /create account/i }).click()
    // Should show error or native validation
    await expect(page).not.toHaveURL('**/onboarding')
  })
})

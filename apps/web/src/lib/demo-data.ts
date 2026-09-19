// ShopGuard Demo Data Generator
// Generates realistic synthetic data for demo purposes
// NEVER mixes with production data

import { generateId } from './utils'

interface DemoTransaction {
  id: string
  externalTransactionId: string
  timestamp: Date
  employeeId: string
  employeeName: string
  storeId: string
  storeName: string
  registerId: string
  registerName: string
  grossAmount: number
  netAmount: number
  discountAmount: number
  refundAmount: number
  paymentMethod: string
  isVoid: boolean
  isRefund: boolean
  isNoSale: boolean
  hasPriceOverride: boolean
  discountPercent: number
  itemCount: number
}

// Seeded random for reproducibility
function seededRandom(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }
}

export function generateDemoData() {
  const rand = seededRandom(42) // deterministic seed

  const stores = [
    { id: 'demo-store-1', name: 'Main Branch', code: 'MB' },
    { id: 'demo-store-2', name: 'North Outlet', code: 'NO' },
    { id: 'demo-store-3', name: 'Mall Counter', code: 'MC' },
  ]

  const registers = [
    { id: 'demo-reg-1', storeId: 'demo-store-1', name: 'Counter 1', code: 'C1' },
    { id: 'demo-reg-2', storeId: 'demo-store-1', name: 'Counter 2', code: 'C2' },
    { id: 'demo-reg-3', storeId: 'demo-store-2', name: 'Main Till', code: 'MT' },
    { id: 'demo-reg-4', storeId: 'demo-store-3', name: 'Mall Register', code: 'MR' },
  ]

  const employees = [
    { id: 'demo-emp-1', name: 'Ahmed Khan', storeId: 'demo-store-1' },
    { id: 'demo-emp-2', name: 'Sara Ali', storeId: 'demo-store-1' },
    { id: 'demo-emp-3', name: 'Bilal Rashid', storeId: 'demo-store-1' },
    { id: 'demo-emp-4', name: 'Fatima Malik', storeId: 'demo-store-2' },
    { id: 'demo-emp-5', name: 'Hassan Mirza', storeId: 'demo-store-2' },
    { id: 'demo-emp-6', name: 'Zara Sheikh', storeId: 'demo-store-3' },
    { id: 'demo-emp-7', name: 'Usman Tariq', storeId: 'demo-store-3' },
  ]

  const paymentMethods = ['cash', 'cash', 'cash', 'card', 'card', 'mobile']
  const transactions: DemoTransaction[] = []

  // Generate 60 days of transactions
  const now = new Date()
  const startDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)

  let txNum = 1000

  for (let day = 0; day < 60; day++) {
    const date = new Date(startDate.getTime() + day * 24 * 60 * 60 * 1000)
    const isWeekend = date.getDay() === 5 || date.getDay() === 6 // Fri/Sat busy
    const volumeMultiplier = isWeekend ? 1.5 : 1.0

    for (const store of stores) {
      const storeEmployees = employees.filter(e => e.storeId === store.id)
      const storeRegisters = registers.filter(r => r.storeId === store.id)
      const dailyVolume = Math.floor((80 + rand() * 60) * volumeMultiplier)

      for (let t = 0; t < dailyVolume; t++) {
        const hour = Math.floor(8 + rand() * 13) // 8am-9pm
        const minute = Math.floor(rand() * 60)
        const timestamp = new Date(date)
        timestamp.setHours(hour, minute, Math.floor(rand() * 60))

        const employee = storeEmployees[Math.floor(rand() * storeEmployees.length)]
        const register = storeRegisters[Math.floor(rand() * storeRegisters.length)]
        const paymentMethod = paymentMethods[Math.floor(rand() * paymentMethods.length)]

        const baseAmount = 200 + rand() * 4800 // PKR 200-5000
        const grossAmount = Math.round(baseAmount)
        const discountPct = rand() < 0.15 ? Math.round(rand() * 15) : 0
        const discountAmount = Math.round(grossAmount * discountPct / 100)
        const netAmount = grossAmount - discountAmount

        const isVoid = rand() < 0.02 // 2% void rate normally
        const isRefund = !isVoid && rand() < 0.015 // 1.5% refund rate
        const isNoSale = !isVoid && !isRefund && rand() < 0.01
        const hasPriceOverride = !isVoid && rand() < 0.03

        transactions.push({
          id: `demo-tx-${txNum++}`,
          externalTransactionId: `TX${txNum}`,
          timestamp,
          employeeId: employee.id,
          employeeName: employee.name,
          storeId: store.id,
          storeName: store.name,
          registerId: register.id,
          registerName: register.name,
          grossAmount,
          netAmount: isVoid ? 0 : (isRefund ? -netAmount : netAmount),
          discountAmount,
          refundAmount: isRefund ? netAmount : 0,
          paymentMethod,
          isVoid,
          isRefund,
          isNoSale,
          hasPriceOverride,
          discountPercent: discountPct,
          itemCount: Math.floor(1 + rand() * 8),
        })
      }
    }
  }

  // Inject SYNTHETIC ANOMALIES (clearly documented)
  // Anomaly 1: Bilal (demo-emp-3) - high void rate in last 7 days
  const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const bilalTxs = transactions.filter(t => t.employeeId === 'demo-emp-3' && t.timestamp > last7Days)
  // Make 15% of Bilal's recent transactions voids (normal is 2%)
  bilalTxs.slice(0, Math.floor(bilalTxs.length * 0.15)).forEach(tx => {
    tx.isVoid = true
    tx.netAmount = 0
  })

  // Anomaly 2: Void after cash at demo-store-1 - last 3 days
  const last3Days = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)
  const cashTxs = transactions.filter(t => 
    t.storeId === 'demo-store-1' && 
    t.paymentMethod === 'cash' && 
    !t.isVoid && 
    t.timestamp > last3Days
  ).slice(0, 5)
  
  cashTxs.forEach(cashTx => {
    const voidTx: DemoTransaction = {
      ...cashTx,
      id: `demo-tx-anomaly-${txNum++}`,
      externalTransactionId: `TX${txNum}`,
      timestamp: new Date(cashTx.timestamp.getTime() + 30000), // 30s later
      isVoid: true,
      netAmount: 0,
      grossAmount: cashTx.grossAmount,
    }
    transactions.push(voidTx)
  })

  // Anomaly 3: After-hours transactions at demo-store-2
  for (let i = 0; i < 3; i++) {
    const date = new Date(now.getTime() - (i + 1) * 24 * 60 * 60 * 1000)
    date.setHours(23, 30, 0)
    transactions.push({
      id: `demo-tx-night-${i}`,
      externalTransactionId: `TX-NIGHT-${i}`,
      timestamp: date,
      employeeId: 'demo-emp-4',
      employeeName: 'Fatima Malik',
      storeId: 'demo-store-2',
      storeName: 'North Outlet',
      registerId: 'demo-reg-3',
      registerName: 'Main Till',
      grossAmount: 15000 + i * 3000,
      netAmount: 15000 + i * 3000,
      discountAmount: 0,
      refundAmount: 0,
      paymentMethod: 'cash',
      isVoid: false,
      isRefund: false,
      isNoSale: false,
      hasPriceOverride: false,
      discountPercent: 0,
      itemCount: 3,
    })
  }

  return { stores, registers, employees, transactions }
}

export function generateDemoIncidents() {
  const incidents = [
    {
      id: 'demo-inc-1',
      type: 'void_after_cash',
      title: 'Void After Cash Payment',
      summary: 'Multiple voids occurred shortly after cash payments on the same register',
      riskLevel: 'HIGH',
      severity: 'HIGH',
      status: 'OPEN',
      storeId: 'demo-store-1',
      storeName: 'Main Branch',
      employeeId: 'demo-emp-3',
      employeeName: 'Bilal Rashid',
      registerId: 'demo-reg-1',
      whyFlagged: [
        'Void occurred 28 seconds after a cash payment',
        'Employee void rate (14.2%) is 7x above recent baseline (2.1%)',
        'Similar pattern occurred 4 times this week',
      ],
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    },
    {
      id: 'demo-inc-2',
      type: 'after_hours',
      title: 'After-Hours Cash Transactions',
      summary: 'High-value cash transactions recorded at 11:30 PM, outside normal store hours',
      riskLevel: 'HIGH',
      severity: 'HIGH',
      status: 'OPEN',
      storeId: 'demo-store-2',
      storeName: 'North Outlet',
      employeeId: 'demo-emp-4',
      employeeName: 'Fatima Malik',
      registerId: 'demo-reg-3',
      whyFlagged: [
        'Transaction at 23:30 is outside normal operating hours (08:00–22:00)',
        'Amount (PKR 15,000) is unusually high for this time',
        'Cash payment method increases review priority',
        'Occurred 3 nights in a row',
      ],
      createdAt: new Date(Date.now() - 18 * 60 * 60 * 1000),
    },
    {
      id: 'demo-inc-3',
      type: 'excessive_discount',
      title: 'Excessive Discount Applied',
      summary: 'A 65% discount was applied — significantly above the store average of 8%',
      riskLevel: 'MEDIUM',
      severity: 'MEDIUM',
      status: 'OPEN',
      storeId: 'demo-store-3',
      storeName: 'Mall Counter',
      employeeId: 'demo-emp-6',
      employeeName: 'Zara Sheikh',
      registerId: 'demo-reg-4',
      whyFlagged: [
        'Discount of 65% applied — significantly above store average (8%)',
        'Employee discount rate (18%) is already above store baseline (8%)',
        'Cash payment — no digital receipt trail',
      ],
      createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
    },
    {
      id: 'demo-inc-4',
      type: 'repeated_voids',
      title: 'Unusual Void Pattern',
      summary: "Employee's void rate has increased significantly in the past 7 days",
      riskLevel: 'HIGH',
      severity: 'HIGH',
      status: 'UNDER_REVIEW',
      storeId: 'demo-store-1',
      storeName: 'Main Branch',
      employeeId: 'demo-emp-3',
      employeeName: 'Bilal Rashid',
      registerId: 'demo-reg-2',
      whyFlagged: [
        "Employee's void rate this week (14.2%) is 7x above their 30-day baseline (2.1%)",
        "Store baseline void rate is 2.4% — employee is 5.9x above store average",
        "11 voids in 7 days vs expected 1-2 based on transaction volume",
      ],
      createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
    {
      id: 'demo-inc-5',
      type: 'large_refund',
      title: 'Unusually Large Refund',
      summary: 'Refund of PKR 24,500 processed — 6x above average transaction for this store',
      riskLevel: 'MEDIUM',
      severity: 'MEDIUM',
      status: 'RESOLVED',
      storeId: 'demo-store-2',
      storeName: 'North Outlet',
      employeeId: 'demo-emp-5',
      employeeName: 'Hassan Mirza',
      registerId: 'demo-reg-3',
      whyFlagged: [
        'Refund amount (PKR 24,500) is 4.2 standard deviations above store average',
        'No original sale reference found for this refund',
      ],
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    },
  ]
  
  return incidents
}

export function generateDashboardStats() {
  return {
    todaySales: 487250,
    cashExpected: 185300,
    cashCounted: 183900,
    cashVariance: -1400,
    highPriorityCount: 3,
    mediumPriorityCount: 4,
    lowPriorityCount: 2,
    reviewedToday: 2,
    unreviewedCount: 7,
    currency: 'PKR',
    transactionCount: 342,
    voidCount: 8,
    refundCount: 5,
    avgTransactionAmount: 1424,
  }
}

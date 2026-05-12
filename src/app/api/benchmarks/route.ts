import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const benchmarks = await prisma.benchmark.findMany()
    return NextResponse.json(benchmarks)
  } catch (err) {
    console.error('[GET /api/benchmarks]', err)
    return NextResponse.json({ error: 'Failed to load benchmarks' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const updates = await req.json() as Array<{
      metric: string
      warningThreshold: number | null
      criticalThreshold: number | null
      inactivityDays: number | null
    }>

    const results = await Promise.all(
      updates.map((u) =>
        prisma.benchmark.upsert({
          where: { metric: u.metric },
          update: {
            warningThreshold: u.warningThreshold,
            criticalThreshold: u.criticalThreshold,
            inactivityDays: u.inactivityDays,
          },
          create: {
            metric: u.metric,
            warningThreshold: u.warningThreshold,
            criticalThreshold: u.criticalThreshold,
            inactivityDays: u.inactivityDays,
          },
        })
      )
    )

    return NextResponse.json(results)
  } catch (err) {
    console.error('[PUT /api/benchmarks]', err)
    return NextResponse.json({ error: 'Failed to save benchmarks' }, { status: 500 })
  }
}

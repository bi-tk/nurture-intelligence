import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import jsforce from 'jsforce'

export async function GET() {
  try {
    const integrations = await prisma.integration.findMany()
    return NextResponse.json(integrations)
  } catch (err) {
    console.error('[GET /api/integrations]', err)
    return NextResponse.json({ error: 'Failed to load integrations' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Credential validators — actually hit the OAuth endpoint before saving
// ---------------------------------------------------------------------------

async function validateSalesforce(creds: Record<string, string>): Promise<{ error: string | null; accessToken?: string; instanceUrl?: string }> {
  const { instanceUrl, clientId, clientSecret, username, passwordWithToken } = creds
  if (!instanceUrl || !clientId || !clientSecret || !username || !passwordWithToken) {
    return { error: 'Missing required fields' }
  }

  try {
    const conn = new jsforce.Connection({
      loginUrl: 'https://login.salesforce.com',
    })
    const loginPromise = conn.login(username, passwordWithToken)
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Login timed out after 15s')), 15000)
    )
    await Promise.race([loginPromise, timeoutPromise])
    return { error: null, accessToken: conn.accessToken ?? undefined, instanceUrl: conn.instanceUrl }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { error: `Salesforce login failed: ${msg}` }
  }
}

async function validatePardot(settings: Record<string, string>) {
  const { businessUnitId } = settings

  if (!businessUnitId) {
    return { error: 'Missing Business Unit ID' }
  }

  // Reuse the Salesforce access token already stored from the Salesforce integration.
  // Pardot lives in the same org — no separate OAuth needed.
  const sfIntegration = await prisma.integration.findUnique({ where: { platform: 'salesforce' } })
  const storedSettings = sfIntegration?.settings as Record<string, string> | null
  const sfAccessToken = storedSettings?.accessToken

  if (!sfAccessToken) {
    return { error: 'Connect Salesforce first — Pardot uses the same Salesforce session.' }
  }

  // Probe the Pardot API using the Salesforce access token (10s timeout)
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)

    let pardotRes: Response
    try {
      pardotRes = await fetch('https://pi.pardot.com/api/v5/objects/lists?fields=id&limit=1', {
        headers: {
          Authorization: `Bearer ${sfAccessToken}`,
          'Pardot-Business-Unit-Id': businessUnitId,
        },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }

    if (!pardotRes.ok) {
      const errText = await pardotRes.text().catch(() => pardotRes.statusText)
      return { error: `Pardot API error (${pardotRes.status}): ${errText}. Verify your Business Unit ID is correct.` }
    }
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError'
    return { error: isTimeout ? 'Pardot API timed out. Check your Business Unit ID and try again.' : 'Could not reach pi.pardot.com. Check your network and try again.' }
  }

  return { error: null, accessToken: sfAccessToken }
}

// ---------------------------------------------------------------------------
// PUT — validate then save
// ---------------------------------------------------------------------------

export async function PUT(req: NextRequest) {
  try {
    const { platform, status, metadata } = await req.json() as {
      platform: string
      status: string
      metadata?: Record<string, string>
    }

    // Only validate when actively connecting (not on disconnect)
    let settingsToStore: Record<string, string> | undefined = metadata
    if (status === 'connected' && metadata) {
      if (platform === 'salesforce') {
        const result = await validateSalesforce(metadata)
        if (result.error) {
          return NextResponse.json({ error: result.error }, { status: 400 })
        }
        settingsToStore = {
          ...metadata,
          ...(result.accessToken ? { accessToken: result.accessToken } : {}),
          ...(result.instanceUrl ? { instanceUrl: result.instanceUrl } : {}),
        }
      } else if (platform === 'pardot') {
        const result = await validatePardot(metadata)
        if (result.error) {
          return NextResponse.json({ error: result.error }, { status: 400 })
        }
        settingsToStore = {
          ...metadata,
          ...(result.accessToken ? { accessToken: result.accessToken } : {}),
        }
      }
    }

    const integration = await prisma.integration.upsert({
      where: { platform },
      update: {
        status,
        settings: settingsToStore ?? undefined,
        lastSyncAt: status === 'connected' ? new Date() : undefined,
        syncStatus: status === 'connected' ? 'success' : undefined,
      },
      create: {
        platform,
        status,
        settings: settingsToStore ?? undefined,
      },
    })

    return NextResponse.json(integration)
  } catch (err) {
    console.error('[PUT /api/integrations]', err)
    return NextResponse.json({ error: 'Failed to update integration' }, { status: 500 })
  }
}

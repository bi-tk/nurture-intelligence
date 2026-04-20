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
    await conn.login(username, passwordWithToken)
    return { error: null, accessToken: conn.accessToken ?? undefined, instanceUrl: conn.instanceUrl }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { error: `Salesforce login failed: ${msg}` }
  }
}

async function validatePardot(settings: Record<string, string>) {
  const { businessUnitId, clientId, clientSecret } = settings

  try {
    // Step 1: Get OAuth token from Salesforce
    const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })

    const tokenData = await tokenRes.json()

    if (!tokenData.access_token) {
      return { error: `Pardot OAuth failed: ${tokenData.error_description || tokenData.error || 'no token returned'}` }
    }

    // Step 2: Test Pardot API access
    const pardotRes = await fetch(
      `https://pi.pardot.com/api/v5/objects/emails?limit=1`,
      {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Pardot-Business-Unit-Id': businessUnitId,
        },
      }
    )

    if (!pardotRes.ok) {
      const errText = await pardotRes.text()
      return { error: `Pardot API error: ${pardotRes.status} ${errText}` }
    }

    return { error: null, accessToken: tokenData.access_token }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { error: `Pardot connection failed: ${msg}` }
  }
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

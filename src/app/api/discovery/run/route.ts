import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const SF_API_VERSION = 'v59.0'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FieldDescribe {
  name: string
  label: string
  type: string
  picklistValues?: Array<{ value: string; label: string; active: boolean }>
}

interface ObjectDescribeResult {
  fields: FieldDescribe[]
}

interface Creds {
  instanceUrl?: string
  accessToken?: string
  businessUnitId?: string
}

interface Finding {
  concept: string
  platform: string
  object: string
  fieldApiName: string | null
  detectedLogic: string
  confidenceScore: number
}

// ─── Salesforce REST describe — no jsforce, no OAuth refresh ──────────────────

async function describeSfObject(
  instanceUrl: string,
  accessToken: string,
  objectName: string
): Promise<ObjectDescribeResult | null> {
  try {
    const res = await fetch(
      `${instanceUrl}/services/data/${SF_API_VERSION}/sobjects/${objectName}/describe`,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } }
    )
    if (!res.ok) return null
    return await res.json() as ObjectDescribeResult
  } catch {
    return null
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function matchesKeywords(s: string, keywords: string[]): boolean {
  const lower = s.toLowerCase()
  return keywords.some((k) => lower.includes(k))
}

function findFields(desc: ObjectDescribeResult | null, keywords: string[]): FieldDescribe[] {
  if (!desc) return []
  return desc.fields.filter(
    (f) => matchesKeywords(f.name, keywords) || matchesKeywords(f.label, keywords)
  )
}

function picklistContains(field: FieldDescribe, keywords: string[]): string[] {
  return (field.picklistValues ?? [])
    .filter((v) => v.active && matchesKeywords(v.value + ' ' + v.label, keywords))
    .map((v) => v.label)
}

// ─── Concept detectors ────────────────────────────────────────────────────────

async function detectMQL(instanceUrl: string, accessToken: string, findings: Finding[]) {
  const [leadDesc, contactDesc] = await Promise.all([
    describeSfObject(instanceUrl, accessToken, 'Lead'),
    describeSfObject(instanceUrl, accessToken, 'Contact'),
  ])

  const mqlKeywords = ['mql', 'marketing_qualified', 'marketing qualified', 'mql_date', 'mqldate']
  const statusKeywords = ['mql', 'marketing qualified', 'qualified lead']

  const leadFields = findFields(leadDesc, mqlKeywords)
  const leadStatusField = leadDesc?.fields.find((f) => f.name === 'Status')
  const mqlStatuses = leadStatusField ? picklistContains(leadStatusField, statusKeywords) : []
  const contactFields = findFields(contactDesc, mqlKeywords)

  let detectedLogic = ''
  let confidence = 0.3
  const objectsFound: string[] = []
  const fieldApiNames: string[] = []

  if (leadFields.length > 0) {
    objectsFound.push('Lead')
    fieldApiNames.push(...leadFields.map((f) => f.name))
    detectedLogic += `Lead fields detected: ${leadFields.map((f) => `${f.name} (${f.label})`).join(', ')}. `
    confidence += 0.3
  }
  if (mqlStatuses.length > 0) {
    detectedLogic += `Lead.Status picklist includes MQL values: "${mqlStatuses.join('", "')}". `
    confidence += 0.2
  }
  if (contactFields.length > 0) {
    objectsFound.push('Contact')
    fieldApiNames.push(...contactFields.map((f) => f.name))
    detectedLogic += `Contact fields detected: ${contactFields.map((f) => `${f.name} (${f.label})`).join(', ')}. `
    confidence += 0.2
  }
  if (!detectedLogic) {
    detectedLogic = 'No dedicated MQL fields found on Lead or Contact. MQL may be tracked via Lead.Status picklist values or a custom object. Manual review recommended.'
    confidence = 0.15
  }

  findings.push({
    concept: 'MQL',
    platform: 'salesforce',
    object: objectsFound.join(' / ') || 'Lead / Contact',
    fieldApiName: fieldApiNames[0] ?? null,
    detectedLogic: detectedLogic.trim(),
    confidenceScore: Math.min(confidence, 0.95),
  })
}

async function detectSQL(instanceUrl: string, accessToken: string, findings: Finding[]) {
  const [leadDesc, contactDesc, oppDesc] = await Promise.all([
    describeSfObject(instanceUrl, accessToken, 'Lead'),
    describeSfObject(instanceUrl, accessToken, 'Contact'),
    describeSfObject(instanceUrl, accessToken, 'Opportunity'),
  ])

  const sqlKeywords = ['sql', 'sales_qualified', 'sales qualified', 'sqo', 'accepted']
  const stageKeywords = ['sql', 'sales qualified', 'sqo', 'qualified', 'discovery']

  const leadFields = findFields(leadDesc, sqlKeywords)
  const contactFields = findFields(contactDesc, sqlKeywords)
  const oppStageField = oppDesc?.fields.find((f) => f.name === 'StageName')
  const sqlStages = oppStageField ? picklistContains(oppStageField, stageKeywords) : []

  let detectedLogic = ''
  let confidence = 0.3
  const objectsFound: string[] = []
  const fieldApiNames: string[] = []

  if (leadFields.length > 0) {
    objectsFound.push('Lead')
    fieldApiNames.push(...leadFields.map((f) => f.name))
    detectedLogic += `Lead SQL fields: ${leadFields.map((f) => f.name).join(', ')}. `
    confidence += 0.3
  }
  if (contactFields.length > 0) {
    objectsFound.push('Contact')
    fieldApiNames.push(...contactFields.map((f) => f.name))
    detectedLogic += `Contact SQL fields: ${contactFields.map((f) => f.name).join(', ')}. `
    confidence += 0.2
  }
  if (sqlStages.length > 0) {
    objectsFound.push('Opportunity')
    detectedLogic += `Opportunity.StageName includes SQL-related stages: "${sqlStages.join('", "')}". `
    confidence += 0.25
  }
  if (!detectedLogic) {
    detectedLogic = 'No dedicated SQL fields found. SQL qualification may be tracked via Opportunity stage transitions. Review Opportunity.StageName picklist and any Lead conversion workflows.'
    confidence = 0.15
  }

  findings.push({
    concept: 'SQL',
    platform: 'salesforce',
    object: objectsFound.join(' / ') || 'Lead / Contact / Opportunity',
    fieldApiName: fieldApiNames[0] ?? null,
    detectedLogic: detectedLogic.trim(),
    confidenceScore: Math.min(confidence, 0.95),
  })
}

async function detectDiscoveryCall(instanceUrl: string, accessToken: string, findings: Finding[]) {
  const [taskDesc, eventDesc] = await Promise.all([
    describeSfObject(instanceUrl, accessToken, 'Task'),
    describeSfObject(instanceUrl, accessToken, 'Event'),
  ])

  const callKeywords = ['discovery', 'disco', 'qualifying', 'qualification', 'intro call']
  const typeKeywords = ['type', 'calltype', 'call_type', 'subject']

  const taskTypeField = taskDesc?.fields.find((f) => f.name === 'Type' || f.name === 'CallType')
  const taskSubjectField = taskDesc?.fields.find((f) => f.name === 'Subject')
  const discoveryTypes = taskTypeField ? picklistContains(taskTypeField, callKeywords) : []
  const taskCallFields = findFields(taskDesc, callKeywords.concat(typeKeywords))
  const eventFields = findFields(eventDesc, callKeywords)

  let detectedLogic = ''
  let confidence = 0.25
  const objectsFound: string[] = []

  if (discoveryTypes.length > 0) {
    objectsFound.push('Task')
    detectedLogic += `Task.Type picklist includes discovery-related values: "${discoveryTypes.join('", "')}". `
    confidence += 0.4
  }
  if (taskCallFields.length > 0) {
    objectsFound.push('Task')
    detectedLogic += `Task fields detected: ${taskCallFields.map((f) => f.name).join(', ')}. `
    confidence += 0.2
  }
  if (taskSubjectField) {
    detectedLogic += "Task.Subject field available — discovery calls may be tracked via subject text matching (e.g. Subject LIKE '%Discovery%'). "
    confidence += 0.1
  }
  if (eventFields.length > 0) {
    objectsFound.push('Event')
    detectedLogic += `Event fields detected: ${eventFields.map((f) => f.name).join(', ')}. `
    confidence += 0.1
  }
  if (!detectedLogic) {
    detectedLogic = "No explicit discovery call field found. Recommend tracking via Task.Subject LIKE '%Discovery%' or Task.Type = 'Discovery Call'. A custom Task Type picklist value is the most reliable approach."
    confidence = 0.1
  }

  findings.push({
    concept: 'discovery_call',
    platform: 'salesforce',
    object: objectsFound.join(' / ') || 'Task / Event',
    fieldApiName: taskTypeField?.name ?? null,
    detectedLogic: detectedLogic.trim(),
    confidenceScore: Math.min(confidence, 0.95),
  })
}

async function detectEngagedContactPardot(
  accessToken: string,
  businessUnitId: string,
  findings: Finding[]
) {
  const engagementKeywords = ['engaged', 'active', 'nurture', 'warm', 'hot']
  const foundLists: string[] = []
  const foundRules: string[] = []

  try {
    const listsRes = await fetch('https://pi.pardot.com/api/v5/objects/lists?fields=id,name&limit=200', {
      headers: { Authorization: `Bearer ${accessToken}`, 'Pardot-Business-Unit-Id': businessUnitId },
    })
    if (listsRes.ok) {
      const data = await listsRes.json() as { values?: Array<{ id: number; name: string }> }
      for (const list of data.values ?? []) {
        if (matchesKeywords(list.name, engagementKeywords)) foundLists.push(list.name)
      }
    }
  } catch { /* ignore */ }

  try {
    const rulesRes = await fetch('https://pi.pardot.com/api/v5/objects/automationRules?fields=id,name&limit=100', {
      headers: { Authorization: `Bearer ${accessToken}`, 'Pardot-Business-Unit-Id': businessUnitId },
    })
    if (rulesRes.ok) {
      const data = await rulesRes.json() as { values?: Array<{ id: number; name: string }> }
      for (const rule of data.values ?? []) {
        if (matchesKeywords(rule.name, engagementKeywords.concat(['score', 'activity']))) {
          foundRules.push(rule.name)
        }
      }
    }
  } catch { /* ignore */ }

  let detectedLogic = ''
  let confidence = 0.25

  if (foundLists.length > 0) {
    detectedLogic += `Engagement-related Pardot lists found: "${foundLists.slice(0, 5).join('", "')}". `
    confidence += 0.4
  }
  if (foundRules.length > 0) {
    detectedLogic += `Engagement automation rules found: "${foundRules.slice(0, 5).join('", "')}". `
    confidence += 0.3
  }
  if (!detectedLogic) {
    detectedLogic = 'No explicit engagement lists or automation rules found with standard naming. Engaged contacts may be tracked via Pardot scoring (Prospect.Score) or grade thresholds. Consider defining a list membership rule for score ≥ 100 as your engagement baseline.'
    confidence = 0.15
  }

  findings.push({
    concept: 'engaged_contact',
    platform: 'pardot',
    object: 'Prospect / List / Automation Rule',
    fieldApiName: null,
    detectedLogic: detectedLogic.trim(),
    confidenceScore: Math.min(confidence, 0.95),
  })
}

async function detectAttribution(instanceUrl: string, accessToken: string, findings: Finding[]) {
  const [campDesc, campMemberDesc, oppDesc] = await Promise.all([
    describeSfObject(instanceUrl, accessToken, 'Campaign'),
    describeSfObject(instanceUrl, accessToken, 'CampaignMember'),
    describeSfObject(instanceUrl, accessToken, 'Opportunity'),
  ])

  const attrKeywords = ['attribution', 'nurture', 'first_touch', 'last_touch', 'multi_touch', 'campaign_source', 'influenced']
  const nurtureKeywords = ['nurture', 'drip', 'sequence', 'engagement', 'email_program']

  const campFields = findFields(campDesc, attrKeywords.concat(nurtureKeywords))
  const campTypeField = campDesc?.fields.find((f) => f.name === 'Type')
  const nurtureTypes = campTypeField ? picklistContains(campTypeField, nurtureKeywords) : []
  const campMemberFields = findFields(campMemberDesc, attrKeywords)
  const oppFields = findFields(oppDesc, attrKeywords)

  let detectedLogic = ''
  let confidence = 0.2

  if (nurtureTypes.length > 0) {
    detectedLogic += `Campaign.Type includes nurture-related values: "${nurtureTypes.join('", "')}". `
    confidence += 0.35
  }
  if (campFields.length > 0) {
    detectedLogic += `Campaign attribution fields: ${campFields.map((f) => f.name).join(', ')}. `
    confidence += 0.2
  }
  if (campMemberFields.length > 0) {
    detectedLogic += `CampaignMember attribution fields: ${campMemberFields.map((f) => f.name).join(', ')}. `
    confidence += 0.2
  }
  if (oppFields.length > 0) {
    detectedLogic += `Opportunity attribution fields: ${oppFields.map((f) => f.name).join(', ')}. `
    confidence += 0.15
  }
  if (!detectedLogic) {
    detectedLogic = 'No explicit attribution fields found. Standard Salesforce Campaign Influence (CampaignMember → Opportunity) available but may not be configured. Pardot engagement history can be used as a signal. Recommend defining Campaign.Type = "Nurture" and enabling Campaign Influence reporting.'
    confidence = 0.15
  }

  findings.push({
    concept: 'attribution',
    platform: 'salesforce',
    object: 'Campaign / CampaignMember / Opportunity',
    fieldApiName: null,
    detectedLogic: detectedLogic.trim(),
    confidenceScore: Math.min(confidence, 0.95),
  })
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST() {
  try {
    const [sfIntegration, pardotIntegration] = await Promise.all([
      prisma.integration.findUnique({ where: { platform: 'salesforce' } }),
      prisma.integration.findUnique({ where: { platform: 'pardot' } }),
    ])

    if (sfIntegration?.status !== 'connected') {
      return NextResponse.json({ error: 'Salesforce integration is not connected.' }, { status: 400 })
    }
    if (pardotIntegration?.status !== 'connected') {
      return NextResponse.json({ error: 'Pardot integration is not connected.' }, { status: 400 })
    }

    const sfCreds = sfIntegration.settings as Creds
    const pardotCreds = pardotIntegration.settings as Creds

    const accessToken = sfCreds.accessToken
    const instanceUrl = sfCreds.instanceUrl

    if (!accessToken || !instanceUrl) {
      return NextResponse.json(
        { error: 'Salesforce access token not found. Please disconnect and reconnect Salesforce.' },
        { status: 400 }
      )
    }

    const businessUnitId = pardotCreds.businessUnitId
    if (!businessUnitId) {
      return NextResponse.json({ error: 'Pardot Business Unit ID not found. Please reconnect Pardot.' }, { status: 400 })
    }

    // Create report
    const report = await prisma.discoveryReport.create({ data: { status: 'running' } })

    // Run all detectors in parallel using direct REST calls (no jsforce Connection)
    const findings: Finding[] = []

    await Promise.all([
      detectMQL(instanceUrl, accessToken, findings),
      detectSQL(instanceUrl, accessToken, findings),
      detectDiscoveryCall(instanceUrl, accessToken, findings),
      detectEngagedContactPardot(accessToken, businessUnitId, findings),
      detectAttribution(instanceUrl, accessToken, findings),
    ])

    // Upsert FieldMapping records
    await Promise.all(
      findings.map(async (f) => {
        const existing = await prisma.fieldMapping.findFirst({
          where: { concept: f.concept, platform: f.platform },
        })
        if (existing) {
          return prisma.fieldMapping.update({
            where: { id: existing.id },
            data: {
              object: f.object,
              fieldApiName: f.fieldApiName,
              detectedLogic: f.detectedLogic,
              confidenceScore: f.confidenceScore,
              status: 'pending',
            },
          })
        }
        return prisma.fieldMapping.create({
          data: {
            concept: f.concept,
            platform: f.platform,
            object: f.object,
            fieldApiName: f.fieldApiName,
            detectedLogic: f.detectedLogic,
            confidenceScore: f.confidenceScore,
            status: 'pending',
          },
        })
      })
    )

    // Mark report complete
    await prisma.discoveryReport.update({
      where: { id: report.id },
      data: {
        status: 'complete',
        completedAt: new Date(),
        rawAudit: JSON.parse(JSON.stringify(findings)),
      },
    })

    const mappings = await prisma.fieldMapping.findMany({ orderBy: { createdAt: 'desc' } })
    return NextResponse.json({ success: true, findings: mappings })
  } catch (err) {
    console.error('[POST /api/discovery/run]', err)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

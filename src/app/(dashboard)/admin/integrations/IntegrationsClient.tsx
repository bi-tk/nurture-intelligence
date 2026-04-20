'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Integration = {
  id: string
  platform: string
  status: string
  lastSyncAt: Date | null
  settings?: unknown
}

const PLATFORMS = [
  {
    key: 'salesforce',
    name: 'Salesforce CRM',
    description: 'Leads, contacts, accounts, opportunities, lifecycle stages, discovery calls',
    color: '#00A1E0',
    icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z',
    fields: [
      { key: 'instanceUrl',        label: 'Instance URL',                  placeholder: 'https://d90000000tfs5eai.my.salesforce.com', type: 'url'      },
      { key: 'clientId',           label: 'Client ID (Consumer Key)',       placeholder: 'Connected App Consumer Key',                  type: 'text'     },
      { key: 'clientSecret',       label: 'Client Secret (Consumer Secret)',placeholder: 'Connected App Consumer Secret',               type: 'password' },
      { key: 'username',           label: 'Username',                       placeholder: 'you@yourorg.com',                             type: 'text'     },
      { key: 'passwordWithToken',  label: 'Password + Security Token',      placeholder: 'MyPassword + SecurityToken (combined)',       type: 'password' },
    ],
  },
  {
    key: 'pardot',
    name: 'Account Engagement (Pardot)',
    description: 'Email sends, opens, clicks, bounces, sequences/programs, prospect activity',
    color: '#2952FF',
    icon: 'M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z',
    fields: [
      { key: 'businessUnitId', label: 'Business Unit ID', placeholder: '0Uve...', type: 'text' },
    ],
    note: 'Uses your connected Salesforce session — connect Salesforce first.',
  },
]

function timeSince(date: Date | null) {
  if (!date) return '—'
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function IntegrationsClient({ integrations }: { integrations: Integration[] }) {
  const router = useRouter()
  const [statuses, setStatuses] = useState<Record<string, Integration>>(() => {
    const map: Record<string, Integration> = {}
    for (const i of integrations) map[i.platform] = i
    return map
  })
  const [modal, setModal] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function openModal(platform: string) {
    setModal(platform)
    setForm({})
    setError('')
  }

  function closeModal() {
    setModal(null)
    setForm({})
    setError('')
  }

  async function handleConnect() {
    if (!modal) return
    setSaving(true)
    setError('')

    try {
      const res = await fetch('/api/integrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: modal, status: 'connected', metadata: form }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? 'Failed to save. Check your credentials and try again.')
        return
      }
      setStatuses((prev) => ({ ...prev, [modal]: data }))
      closeModal()
      router.refresh()
    } catch {
      setError('Network error. Could not reach the server.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDisconnect(platform: string) {
    await fetch('/api/integrations', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, status: 'disconnected' }),
    })
    setStatuses((prev) => ({ ...prev, [platform]: { ...prev[platform], status: 'disconnected', lastSyncAt: null } }))
    router.refresh()
  }

  const modalPlatform = PLATFORMS.find((p) => p.key === modal)
  const bothConnected = PLATFORMS.every((p) => statuses[p.key]?.status === 'connected')

  return (
    <>
      <div className="space-y-4">
        {PLATFORMS.map((p) => {
          const integration = statuses[p.key]
          const connected = integration?.status === 'connected'

          return (
            <div key={p.key} className="bg-graphite-800 border border-white/5 rounded-xl p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${p.color}20` }}>
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill={p.color}><path d={p.icon} /></svg>
                  </div>
                  <div>
                    <p className="text-white font-semibold">{p.name}</p>
                    <p className="text-white/40 text-sm mt-0.5">{p.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-xs font-mono px-2.5 py-1 rounded-full ${connected ? 'bg-accent-green/10 text-accent-green' : 'bg-white/5 text-white/30'}`}>
                    {connected ? '● connected' : '○ disconnected'}
                  </span>
                  {connected ? (
                    <button
                      onClick={() => handleDisconnect(p.key)}
                      className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 text-white/50 px-3 py-1.5 rounded-lg font-medium transition-all"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={() => openModal(p.key)}
                      className="text-xs bg-pulse-blue/10 hover:bg-pulse-blue/20 border border-pulse-blue/20 text-pulse-blue px-3 py-1.5 rounded-lg font-medium transition-all"
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>

              {connected && integration?.lastSyncAt && (
                <div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-3 gap-4 text-xs font-mono">
                  <div>
                    <p className="text-white/30 mb-1">Last Connected</p>
                    <p className="text-white/70">{timeSince(integration.lastSyncAt)}</p>
                  </div>
                  <div>
                    <p className="text-white/30 mb-1">Status</p>
                    <p className="text-accent-green">connected</p>
                  </div>
                  <div>
                    <p className="text-white/30 mb-1">Sync</p>
                    <p className="text-white/50">Manual trigger</p>
                  </div>
                </div>
              )}

              {!connected && (
                <div className="mt-4 pt-4 border-t border-white/5">
                  <p className="text-white/30 text-xs">
                    Connect this integration to begin syncing data. You will need a Connected App with OAuth 2.0 credentials.
                  </p>
                </div>
              )}
            </div>
          )
        })}

        <div className={`bg-graphite-800 border rounded-xl p-6 flex items-center justify-between gap-4 ${bothConnected ? 'border-pulse-blue/30' : 'border-white/5'}`}>
          <div>
            <p className="text-white font-semibold mb-1">
              {bothConnected ? 'Ready to run Phase 0 Discovery' : 'Ready to start Phase 0 Discovery?'}
            </p>
            <p className="text-white/40 text-sm">
              {bothConnected
                ? 'Both integrations are connected. Run the discovery audit to detect field definitions from your live environment.'
                : 'Connect both Salesforce and Pardot integrations first, then run the discovery audit.'}
            </p>
          </div>
          <a
            href="/admin/discovery"
            className={`shrink-0 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition whitespace-nowrap ${bothConnected ? 'gradient-core-flow hover:opacity-90' : 'bg-white/5 text-white/30 cursor-default pointer-events-none'}`}
          >
            Run Discovery →
          </a>
        </div>
      </div>

      {/* Connect Modal */}
      {modal && modalPlatform && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-graphite-800 border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${modalPlatform.color}20` }}>
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill={modalPlatform.color}><path d={modalPlatform.icon} /></svg>
              </div>
              <div>
                <p className="text-white font-semibold">Connect {modalPlatform.name}</p>
                <p className="text-white/40 text-xs">
                  {'note' in modalPlatform && modalPlatform.note
                    ? modalPlatform.note
                    : 'Enter your Connected App credentials'}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {modalPlatform.fields.map((f) => (
                <div key={f.key}>
                  <label className="block text-white/50 text-xs font-mono uppercase tracking-wider mb-1.5">{f.label}</label>
                  <input
                    type={f.type}
                    placeholder={f.placeholder}
                    value={form[f.key] ?? ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    className="w-full bg-graphite-700 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-pulse-blue/50 focus:ring-1 focus:ring-pulse-blue/20 transition"
                  />
                </div>
              ))}
            </div>

            {error && <p className="mt-3 text-accent-red text-xs">{error}</p>}

            <div className="flex gap-3 mt-6">
              <button
                onClick={closeModal}
                className="flex-1 bg-white/5 hover:bg-white/10 text-white/60 text-sm font-medium py-2.5 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConnect}
                disabled={saving}
                className="flex-1 gradient-core-flow text-white text-sm font-semibold py-2.5 rounded-lg hover:opacity-90 transition disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save & Connect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

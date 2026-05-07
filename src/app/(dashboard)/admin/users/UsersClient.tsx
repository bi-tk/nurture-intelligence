'use client'

import { useState } from 'react'
import { ROLE_LABELS } from '@/lib/utils'

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'NURTURE_OPS', 'SALES_LEADERSHIP'] as const
type Role = typeof ROLES[number]

const roleColors: Record<string, string> = {
  SUPER_ADMIN: 'bg-pulse-blue/15 text-pulse-blue',
  ADMIN: 'bg-pulse-blue/10 text-pulse-300',
  EXECUTIVE: 'bg-accent-yellow/10 text-accent-yellow',
  NURTURE_OPS: 'bg-accent-green/10 text-accent-green',
  SALES_LEADERSHIP: 'bg-accent-red/10 text-accent-red',
}

interface User {
  id: string
  name: string | null
  email: string
  role: Role
  active: boolean
  createdAt: string | Date
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-graphite-800 border border-white/10 rounded-xl w-full max-w-md mx-4 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <p className="text-white font-semibold">{title}</p>
          <button onClick={onClose} className="text-white/30 hover:text-white transition text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-white/40 text-xs font-mono uppercase tracking-widest">{label}</label>
      {children}
    </div>
  )
}

const inputCls = 'w-full bg-graphite-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-pulse-blue/50 placeholder-white/20'
const selectCls = 'w-full bg-graphite-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-pulse-blue/50'

export default function UsersClient({ initialUsers, currentUserId }: { initialUsers: User[]; currentUserId: string }) {
  const [users, setUsers] = useState<User[]>(initialUsers)
  const [showInvite, setShowInvite] = useState(false)
  const [editUser, setEditUser] = useState<User | null>(null)
  const [deleteUser, setDeleteUser] = useState<User | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // Invite form state
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('NURTURE_OPS')
  const [invitePassword, setInvitePassword] = useState('')

  // Edit form state
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState<Role>('NURTURE_OPS')
  const [editActive, setEditActive] = useState(true)
  const [editPassword, setEditPassword] = useState('')

  function openEdit(u: User) {
    setEditUser(u)
    setEditName(u.name ?? '')
    setEditRole(u.role)
    setEditActive(u.active)
    setEditPassword('')
    setError('')
  }

  async function handleInvite() {
    if (!inviteEmail || !invitePassword) { setError('Email and password are required'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: inviteName, email: inviteEmail, password: invitePassword, role: inviteRole }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to invite user'); return }
      setUsers(prev => [...prev, { ...data, createdAt: new Date(data.createdAt) }])
      setShowInvite(false)
      setInviteName(''); setInviteEmail(''); setInvitePassword(''); setInviteRole('NURTURE_OPS')
    } finally { setSaving(false) }
  }

  async function handleEdit() {
    if (!editUser) return
    setSaving(true); setError('')
    try {
      const body: Record<string, unknown> = { name: editName, role: editRole, active: editActive }
      if (editPassword) body.password = editPassword
      const res = await fetch(`/api/admin/users/${editUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to update user'); return }
      setUsers(prev => prev.map(u => u.id === editUser.id ? { ...data, createdAt: new Date(data.createdAt) } : u))
      setEditUser(null)
    } finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!deleteUser) return
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/admin/users/${deleteUser.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to delete user'); return }
      setUsers(prev => prev.filter(u => u.id !== deleteUser.id))
      setDeleteUser(null)
    } finally { setSaving(false) }
  }

  return (
    <>
      <div className="p-6 space-y-4">
        <div className="flex justify-end">
          <button
            onClick={() => { setShowInvite(true); setError('') }}
            className="gradient-core-flow text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:opacity-90 transition"
          >
            + Invite User
          </button>
        </div>

        <div className="bg-graphite-800 border border-white/5 rounded-xl overflow-hidden">
          {users.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-white/40 text-sm">No users found. Invite team members to get started.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  {['Name', 'Email', 'Role', 'Status', 'Joined', 'Actions'].map(h => (
                    <th key={h} className="text-left px-5 py-3 text-white/25 text-xs font-mono uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {users.map(u => (
                  <tr key={u.id} className="hover:bg-white/2">
                    <td className="px-5 py-3 text-white font-medium">{u.name || '—'}</td>
                    <td className="px-5 py-3 text-white/50 font-mono text-xs">{u.email}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${roleColors[u.role] ?? 'bg-white/5 text-white/30'}`}>
                        {ROLE_LABELS[u.role]}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-mono ${u.active ? 'text-accent-green' : 'text-white/20'}`}>
                        {u.active ? '● active' : '○ inactive'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-white/30 font-mono text-xs">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3 flex items-center gap-1">
                      <button
                        onClick={() => openEdit(u)}
                        className="text-xs text-white/40 hover:text-white transition px-2 py-1 rounded hover:bg-white/5"
                      >Edit</button>
                      {u.id !== currentUserId && (
                        <button
                          onClick={() => { setDeleteUser(u); setError('') }}
                          className="text-xs text-accent-red/50 hover:text-accent-red transition px-2 py-1 rounded hover:bg-accent-red/5"
                        >Delete</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Invite modal */}
      {showInvite && (
        <Modal title="Invite User" onClose={() => setShowInvite(false)}>
          <div className="space-y-4">
            {error && <p className="text-accent-red text-sm">{error}</p>}
            <Field label="Name">
              <input className={inputCls} placeholder="Full name" value={inviteName} onChange={e => setInviteName(e.target.value)} />
            </Field>
            <Field label="Email *">
              <input className={inputCls} type="email" placeholder="user@company.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
            </Field>
            <Field label="Role *">
              <select className={selectCls} value={inviteRole} onChange={e => setInviteRole(e.target.value as Role)}>
                {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </Field>
            <Field label="Password *">
              <input className={inputCls} type="password" placeholder="Temporary password" value={invitePassword} onChange={e => setInvitePassword(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowInvite(false)} className="text-sm text-white/40 hover:text-white px-4 py-2 rounded-lg hover:bg-white/5 transition">Cancel</button>
              <button onClick={handleInvite} disabled={saving} className="gradient-core-flow text-white text-sm font-semibold px-4 py-2 rounded-lg hover:opacity-90 transition disabled:opacity-50">
                {saving ? 'Inviting…' : 'Invite User'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit modal */}
      {editUser && (
        <Modal title="Edit User" onClose={() => setEditUser(null)}>
          <div className="space-y-4">
            {error && <p className="text-accent-red text-sm">{error}</p>}
            <Field label="Name">
              <input className={inputCls} placeholder="Full name" value={editName} onChange={e => setEditName(e.target.value)} />
            </Field>
            <Field label="Email">
              <input className={inputCls} value={editUser.email} disabled />
            </Field>
            <Field label="Role">
              <select className={selectCls} value={editRole} onChange={e => setEditRole(e.target.value as Role)}>
                {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className={selectCls} value={editActive ? 'active' : 'inactive'} onChange={e => setEditActive(e.target.value === 'active')}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </Field>
            <Field label="New Password (optional)">
              <input className={inputCls} type="password" placeholder="Leave blank to keep current" value={editPassword} onChange={e => setEditPassword(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditUser(null)} className="text-sm text-white/40 hover:text-white px-4 py-2 rounded-lg hover:bg-white/5 transition">Cancel</button>
              <button onClick={handleEdit} disabled={saving} className="gradient-core-flow text-white text-sm font-semibold px-4 py-2 rounded-lg hover:opacity-90 transition disabled:opacity-50">
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete confirmation */}
      {deleteUser && (
        <Modal title="Delete User" onClose={() => setDeleteUser(null)}>
          <div className="space-y-4">
            {error && <p className="text-accent-red text-sm">{error}</p>}
            <p className="text-white/70 text-sm">
              Are you sure you want to delete <span className="text-white font-medium">{deleteUser.name || deleteUser.email}</span>? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setDeleteUser(null)} className="text-sm text-white/40 hover:text-white px-4 py-2 rounded-lg hover:bg-white/5 transition">Cancel</button>
              <button onClick={handleDelete} disabled={saving} className="bg-accent-red/20 text-accent-red hover:bg-accent-red/30 text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50">
                {saving ? 'Deleting…' : 'Delete User'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

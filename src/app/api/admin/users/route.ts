import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { Role } from '@prisma/client'

async function requireAdmin() {
  const session = await auth()
  if (!session?.user) return null
  if (session.user.role !== 'SUPER_ADMIN' && session.user.role !== 'ADMIN') return null
  return session
}

export async function POST(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, email, password, role } = await req.json()
  if (!email || !password || !role) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  if (!Object.values(Role).includes(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) return NextResponse.json({ error: 'Email already in use' }, { status: 409 })

  const hashed = await bcrypt.hash(password, 10)
  const user = await prisma.user.create({
    data: { name: name || null, email, password: hashed, role, active: true },
  })

  return NextResponse.json({ id: user.id, name: user.name, email: user.email, role: user.role, active: user.active, createdAt: user.createdAt })
}

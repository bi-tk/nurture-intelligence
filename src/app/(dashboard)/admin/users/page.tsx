import { auth } from '@/lib/auth'
import Header from '@/components/layout/Header'
import { prisma } from '@/lib/prisma'
import UsersClient from './UsersClient'

export const dynamic = 'force-dynamic'

async function getUsers() {
  try {
    return await prisma.user.findMany({ orderBy: { createdAt: 'asc' } })
  } catch {
    return []
  }
}

export default async function UsersPage() {
  const session = await auth()
  const users = await getUsers()

  const initialUsers = users.map(u => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as 'SUPER_ADMIN' | 'ADMIN' | 'EXECUTIVE' | 'NURTURE_OPS' | 'SALES_LEADERSHIP',
    active: u.active,
    createdAt: u.createdAt,
  }))

  return (
    <div className="flex flex-col min-h-full">
      <Header
        title="User Management"
        subtitle="Manage access, roles and permissions"
        userName={session?.user?.name}
        userRole={session?.user?.role!}
      />
      <UsersClient initialUsers={initialUsers} currentUserId={session?.user?.id ?? ''} />
    </div>
  )
}

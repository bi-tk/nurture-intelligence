import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import FilterBar from '@/components/layout/FilterBar'
import type { Role } from '@prisma/client'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  return (
    <div className="flex h-screen overflow-hidden bg-graphite-900">
      <Sidebar role={session.user.role as Role} />
      <main className="flex-1 overflow-y-auto flex flex-col">
        <Suspense fallback={null}>
          <FilterBar />
        </Suspense>
        {children}
      </main>
    </div>
  )
}

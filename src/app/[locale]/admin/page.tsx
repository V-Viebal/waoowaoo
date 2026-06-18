import { redirect } from 'next/navigation'
import { requireAdminServerSide } from '@/lib/admin/auth'

export default async function AdminPage() {
  await requireAdminServerSide()
  redirect('/admin/config-center')
}

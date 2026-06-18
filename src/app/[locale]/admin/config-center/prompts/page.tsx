import { requireAdminServerSide } from '@/lib/admin/auth'
import Navbar from '@/components/Navbar'
import ConfigCenterTabs from '../components/ConfigCenterTabs'
import PromptLibraryPanel from '../components/PromptLibraryPanel'

export default async function PromptsPage() {
  await requireAdminServerSide()

  return (
    <div className="glass-page min-h-screen">
      <Navbar />
      <main className="mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8">
        <ConfigCenterTabs />
        <PromptLibraryPanel />
      </main>
    </div>
  )
}

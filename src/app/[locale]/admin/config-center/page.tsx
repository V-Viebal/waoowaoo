import Navbar from '@/components/Navbar'
import PromptLibraryPanel from './components/PromptLibraryPanel'

export default function ConfigCenterPage() {
  return (
    <div className="glass-page min-h-screen">
      <Navbar />
      <main className="mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8">
        <PromptLibraryPanel />
      </main>
    </div>
  )
}

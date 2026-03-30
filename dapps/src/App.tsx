import { HashRouter, Routes, Route } from 'react-router-dom'
import { NavBar } from './components/NavBar'
import { Overview } from './pages/Overview'
import { Buildings } from './pages/Buildings'
import { Debug } from './pages/Debug'
import { InGameView } from './pages/InGameView'

// Detect in-game context: game client passes ?itemId=X&tenant=Y
// Check both search params and hash params (game might append either way)
const params = new URLSearchParams(window.location.search)
const hashParams = new URLSearchParams(window.location.hash.split('?')[1] || '')
const inGameItemId = params.get('itemId') || hashParams.get('itemId')

// Debug: log what the game sent (remove after testing)
if (typeof window !== 'undefined') {
  console.log('[ef_guard] URL:', window.location.href)
  console.log('[ef_guard] search:', window.location.search)
  console.log('[ef_guard] hash:', window.location.hash)
  console.log('[ef_guard] itemId:', inGameItemId)
}

export function App() {
  // In-game: show focused assembly view, no nav bar
  if (inGameItemId) {
    return <InGameView itemId={inGameItemId} />
  }

  // Admin panel: full navigation
  return (
    <HashRouter>
      <div className="min-h-screen bg-surface-0 text-white">
        <NavBar />
        <main>
          <Routes>
            <Route path="/"          element={<Overview />} />
            <Route path="/buildings" element={<Buildings />} />
            <Route path="/debug"     element={<Debug />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  )
}

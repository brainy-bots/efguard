import { HashRouter, Routes, Route } from 'react-router-dom'
import { NavBar } from './components/NavBar'
import { Overview } from './pages/Overview'
import { Buildings } from './pages/Buildings'
import { Debug } from './pages/Debug'
import { InGameView } from './pages/InGameView'

// Detect in-game context: game client passes ?itemId=X&tenant=Y
const params = new URLSearchParams(window.location.search)
const inGameItemId = params.get('itemId')

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

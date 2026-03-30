import { HashRouter, Routes, Route } from 'react-router-dom'
import { NavBar } from './components/NavBar'
import { Overview } from './pages/Overview'
import { Buildings } from './pages/Buildings'
import { Debug } from './pages/Debug'
import { InGameView } from './pages/InGameView'

// Check for itemId in search params (game might pass it)
const params = new URLSearchParams(window.location.search)
const itemId = params.get('itemId')

// Detect if we're in the admin panel (hash route) or in-game (bare URL)
// Admin panel: https://host/efguard/#/buildings
// In-game:    https://host/efguard/ or https://host/efguard/?itemId=X
const hasHashRoute = window.location.hash.startsWith('#/')

export function App() {
  // No hash route = in-game view (or landing page)
  if (!hasHashRoute) {
    return <InGameView itemId={itemId} />
  }

  // Hash route = admin panel
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

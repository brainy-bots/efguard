import { HashRouter, Routes, Route } from 'react-router-dom'
import { NavBar } from './components/NavBar'
import { Overview } from './pages/Overview'
import { Buildings } from './pages/Buildings'
import { Debug } from './pages/Debug'
import { InGameView } from './pages/InGameView'

const params = new URLSearchParams(window.location.search)
const itemId = params.get('itemId')

export function App() {
  return (
    <HashRouter>
      <Routes>
        {/* In-game route — no nav bar, black/orange theme */}
        <Route path="/ingame" element={<InGameView itemId={itemId} />} />

        {/* Admin panel — full navigation */}
        <Route path="/*" element={
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
        } />
      </Routes>
    </HashRouter>
  )
}

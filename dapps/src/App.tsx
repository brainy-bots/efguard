import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'
import { NavBar } from './components/NavBar'
import { Overview } from './pages/Overview'
import { Buildings } from './pages/Buildings'
import { Debug } from './pages/Debug'
import { InGameView } from './pages/InGameView'
import { theme } from './lib/theme'

const params = new URLSearchParams(window.location.search)
const itemId = params.get('itemId')

function AppContent() {
  const location = useLocation()
  const isInGame = location.pathname === '/ingame'

  return (
    <div className={isInGame ? '' : 'min-h-screen text-white'} style={isInGame ? undefined : { background: theme.bg }}>
      {!isInGame && <NavBar />}
      <main>
        <Routes>
          <Route path="/ingame" element={<InGameView itemId={itemId} />} />
          <Route path="/buildings" element={<Buildings />} />
          <Route path="/debug" element={<Debug />} />
          <Route path="/" element={<Overview />} />
        </Routes>
      </main>
    </div>
  )
}

export function App() {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  )
}

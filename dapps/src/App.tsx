import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'
import { NavBar } from './components/NavBar'
import { Overview } from './pages/Overview'
import { Buildings } from './pages/Buildings'
import { Debug } from './pages/Debug'
import { InGameView } from './pages/InGameView'
import { StorageView } from './pages/StorageView'
import { theme } from './lib/theme'
import { AsciiBackground } from './components/AsciiBackground'

const params = new URLSearchParams(window.location.search)
const itemId = params.get('itemId')

function AppContent() {
  const location = useLocation()
  const isInGame = location.pathname === '/ingame' || location.pathname === '/storage'

  return (
    <div className={isInGame ? '' : 'min-h-screen text-white'} style={isInGame ? undefined : { background: theme.bg, position: 'relative' }}>
      {!isInGame && <AsciiBackground />}
      {!isInGame && <NavBar />}
      <main style={isInGame ? undefined : { position: 'relative', zIndex: 1 }}>
        <Routes>
          <Route path="/ingame" element={<InGameView itemId={itemId} />} />
          <Route path="/storage" element={<StorageView itemId={itemId} />} />
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

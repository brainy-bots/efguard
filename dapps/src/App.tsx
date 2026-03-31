import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'
import { NavBar } from './components/NavBar'
import { Overview } from './pages/Overview'
import { Buildings } from './pages/Buildings'
import { Debug } from './pages/Debug'
import { InGameView } from './pages/InGameView'
import { theme } from './lib/theme'
import { AsciiBackground } from './components/AsciiBackground'

function AppContent() {
  const location = useLocation()
  const isInGame = location.pathname === '/ingame'

  return (
    <div className={isInGame ? '' : 'min-h-screen text-white'} style={isInGame ? undefined : { background: theme.bg, position: 'relative' }}>
      {!isInGame && <AsciiBackground />}
      {!isInGame && <NavBar />}
      <main style={isInGame ? undefined : { position: 'relative', zIndex: 1 }}>
        <Routes>
          <Route path="/ingame" element={<InGameView />} />
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

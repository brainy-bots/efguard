import { HashRouter, Routes, Route } from 'react-router-dom'
import { NavBar } from './components/NavBar'
import { Overview } from './pages/Overview'
import { Buildings } from './pages/Buildings'
import { Debug } from './pages/Debug'

export function App() {
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

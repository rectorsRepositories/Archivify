import { Navigate, Route, Routes } from 'react-router-dom'
import PageLayout from './components/layout/PageLayout.jsx'
import Home from './pages/Home.jsx'
import Music from './pages/Music.jsx'
import Album from './pages/Album.jsx'
import Games from './pages/Games.jsx'

export default function App() {
  return (
    <Routes>
      <Route element={<PageLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/music" element={<Music />} />
        <Route path="/music/albums/:id" element={<Album />} />
        <Route path="/games" element={<Games />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

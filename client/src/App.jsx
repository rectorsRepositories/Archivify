import { Navigate, Route, Routes } from 'react-router-dom'
import PageLayout from './components/layout/PageLayout.jsx'
import Home from './pages/Home.jsx'
import Music from './pages/Music.jsx'
import Album from './pages/Album.jsx'
import Games from './pages/Games.jsx'
import Search from './pages/Search.jsx'
import Downloads from './pages/Downloads.jsx'

export default function App() {
  return (
    <Routes>
      <Route element={<PageLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/music" element={<Music />} />
        <Route path="/music/albums/:id" element={<Album />} />
        <Route path="/games" element={<Games />} />
        <Route path="/search" element={<Search />} />
        <Route path="/downloads" element={<Downloads />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

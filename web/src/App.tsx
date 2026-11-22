import { TerraceMap } from './map/TerraceMap.tsx'

export function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Sol y Cerveza</h1>
        <p>Terrazas de Badajoz al sol o a la sombra</p>
      </header>
      <main className="app-main">
        <TerraceMap />
      </main>
    </div>
  )
}

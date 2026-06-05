import { useState } from 'react';
import PhotoGallery from './components/PhotoGallery';
import PhotoUploader from './components/PhotoUploader';
import './App.css';

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0);

  function handleUploaded() {
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1>Fotos de Delivery</h1>
        <p>Registrá cada pedido con foto, número y fecha/hora</p>
      </header>

      <main className="app__main">
        <PhotoUploader onUploaded={handleUploaded} />
        <PhotoGallery refreshKey={refreshKey} />
      </main>
    </div>
  );
}

import 'leaflet/dist/leaflet.css';
import './styles/app.css';
import { createBergparkMap } from './map.js';

const app = document.querySelector('#app');

app.innerHTML = `
  <main class="app-shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">UNESCO-Welterbe · Kassel</p>
        <h1>Bergpark Wilhelmshöhe</h1>
      </div>
      <button id="locate" class="locate-button" type="button" aria-label="Eigenen Standort anzeigen">
        <span aria-hidden="true">◎</span><span>Standort</span>
      </button>
    </header>
    <section class="map-stage" aria-label="Interaktive Karte des Bergparks">
      <div id="map" tabindex="0"></div>
      <div class="map-hint" aria-live="polite">Tippe auf einen Ort, um ihn zu entdecken.</div>
    </section>
    <nav class="bottom-nav" aria-label="Hauptnavigation">
      <button class="nav-item is-active" type="button" aria-current="page"><span>⌖</span>Karte</button>
      <button class="nav-item" type="button" disabled><span>⌕</span>Index</button>
      <button class="nav-item" type="button" disabled><span>♧</span>Bäume</button>
    </nav>
  </main>
`;

async function boot() {
  const response = await fetch(`${import.meta.env.BASE_URL}data/nodes.de.json`);
  if (!response.ok) throw new Error(`Could not load landmark data (${response.status})`);
  const nodes = await response.json();
  const mapController = createBergparkMap(document.querySelector('#map'), nodes);
  document.querySelector('#locate').addEventListener('click', () => mapController.locate());
}

boot().catch((error) => {
  console.error(error);
  document.querySelector('.map-hint').textContent = 'Kartendaten konnten nicht geladen werden.';
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => console.warn('Service worker registration failed', error));
  });
}

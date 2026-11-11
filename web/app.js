// Map Compressor - standalone page.
//
// Built into ONE self-contained HTML file (npm run build:offline) that runs
// with no internet, no account and no server. Nothing is sent anywhere unless
// the user switches on the online basemap, which requests map tiles (and so
// reveals the viewed area) from Esri.

import maplibregl from 'maplibre-gl';
import { mountCompressor } from '../cloudtak-plugin/ui.js';

const PREVIEW_LAYER = 'map-compressor-preview-layer';
const ESRI = {
    type: 'raster',
    tileSize: 256,
    maxzoom: 19,
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
};

const map = new maplibregl.Map({
    container: 'map',
    // Offline style: a plain background, no network sources at all.
    style: {
        version: 8,
        sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#2b3038' } }],
    },
    center: [-84.39, 33.75],
    zoom: 9,
    attributionControl: false,
});
map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

/* ---------- optional online basemap ---------- */
const toggle = document.getElementById('basemap');
const status = document.getElementById('net-status');
let attribution = null;

function setStatus(online) {
    status.textContent = online
        ? 'Basemap ON: map tiles are downloaded from Esri, which reveals the area you are viewing. Your map image itself still never leaves this device.'
        : 'Offline: nothing leaves this device.';
    status.className = online ? 'net net-on' : 'net net-off';
}

function showBasemap(on) {
    if (on) {
        if (!map.getSource('imagery')) map.addSource('imagery', ESRI);
        if (!map.getLayer('imagery')) {
            map.addLayer({ id: 'imagery', type: 'raster', source: 'imagery' },
                map.getLayer(PREVIEW_LAYER) ? PREVIEW_LAYER : undefined); // keep the overlay on top
        }
        attribution = attribution || new maplibregl.AttributionControl({ compact: true });
        map.addControl(attribution, 'bottom-right');
    } else {
        if (map.getLayer('imagery')) map.removeLayer('imagery');
        if (map.getSource('imagery')) map.removeSource('imagery');
        if (attribution) { map.removeControl(attribution); attribution = null; }
    }
    setStatus(on);
}

toggle.checked = false;
toggle.addEventListener('change', () => {
    const run = () => showBasemap(toggle.checked);
    if (map.isStyleLoaded()) run(); else map.once('load', run);
});
setStatus(false);

window.map = map;
window.tmc = mountCompressor(document.getElementById('panel'), { map });

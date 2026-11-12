import { fetchOSMData } from './gis/overpass.js';
import { GameScene } from './game/scenes/GameScene.js';

let selectedLat = -17.7833;
let selectedLon = -63.1821;
let leafletMap = null;
let selectedMarker = null;

document.addEventListener('DOMContentLoaded', () => {
    initLeafletSelector();
    
    document.getElementById('start-btn').addEventListener('click', async () => {
        const btn = document.getElementById('start-btn');
        btn.innerText = 'Descargando vectores OSM (1km²)...';
        btn.disabled = true;

        try {
            const osmData = await fetchOSMData(selectedLat, selectedLon);
            document.getElementById('selector-container').classList.add('hidden');

            const config = {
                type: Phaser.AUTO,
                width: window.innerWidth,
                height: window.innerHeight,
                parent: 'app',
                backgroundColor: '#0f172a',
                pixelArt: true,  // ← AGREGAR ESTA LÍNEA
                scene: [GameScene],
                scale: {
                    mode: Phaser.Scale.RESIZE,
                    autoCenter: Phaser.Scale.CENTER_BOTH
                }
            };

            const game = new Phaser.Game(config);

            game.scene.start('GameScene', {
                osmData: osmData,
                originLat: selectedLat,
                originLon: selectedLon
            });

        } catch (error) {
            console.error(error);
            alert('Error al conectar con Overpass API.');
            btn.innerText = 'Iniciar Simulación GeoWalker';
            btn.disabled = false;
        }
    });
});

function initLeafletSelector() {
    leafletMap = L.map('map').setView([selectedLat, selectedLon], 15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
    }).addTo(leafletMap);

    selectedMarker = L.marker([selectedLat, selectedLon], { draggable: true }).addTo(leafletMap);

    selectedMarker.on('dragend', (event) => {
        const pos = event.target.getLatLng();
        selectedLat = pos.lat;
        selectedLon = pos.lng;
    });

    leafletMap.on('click', (event) => {
        selectedLat = event.latlng.lat;
        selectedLon = event.latlng.lng;
        selectedMarker.setLatLng([selectedLat, selectedLon]);
    });
}
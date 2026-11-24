import { calculateBBox, fetchOSMData } from './gis/overpass.js';
import { GameScene } from './game/scenes/GameScene.js?v=20261124-2';

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

        const originLat = selectedLat;
        const originLon = selectedLon;
        try {
            const osmData = await fetchOSMData(originLat, originLon);
            document.getElementById('selector-container').classList.add('hidden');

            const app = document.getElementById('app');
            const config = {
                type: Phaser.AUTO,
                width: app.clientWidth,
                height: app.clientHeight,
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
                originLat,
                originLon
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

    // Rectángulo visual del área de simulación (1km² = 500m a cada lado)
    let simAreaRectangle = null;

    function updateSimArea() {
        const { south, west, north, east } = calculateBBox(selectedLat, selectedLon);
        const bounds = [[south, west], [north, east]];

        if (simAreaRectangle) {
            simAreaRectangle.setBounds(bounds);
        } else {
            simAreaRectangle = L.rectangle(bounds, {
                color: '#38bdf8',
                weight: 2,
                fillColor: '#38bdf8',
                fillOpacity: 0.1,
                dashArray: '5, 5'
            }).addTo(leafletMap);
        }

        // Actualizar información del área
        const areaInfo = document.getElementById('area-info');
        if (areaInfo) {
            areaInfo.innerHTML = `
                <strong>Área de Simulación (1km²)</strong><br>
                Centro: ${selectedLat.toFixed(5)}°, ${selectedLon.toFixed(5)}°<br>
                Límite: ±500 m al norte, sur, este y oeste
            `;
        }
    }

    updateSimArea();

    selectedMarker.on('dragend', (event) => {
        const pos = event.target.getLatLng();
        selectedLat = pos.lat;
        selectedLon = pos.lng;
        updateSimArea();
    });

    leafletMap.on('click', (event) => {
        selectedLat = event.latlng.lat;
        selectedLon = event.latlng.lng;
        selectedMarker.setLatLng([selectedLat, selectedLon]);
        updateSimArea();
    });

    // Buscador de lugares
    const searchInput = document.getElementById('location-search');
    const searchBtn = document.getElementById('search-btn');

    async function searchLocation() {
        const query = searchInput.value.trim();
        if (!query) return;

        try {
            // Usar Nominatim API de OpenStreetMap para geocodificación
            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`
            );
            const data = await response.json();

            if (data && data.length > 0) {
                const result = data[0];
                selectedLat = parseFloat(result.lat);
                selectedLon = parseFloat(result.lon);

                // Mover mapa y marcador
                leafletMap.setView([selectedLat, selectedLon], 15);
                selectedMarker.setLatLng([selectedLat, selectedLon]);
                updateSimArea();

                // Mostrar nombre del lugar encontrado
                const areaInfo = document.getElementById('area-info');
                if (areaInfo) {
                    areaInfo.innerHTML = `
                        <strong>📍 ${result.display_name}</strong><br>
                        Lat: ${selectedLat.toFixed(5)}° | Lon: ${selectedLon.toFixed(5)}°<br>
                        Área de simulación: 1km² (±500 m por eje)
                    `;
                }
            } else {
                alert('Lugar no encontrado. Intenta con otra búsqueda.');
            }
        } catch (error) {
            console.error('Error en búsqueda:', error);
            alert('Error al buscar el lugar. Verifica tu conexión.');
        }
    }

    searchBtn.addEventListener('click', searchLocation);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchLocation();
    });
}

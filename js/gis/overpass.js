/**
 * Módulo de Cliente Overpass API - GeoWalker
 * Extrae vectores geográficos (calles, edificios, ríos, POIs) de OpenStreetMap bajo demanda.
 */

/**
 * Calcula un Bounding Box (BBOX) de aproximadamente 1km2 (radio de 500m) alrededor de un punto lat/lon.
 * @param {number} lat - Latitud central
 * @param {number} lon - Longitud central
 * @returns {Object} { south, west, north, east }
 */
export function calculateBBox(lat, lon) {
    // 1 grado de latitud equivale aprox a 111,000 metros. 500m = ~0.0045 grados.
    const offsetLat = 500 / 111000;
    
    // 1 grado de longitud depende de la latitud.
    const latRad = lat * (Math.PI / 180);
    const offsetLon = 500 / (111000 * Math.cos(latRad));

    return {
        south: lat - offsetLat,
        west: lon - offsetLon,
        north: lat + offsetLat,
        east: lon + offsetLon
    };
}

/**
 * Realiza la consulta a la Overpass API para obtener todos los elementos vectoriales del área.
 * @param {number} lat - Latitud de origen
 * @param {number} lon - Longitud de origen
 * @returns {Promise<Object>} Datos en formato JSON devueltos por OpenStreetMap
 */
export async function fetchOSMData(lat, lon) {
    const bbox = calculateBBox(lat, lon);
    const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;

    // Consulta Overpass QL optimizada para extraer vías, edificios, barreras, agua y amenidades
    const query = `
        [out:json][timeout:25];
        (
          way["highway"](${bboxStr});
          way["building"](${bboxStr});
          relation["building"](${bboxStr});
          way["barrier"](${bboxStr});
          way["waterway"](${bboxStr});
          node["amenity"](${bboxStr});
          way["amenity"](${bboxStr});
        );
        out body;
        >;
        out skel qt;
    `;

    // Endpoints públicos oficiales de Overpass API (con respaldo si uno falla)
    const endpoints = [
        "https://overpass-api.de/api/interpreter",
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
    ];

    let data = null;

    for (const url of endpoints) {
        try {
            const response = await fetch(url, {
                method: "POST",
                body: `data=${encodeURIComponent(query)}`,
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            });

            if (response.ok) {
                data = await response.json();
                break; // Éxito, salimos del ciclo
            }
        } catch (error) {
            console.warn(`Falló la conexión con ${url}, intentando con el siguiente...`, error);
        }
    }

    if (!data) {
        throw new Error("No se pudo conectar a ningún servidor de Overpass API para descargar los datos geográficos.");
    }

    return data;
}
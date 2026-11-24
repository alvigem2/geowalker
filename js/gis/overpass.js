import { ProjectionConfig } from './projections.js';

/**
 * Módulo de Cliente Overpass API - GeoWalker
 * Extrae vectores geográficos (calles, edificios, ríos, POIs) de OpenStreetMap bajo demanda.
 */

/**
 * Calcula un Bounding Box (BBOX) de aproximadamente 1 km² (±500 m por eje) alrededor de un punto lat/lon.
 * @param {number} lat - Latitud central
 * @param {number} lon - Longitud central
 * @returns {Object} { south, west, north, east }
 */
export function calculateBBox(lat, lon) {
    const offsetLat = ProjectionConfig.AREA_HALF_SIZE_METERS / ProjectionConfig.EARTH_RADIUS * 180 / Math.PI;
    const offsetLon = offsetLat / Math.cos(lat * Math.PI / 180);

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
          relation["type"="multipolygon"]["building"](${bboxStr});
          way["barrier"](${bboxStr});
          way["waterway"](${bboxStr});
          way["leisure"~"^(park|garden)$"](${bboxStr});
          relation["type"="multipolygon"]["leisure"~"^(park|garden)$"](${bboxStr});
          way["landuse"~"^(grass|meadow|recreation_ground|village_green|forest)$"](${bboxStr});
          relation["type"="multipolygon"]["landuse"~"^(grass|meadow|recreation_ground|village_green|forest)$"](${bboxStr});
          way["natural"~"^(grassland|wood|scrub)$"](${bboxStr});
          relation["type"="multipolygon"]["natural"~"^(grassland|wood|scrub)$"](${bboxStr});
          way["natural"="water"](${bboxStr});
          relation["type"="multipolygon"]["natural"="water"](${bboxStr});
          way["landuse"="reservoir"](${bboxStr});
          relation["type"="multipolygon"]["landuse"="reservoir"](${bboxStr});
          way["leisure"="swimming_pool"](${bboxStr});
          relation["type"="multipolygon"]["leisure"="swimming_pool"](${bboxStr});
          relation["type"="multipolygon"]["waterway"="riverbank"](${bboxStr});
          relation["type"="multipolygon"]["waterway"]["area"="yes"](${bboxStr});
          node["natural"="tree"](${bboxStr});
          node["amenity"](${bboxStr});
          node["shop"](${bboxStr});
          way["amenity"](${bboxStr});
        );
        (._; >>;);
        out body qt;
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

/**
 * Módulo de Proyecciones y Conversiones Geodésicas - GeoWalker
 * Maneja WGS84, Web Mercator, Escala 1m = 4px, Isometría y coordenadas UTM.
 */

export const ProjectionConfig = {
    SCALE: 4,               // 1 metro real = 4 píxeles en el canvas
    EARTH_RADIUS: 6378137,  // Radio de la Tierra en metros (WGS84)
};

/**
 * Convierte WGS84 (Lat, Lon) a metros planos (Web Mercator) usando el origen como referencia (0,0).
 * @param {number} lat - Latitud actual en grados
 * @param {number} lon - Longitud actual en grados
 * @param {number} originLat - Latitud del punto de origen seleccionado
 * @param {number} originLon - Longitud del punto de origen seleccionado
 * @returns {Object} Coordenadas en metros {x, y}
 */
export function wgs84ToMeters(lat, lon, originLat, originLon) {
    const dLat = (lat - originLat) * (Math.PI / 180);
    const dLon = (lon - originLon) * (Math.PI / 180);
    
    const latRad = originLat * (Math.PI / 180);
    
    // Proyección equirectangular / Web Mercator local aproximada para 1km2
    const x = dLon * ProjectionConfig.EARTH_RADIUS * Math.cos(latRad);
    const y = dLat * ProjectionConfig.EARTH_RADIUS; // Norte positivo

    return { x, y };
}

/**
 * Convierte metros del mundo real a píxeles de pantalla aplicando la escala del proyecto (1m = 4px).
 * @param {number} metersX 
 * @param {number} metersY 
 * @returns {Object} Coordenadas en píxeles {px, py}
 */
export function metersToPixels(metersX, metersY) {
    return {
        px: metersX * ProjectionConfig.SCALE,
        py: -metersY * ProjectionConfig.SCALE // Invertido porque en pantallas Y crece hacia abajo
    };
}

/**
 * Aplica la transformación isométrica (2.5D) a coordenadas cartesianas planas.
 * @param {number} x - Coordenada X en píxeles planos
 * @param {number} y - Coordenada Y en píxeles planos
 * @returns {Object} Coordenadas isométricas {isoX, isoY}
 */
export function toIsometric(x, y) {
    return {
        isoX: x - y,
        isoY: (x + y) / 2
    };
}

/**
 * Cálculo aproximado de la Zona UTM y coordenadas UTM (Easting, Northing) para el HUD.
 * @param {number} lat 
 * @param {number} lon 
 * @returns {Object} { zone, hemisphere, easting, northing }
 */
export function computeUTM(lat, lon) {
    const zone = Math.floor((lon + 180) / 6) + 1;
    const hemisphere = lat >= 0 ? 'N' : 'S';
    
    // Aproximación lineal local para visualización en el HUD de SIG
    const centralMeridian = (zone - 1) * 6 - 180 + 3;
    const dLonRad = (lon - centralMeridian) * (Math.PI / 180);
    
    const k0 = 0.9996;
    const Easting = 500000 + k0 * ProjectionConfig.EARTH_RADIUS * dLonRad * Math.cos(lat * Math.PI / 180);
    let Northing = k0 * ProjectionConfig.EARTH_RADIUS * (lat * Math.PI / 180);
    
    if (lat < 0) {
        Northing += 10000000; // Offset para el hemisferio sur
    }

    return {
        zone: `${zone}${hemisphere}`,
        easting: Math.round(Easting),
        northing: Math.round(Northing)
    };
}

/**
 * Convierte grados decimales a formato Sexagesimal (Grados, Minutos, Segundos - DMS).
 * @param {number} decimal - Coordenada en grados decimales
 * @param {boolean} isLat - True si es latitud (para indicar N/S), False si es longitud (E/O)
 * @returns {string} Coordenada formateada en DMS (ej. 17°47'01.5"S)
 */
export function decimalToDMS(decimal, isLat) {
    const absolute = Math.abs(decimal);
    const degrees = Math.floor(absolute);
    const minutesNotTruncated = (absolute - degrees) * 60;
    const minutes = Math.floor(minutesNotTruncated);
    const seconds = ((minutesNotTruncated - minutes) * 60).toFixed(1);

    let direction = "";
    if (isLat) {
        direction = decimal >= 0 ? "N" : "S";
    } else {
        direction = decimal >= 0 ? "E" : "O";
    }

    return `${degrees}°${minutes}'${seconds}"${direction}`;
}
import { getAreaFootprints, getBuildingFootprints, isWaterArea } from './buildingFootprints.js';

const encoder = new TextEncoder();
const feature = (type, coordinates, properties) => ({ type: 'Feature', geometry: { type, coordinates }, properties });
const collection = features => JSON.stringify({ type: 'FeatureCollection', features });
const xy = ({ x, y }) => [x, y];

function corners({ north, south, east, west }) {
    return [
        ['Noroeste', west, north], ['Noreste', east, north],
        ['Sureste', east, south], ['Suroeste', west, south]
    ];
}

export function exportCoordinates({ origin, player, bounds }) {
    const rows = [['Centro', origin.lon, origin.lat], ...corners(bounds), ['Jugador', player.lon, player.lat]];
    return '\uFEFF' + ['punto,longitud,latitud', ...rows.map(([name, lon, lat]) =>
        [name, lon.toFixed(7), lat.toFixed(7)].join(',')
    )].join('\r\n') + '\r\n';
}

function closeRing(points, clockwise) {
    const coords = points.map(xy);
    const [firstX, firstY] = coords[0];
    const area = coords.reduce((sum, [x, y], i) => {
        const [nextX, nextY] = coords[(i + 1) % coords.length];
        return sum + (x - firstX) * (nextY - firstY) - (y - firstY) * (nextX - firstX);
    }, 0);
    if (!area) return null;
    if ((area < 0) !== clockwise) coords.reverse();
    return [...coords, coords[0]];
}

function properties(tags, type, id, category) {
    return {
        osm_id: String(id), osm_tipo: type, nombre: tags.name || '', clase: category,
        etiquetas: JSON.stringify(tags)
    };
}

function polygonFeatures(footprints, classify) {
    const areas = new Map();
    for (const { points, holes, tags, osmId, osmType } of footprints) {
        const outer = closeRing(points, false);
        if (!outer) continue;
        const key = osmType + '/' + osmId;
        if (!areas.has(key)) areas.set(key, { polygons: [], attributes: properties(tags, osmType, osmId, classify(tags)) });
        areas.get(key).polygons.push([outer, ...holes.map(ring => closeRing(ring, true)).filter(Boolean)]);
    }
    return Array.from(areas.values(), ({ polygons, attributes }) =>
        polygons.length === 1
            ? feature('Polygon', polygons[0], attributes)
            : feature('MultiPolygon', polygons, attributes)
    );
}

export function exportLayers({ elements, bounds }, isGreenArea) {
    const nodes = new Map(elements.filter(el => el.type === 'node' && Number.isFinite(el.lon) && Number.isFinite(el.lat))
        .map(el => [el.id, { x: el.lon, y: el.lat }]));
    const project = id => nodes.get(id);
    const areas = classify => getAreaFootprints(elements, project, classify);
    const lines = (matches, classify) => elements.flatMap(el => {
        if (el.type !== 'way' || !el.tags || !matches(el.tags) || !el.nodes || el.nodes.length < 2) return [];
        const points = el.nodes.map(project);
        return points.every(Boolean)
            ? [feature('LineString', points.map(xy), properties(el.tags, el.type, el.id, classify(el.tags)))]
            : [];
    });
    const pois = elements.flatMap(el => {
        const tags = el.tags;
        const point = el.type === 'node' && project(el.id);
        if (!point || !tags || !(tags.amenity || tags.shop || tags.tourism)) return [];
        return [feature('Point', xy(point), properties(tags, el.type, el.id, tags.amenity || tags.shop || tags.tourism))];
    });
    const boundary = closeRing(corners(bounds).map(([, x, y]) => ({ x, y })), false);
    return [
        ['limite.geojson', collection([feature('Polygon', [boundary], { nombre: 'Área de simulación', superficie_m2: 1000000 })])],
        ['vias.geojson', collection(lines(tags => !!tags.highway, tags => tags.highway))],
        ['edificios.geojson', collection(polygonFeatures(getBuildingFootprints(elements, project), tags => tags.building))],
        ['agua.geojson', collection(polygonFeatures(areas(isWaterArea), tags => tags.water || tags.waterway || tags.landuse || tags.leisure || 'agua'))],
        ['cauces.geojson', collection(lines(tags => !!tags.waterway && tags.waterway !== 'riverbank' && !isWaterArea(tags), tags => tags.waterway))],
        ['areas_verdes.geojson', collection(polygonFeatures(areas(isGreenArea), tags => tags.leisure || tags.landuse || tags.natural))],
        ['puntos_interes.geojson', collection(pois)]
    ];
}

export function exportNote({ origin }, includesCsv) {
    const date = new Intl.DateTimeFormat('es-BO', {
        dateStyle: 'long', timeStyle: 'short', timeZone: 'America/La_Paz'
    }).format(new Date());
    return [
        'GeoWalker — Datos del área de simulación',
        `Exportado el ${date} (hora de Bolivia).`,
        `Centro: latitud ${origin.lat.toFixed(7)}°, longitud ${origin.lon.toFixed(7)}°.`,
        'Datos © colaboradores de OpenStreetMap, obtenidos vía Overpass. https://www.openstreetmap.org/copyright',
        '',
        'Coordenadas geográficas WGS 84. En GeoJSON, cada posición sigue el orden longitud, latitud.',
        'Las capas contienen los objetos de la consulta. Una vía o un área puede continuar fuera del límite de 1 km².',
        'Una capa sin objetos se entrega como una colección vacía.',
        '',
        'ArcGIS Pro: use JSON To Features. Elija Polygon para límite, edificios, agua y áreas verdes;',
        'Polyline para vías y cauces; Point para puntos de interés.',
        ...(includesCsv ? [
            '',
            'Excel: Datos > Desde texto/CSV. El archivo usa UTF-8, separador coma y punto decimal.',
            'Si las columnas numéricas se leen como texto, use tipo decimal con configuración regional Inglés (Estados Unidos).',
            'Para convertir la tabla a puntos en un SIG, use longitud como X y latitud como Y, con WGS 84.'
        ] : [])
    ].join('\r\n') + '\r\n';
}

function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

// ZIP con almacenamiento directo. Mantiene una sola descarga sin dependencias externas.
export function exportZip(files) {
    const body = [];
    const directory = [];
    let offset = 0;
    let directorySize = 0;
    const header = (size, signature) => {
        const view = new DataView(new ArrayBuffer(size));
        view.setUint32(0, signature, true);
        return view;
    };
    for (const [name, content] of files) {
        const filename = encoder.encode(name);
        const bytes = encoder.encode(content);
        const local = header(30, 0x04034b50);
        const central = header(46, 0x02014b50);
        const sum = crc32(bytes);
        local.setUint16(4, 20, true);
        local.setUint16(6, 0x800, true);
        local.setUint16(12, 33, true);
        local.setUint32(14, sum, true);
        local.setUint32(18, bytes.length, true);
        local.setUint32(22, bytes.length, true);
        local.setUint16(26, filename.length, true);
        central.setUint16(4, 20, true);
        central.setUint16(6, 20, true);
        central.setUint16(8, 0x800, true);
        central.setUint16(14, 33, true);
        central.setUint32(16, sum, true);
        central.setUint32(20, bytes.length, true);
        central.setUint32(24, bytes.length, true);
        central.setUint16(28, filename.length, true);
        central.setUint32(42, offset, true);
        body.push(local.buffer, filename, bytes);
        directory.push(central.buffer, filename);
        offset += local.byteLength + filename.length + bytes.length;
        directorySize += central.byteLength + filename.length;
    }
    const end = header(22, 0x06054b50);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, directorySize, true);
    end.setUint32(16, offset, true);
    return new Blob([...body, ...directory, end.buffer], { type: 'application/zip' });
}

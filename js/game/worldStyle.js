import { isPointInPolygon } from '../gis/buildingFootprints.js';
import { metersToPixels, ProjectionConfig, toIsometric } from '../gis/projections.js';

export function buildingCoversPlayer({ x, y }, { points, holes, bounds, height }) {
    if (x + 5 < bounds.minX || x - 5 > bounds.maxX ||
        y >= bounds.maxY || y - 7 < bounds.minY - height) return false;

    // A screen-space slice through the footprint yields solid spans and courtyard gaps.
    for (const sampleX of [x, x - 5, x + 5]) {
        if (sampleX < bounds.minX || sampleX >= bounds.maxX) continue;
        const crossings = [];
        for (const ring of [points, ...holes]) {
            for (let i = 0; i < ring.length; i++) {
                const a = ring[i];
                const b = ring[(i + 1) % ring.length];
                if ((a.x > sampleX) !== (b.x > sampleX)) {
                    crossings.push(a.y + (b.y - a.y) * (sampleX - a.x) / (b.x - a.x));
                }
            }
        }
        crossings.sort((a, b) => a - b);
        for (let i = 0; i + 1 < crossings.length; i += 2) {
            const back = crossings[i];
            const front = crossings[i + 1];
            if (front > y && back - height <= y - 7) return true;
        }
    }
    return false;
}

export const pedestrianHighways = ['pedestrian', 'footway', 'path', 'steps', 'cycleway', 'bridleway'];
const majorHighways = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];
const dirtSurfaces = ['unpaved', 'gravel', 'fine_gravel', 'dirt', 'ground', 'earth', 'sand', 'grass', 'compacted'];

export function roadStyle(tags) {
    const type = tags.highway.replace(/_link$/, '');
    const major = majorHighways.includes(type);
    const path = pedestrianHighways.includes(type);
    const dirt = dirtSurfaces.includes(tags.surface) || (!tags.surface && type === 'track');
    const width = path ? (type === 'pedestrian' ? 12 : 6)
        : major ? (['motorway', 'trunk', 'primary'].includes(type) ? 28 : 22)
        : (type === 'service' || type === 'track' ? 11 : 17);
    return {
        width,
        border: dirt ? 0x827653 : path ? 0x958b73 : 0x7a7367,
        shoulder: dirt ? 0xae9c72 : path ? 0xc5bda4 : 0xd6cbbb,
        surface: dirt ? 0xb4a27d : path ? 0xd8cdb3 : 0x55595e,
        margin: path ? 1 : major ? 3 : 2,
        stripe: major && !dirt ? (tags.oneway === 'yes' ? 0xe6e5d9 : 0xf2d181) : null,
        grain: dirt || path ? 0x736647 : 0xaab1b4
    };
}

export function drawRoads(graphics, roads) {
    // Pintar cada capa de toda la red evita bordillos atravesando cruces.
    for (const layer of ['border', 'shoulder', 'surface']) {
        for (const { points, style } of roads) {
            const extra = layer === 'border' ? 2 * style.margin + 2
                : layer === 'shoulder' ? 2 * style.margin : 0;
            graphics.lineStyle(style.width + extra, style[layer], 1).strokePoints(points);
        }
    }
    for (const { points, style } of roads) {
        graphics.fillStyle(style.grain, 0.26);
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1];
            const b = points[i];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const length = Math.hypot(dx, dy);
            const spacing = Math.max(5, length / 240);
            for (let offset = spacing; offset < length; offset += spacing) {
                const across = (variation(a.x + offset, a.y) - 0.5) * (style.width - 2);
                const x = a.x + (dx * offset - dy * across) / length;
                const y = a.y + (dy * offset + dx * across) / length;
                graphics.fillRect(x, y, 1 + variation(x, y), 1);
            }
        }
        if (style.stripe === null) continue;
        graphics.lineStyle(1.4, style.stripe, 0.9);
        let distance = 0;
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1];
            const b = points[i];
            const length = Math.hypot(b.x - a.x, b.y - a.y);
            if (!length) continue;
            for (let dash = Math.floor(distance / 37) * 37; dash < distance + length; dash += 37) {
                const start = Math.max(0, dash - distance, 12 - distance);
                const end = Math.min(length, dash + 16 - distance,
                    i === points.length - 1 ? length - 12 : length);
                if (end <= start) continue;
                graphics.lineBetween(
                    a.x + (b.x - a.x) * start / length, a.y + (b.y - a.y) * start / length,
                    a.x + (b.x - a.x) * end / length, a.y + (b.y - a.y) * end / length
                );
            }
            distance += length;
        }
    }
}

const grass = { ground: 0x82ad58, edge: 0xa0bd6c, blades: 0x3f742f };
const park = { ground: 0x729b56, edge: 0xa0bb75, blades: 0x3a723e };
const woodland = { ground: 0x537a49, edge: 0x79935d, blades: 0x2b5834 };
const garden = { ground: 0x779c58, edge: 0xb0be76, blades: 0x3e7545 };

export function greenStyle(tags) {
    if (tags.landuse === 'forest' || ['wood', 'scrub'].includes(tags.natural)) return woodland;
    if (tags.leisure === 'garden' || tags.landuse === 'village_green') return garden;
    if (['grass', 'meadow', 'recreation_ground'].includes(tags.landuse) || tags.natural === 'grassland') return grass;
    if (tags.leisure === 'park') return park;
    return null;
}

function variation(x, y) {
    const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return value - Math.floor(value);
}

export function drawGrassDetail(graphics, points, holes, bounds, color) {
    const area = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
    const spacing = Math.max(17, Math.ceil(Math.sqrt(area / 550)));
    graphics.lineStyle(1, color, 0.48);
    for (let x = bounds.minX; x + spacing <= bounds.maxX; x += spacing) {
        for (let y = bounds.minY; y + spacing <= bounds.maxY; y += spacing) {
            const point = { x: x + spacing * variation(x, y), y: y + spacing * variation(y, x) };
            if (isPointInPolygon(point, points) && !holes.some(hole => isPointInPolygon(point, hole))) {
                graphics.fillStyle(variation(y + 3, x) > 0.5 ? 0xe3eeaa : color, 0.27);
                graphics.fillEllipse(point.x, point.y, 3 + variation(x + y, y) * 4, 2);
                graphics.lineBetween(point.x, point.y, point.x - 1.5, point.y - 2.5);
                graphics.lineBetween(point.x, point.y, point.x + 2, point.y - 3.5);
            }
        }
    }
}

function drawAreaGrain(graphics, { points, holes, bounds }, color, spacing, maxSamples, width, opacity) {
    const area = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
    const step = Math.max(spacing, Math.sqrt(area / maxSamples));
    const contains = point => isPointInPolygon(point, points) &&
        !holes.some(hole => isPointInPolygon(point, hole));
    graphics.lineStyle(1, color, opacity);
    for (let x = bounds.minX; x + step <= bounds.maxX; x += step) {
        for (let y = bounds.minY; y + step <= bounds.maxY; y += step) {
            const left = x + variation(x, y) * step;
            const top = y + variation(y, x) * step;
            const length = width * (0.5 + variation(left, top) * 0.5);
            if ([0, 0.25, 0.5, 0.75, 1].every(t => contains({ x: left + length * t, y: top }))) {
                graphics.lineBetween(left, top, left + length, top);
            }
        }
    }
}

export function drawWaterReflections(graphics, footprint) {
    drawAreaGrain(graphics, footprint, 0xc4f2e5, 13, 700, 10, 0.62);
}

export function drawRoofDetail(graphics, footprint) {
    drawAreaGrain(graphics, footprint, 0xfff1d7, 7, 120, 5, 0.24);
}

export function drawWallDetail(graphics, a, b, height) {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const windows = Math.min(40, Math.floor(length / 11));
    const levels = Math.min(16, Math.floor(height / 6));
    for (let row = 0; row < levels; row++) {
        for (let col = 0; col < windows; col++) {
            const t = (col + 0.5) / windows;
            const x = a.x + (b.x - a.x) * t;
            const y = a.y + (b.y - a.y) * t - (row + 0.65) * height / levels;
            const half = 2 / length;
            const dx = (b.x - a.x) * half;
            const dy = (b.y - a.y) * half;
            graphics.fillStyle(0x273e54, 0.57).fillPoints([
                { x: x - dx, y: y - dy }, { x: x + dx, y: y + dy },
                { x: x + dx, y: y + dy + 2.4 }, { x: x - dx, y: y - dy + 2.4 }
            ], true);
        }
    }
}

export function drawTree(graphics, x, y, tags) {
    const size = 0.85 + variation(x, y) * 0.4;
    const needles = tags.leaf_type === 'needleleaved';
    const crown = needles ? 0x356644 : 0x4d8644;
    const light = needles ? 0x69955e : 0x85ae55;
    graphics.fillStyle(0x263e2d, 0.28).fillEllipse(x + 5 * size, y + 1, 18 * size, 7 * size);
    graphics.fillStyle(0x695138, 1).fillRect(x - 1.5 * size, y - 12 * size, 3 * size, 12 * size);
    if (needles) {
        graphics.fillStyle(crown, 1).fillTriangle(x - 8 * size, y - 7 * size, x + 8 * size, y - 7 * size, x, y - 29 * size);
        graphics.fillStyle(light, 1).fillTriangle(x - 5 * size, y - 14 * size, x + 4 * size, y - 14 * size, x, y - 29 * size);
    } else {
        graphics.fillStyle(crown, 1).fillEllipse(x, y - 15 * size, 20 * size, 17 * size);
        graphics.fillStyle(0x6f9e50, 1).fillCircle(x - 4 * size, y - 18 * size, 6 * size);
        graphics.fillStyle(light, 1).fillCircle(x + size, y - 22 * size, 5 * size);
        graphics.fillStyle(0xb6cf71, 0.7).fillCircle(x + 1.5 * size, y - 23 * size, 1.4 * size);
        graphics.fillStyle(0x315e39, 0.6).fillCircle(x + 4 * size, y - 12 * size, 2.1 * size);
    }
}

export function projectMapSquare(origin, halfSize) {
    return [[-halfSize, -halfSize], [halfSize, -halfSize], [halfSize, halfSize], [-halfSize, halfSize]]
        .map(([east, north]) => {
            const { px, py } = metersToPixels(east, north);
            const { isoX, isoY } = toIsometric(px, py);
            return { x: origin.x + isoX, y: origin.y + isoY };
        });
}

export function drawBoundaryFog(graphics, origin) {
    const limit = ProjectionConfig.AREA_HALF_SIZE_METERS;
    const fog = 0x687c78;
    const start = limit - 26;
    const end = limit + 62;
    const bands = 28;
    const ring = (inner, outer, alpha) => {
        const inside = projectMapSquare(origin, inner);
        const outside = projectMapSquare(origin, outer);
        graphics.fillStyle(fog, alpha);
        for (let i = 0; i < 4; i++) {
            const j = (i + 1) % 4;
            graphics.fillPoints([inside[i], inside[j], outside[j], outside[i]], true);
        }
    };
    for (let i = 0; i < bands; i++) {
        const from = i / bands;
        const to = (i + 1) / bands;
        const blend = (from + to) / 2;
        ring(start + (end - start) * from, start + (end - start) * to, blend * blend * (3 - 2 * blend));
    }
    ring(end, limit * 8, 1);
    graphics.lineStyle(1.5, 0xdde5d2, 0.7).strokePoints(projectMapSquare(origin, limit), true);
}

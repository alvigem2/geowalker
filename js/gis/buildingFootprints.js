function assembleRings(members, ways, role) {
    const segments = members
        .filter(member => member.type === 'way' && (member.role || 'outer') === role)
        .map(member => ways.get(member.ref));
    const rings = [];
    if (segments.some(way => !way || way.nodes.length < 2)) return rings;

    const pending = [...segments];
    while (pending.length) {
        const first = pending.pop();
        const nodes = [...first.nodes];
        const ids = [first.id];

        while (nodes[0] !== nodes.at(-1)) {
            const end = nodes.at(-1);
            const index = pending.findIndex(way => way.nodes[0] === end || way.nodes.at(-1) === end);
            if (index === -1) break;
            const [next] = pending.splice(index, 1);
            const ordered = next.nodes[0] === end ? next.nodes : [...next.nodes].reverse();
            nodes.push(...ordered.slice(1));
            ids.push(next.id);
        }

        if (nodes.length >= 4 && nodes[0] === nodes.at(-1)) {
            rings.push({ nodes: nodes.slice(0, -1), ids });
        }
    }
    return rings;
}

export function getBuildingFootprints(elements, projectNode) {
    return getAreaFootprints(elements, projectNode, tags => !!tags.building && tags.building !== 'no');
}

export function isWaterArea(tags) {
    return tags.area !== 'no' && (tags.natural === 'water' ||
        tags.landuse === 'reservoir' || tags.leisure === 'swimming_pool' ||
        tags.waterway === 'riverbank' || (!!tags.waterway && tags.area === 'yes'));
}

export function getAreaFootprints(elements, projectNode, matches) {
    const ways = new Map(elements.filter(el => el.type === 'way' && el.nodes).map(el => [el.id, el]));
    const usedWays = new Set();
    const footprints = [];
    const projectRing = nodes => {
        const points = nodes.map(projectNode);
        return points.every(Boolean) ? points : null;
    };

    for (const relation of elements) {
        if (relation.type !== 'relation' || relation.tags?.type !== 'multipolygon' ||
            !matches(relation.tags) || !relation.members) continue;

        const interiors = assembleRings(relation.members, ways, 'inner')
            .map(ring => ({ ...ring, points: projectRing(ring.nodes) }))
            .filter(ring => ring.points);
        for (const outer of assembleRings(relation.members, ways, 'outer')) {
            const points = projectRing(outer.nodes);
            if (!points) continue;
            const holes = interiors.filter(ring => isPointInPolygon(ring.points[0], points));
            footprints.push({ points, holes: holes.map(ring => ring.points), tags: relation.tags, osmId: relation.id, osmType: relation.type });
            outer.ids.forEach(id => usedWays.add(id));
            holes.forEach(hole => hole.ids.forEach(id => usedWays.add(id)));
        }
    }

    for (const way of ways.values()) {
        if (!way.tags || !matches(way.tags) || usedWays.has(way.id) || way.nodes.length < 4 ||
            way.nodes[0] !== way.nodes.at(-1)) continue;
        const points = projectRing(way.nodes.slice(0, -1));
        if (points) footprints.push({ points, holes: [], tags: way.tags, osmId: way.id, osmType: way.type });
    }
    return footprints;
}

export function isPointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        let xi = polygon[i].x, yi = polygon[i].y;
        let xj = polygon[j].x, yj = polygon[j].y;

        let intersect = ((yi > point.y) !== (yj > point.y)) &&
            (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

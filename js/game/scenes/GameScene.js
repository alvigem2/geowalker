import { SpatialGrid } from '../SpatialGrid.js';
import { getAreaFootprints, getBuildingFootprints, isWaterArea } from '../../gis/buildingFootprints.js';
import { calculateBBox } from '../../gis/overpass.js';
import { exportCoordinates, exportLayers, exportNote, exportZip } from '../../gis/exportData.js';
import { Player } from '../entities/Player.js';
import { TouchJoystick } from '../TouchJoystick.js';
import { buildingCoversPlayer, drawBoundaryFog, drawGrassDetail, drawRoads, drawRoofDetail, drawTree, drawWallDetail, drawWaterReflections, greenStyle, pedestrianHighways, projectMapSquare, roadStyle } from '../worldStyle.js';
import { animatePerson, personTexture, prepareActorTextures, vehicleTexture } from '../actorArt.js';
import { wgs84ToMeters, metersToPixels, toIsometric, isometricToMeters, ProjectionConfig, computeUTM, decimalToDMS } from '../../gis/projections.js';

const HUD_INTERVAL_MS = 100;
const POI_RADIUS_METERS = 40;

function getCompassAngle(east, north) {
    return Math.atan2(east, north) - Math.PI / 2;
}

function isWatercourse(tags) {
    return !!tags.waterway && tags.waterway !== 'riverbank' && !isWaterArea(tags);
}

const buildingColors = [
    { tags: ['place_of_worship', 'church', 'chapel', 'cathedral', 'mosque', 'temple', 'synagogue'], roof: 0xd49a53, wall: 0x885428 },
    { tags: ['bank'], roof: 0x6e9cf0, wall: 0x31548b },
    { tags: ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'food_court'], roof: 0xe68066, wall: 0x943f39 },
    { tags: ['school', 'university', 'college', 'kindergarten', 'library'], roof: 0xb69be9, wall: 0x695598 },
    { tags: ['hospital', 'clinic', 'doctors', 'pharmacy', 'dentist'], roof: 0xe58ab0, wall: 0x8e4569 },
    { tags: ['apartments', 'residential', 'house', 'detached', 'terrace', 'semidetached_house'], roof: 0x9cabbd, wall: 0x536478 },
    { tags: ['commercial', 'retail', 'supermarket', 'mall', 'office', 'marketplace'], roof: 0x62cbbb, wall: 0x316e65 },
    { tags: ['industrial', 'warehouse', 'factory'], roof: 0xad967d, wall: 0x69584a },
    { tags: ['civic', 'government', 'townhall', 'police', 'fire_station', 'public'], roof: 0x7fb8d4, wall: 0x406d87 },
    { tags: ['fuel'], roof: 0xd4bc62, wall: 0x7d692f }
];
const defaultBuildingColors = { roof: 0x718096, wall: 0x3e5067 };

function getBuildingColors(tags) {
    const values = [tags.amenity, tags.healthcare, tags.shop, tags.office, tags['building:use'], tags.building];
    for (const value of values) {
        const match = buildingColors.find(category => category.tags.includes(value));
        if (match) return match;
        if (value && value !== 'no' && (value === tags.shop || value === tags.office)) {
            return buildingColors.find(category => category.tags.includes('retail'));
        }
    }
    return defaultBuildingColors;
}

function createPolygonCollider(points, holes = []) {
    const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (const { x, y } of points) {
        bounds.minX = Math.min(bounds.minX, x);
        bounds.maxX = Math.max(bounds.maxX, x);
        bounds.minY = Math.min(bounds.minY, y);
        bounds.maxY = Math.max(bounds.maxY, y);
    }
    return { points, holes, bounds };
}

function fillArea(graphics, points, holes) {
    if (!holes.length) {
        graphics.fillPoints(points, true);
        return;
    }
    const vertices = [...points];
    const holeIndices = [];
    for (const hole of holes) {
        holeIndices.push(vertices.length);
        vertices.push(...hole);
    }
    const indices = Phaser.Geom.Polygon.Earcut(vertices.flatMap(p => [p.x, p.y]), holeIndices);
    for (let i = 0; i < indices.length; i += 3) {
        const [a, b, c] = indices.slice(i, i + 3).map(index => vertices[index]);
        graphics.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
    }
}

export class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
        this.osmData = null;
        this.originLat = 0;
        this.originLon = 0;
        this.buildingsColliders = [];
        this.waterColliders = [];
        this.treeColliders = [];
        this.roadsNetwork = [];
        this.vehicleRoads = [];
        this.npcs = [];
        this.pois = [];
        this.hudText = null;
        this.compassNeedle = null;
        this.tooltipText = null;
        this.totalDistanceMeters = 0;
        this.headingAngle = getCompassAngle(0, 1);
        this.copyBtn = null;
        this.downloadBtn = null;
    }

    init(data) {
        this.osmData = data && data.osmData ? data.osmData : (this.game.initialOSMData ? this.game.initialOSMData.osmData : null);
        this.originLat = data && data.originLat ? data.originLat : (this.game.initialOSMData ? this.game.initialOSMData.originLat : 0);
        this.originLon = data && data.originLon ? data.originLon : (this.game.initialOSMData ? this.game.initialOSMData.originLon : 0);
        
        this.buildingsColliders = [];
        this.waterColliders = [];
        this.treeColliders = [];
        this.roadsNetwork = [];
        this.vehicleRoads = [];
        this.npcs = [];
        this.pois = [];
        this.totalDistanceMeters = 0;
        this.headingAngle = getCompassAngle(0, 1);
    }

    create() {
        const { width, height } = this.scale;
        this.worldOrigin = { x: width / 2, y: height / 2 };
        
        this.cameras.main.setBackgroundColor('#687c78');

        this.terrainGraphics = this.add.graphics();
        this.waterReflections = this.add.graphics();
        this.vectorGraphics = this.add.graphics();
        this.treesGraphics = this.add.graphics();

        this.renderOSMVectorData();

        prepareActorTextures(this.textures);
        const app = this.game.canvas.parentElement;
        this.joystick = new TouchJoystick(app);
        this.player = new Player(this, this.worldOrigin.x, this.worldOrigin.y, this.joystick);
        this.events.once('shutdown', () => this.joystick.destroy());
        // Buscar un punto transitable si el origen está ocupado
        this.snapPlayerToRoad();
        this.spawnTrafficAgents();
        drawBoundaryFog(this.add.graphics(), this.worldOrigin);

        this.cameras.main.startFollow(this.player.sprite, true, 0.08, 0.08);
        this.createHUD();
        this.lastCompassAngle = undefined;
        this.updateHUD(0);
    }

    update(time, delta) {
        if (this.player) {
            const prevX = this.player.x;
            const prevY = this.player.y;

            this.player.update(time, delta, this.buildingsColliders);
            const covered = (this.buildingGrid?.at(this.player.x, this.player.y) ?? this.buildingsColliders)
                .some(building => buildingCoversPlayer(this.player, building));
            const opacity = Phaser.Math.Linear(this.player.sprite.alpha, covered ? 0.42 : 1, Math.min(delta / 100, 1));
            this.player.sprite.setAlpha(opacity);
            this.waterReflections.setAlpha(0.56 + 0.24 * Math.sin(time / 860));

            const dx = this.player.x - prevX;
            const dy = this.player.y - prevY;
            const step = isometricToMeters(dx, dy);
            this.totalDistanceMeters += Math.hypot(step.x, step.y);
            if (step.x || step.y) this.headingAngle = getCompassAngle(step.x, step.y);

            this.updateNPCs(delta, time);
            this.updateHUD(time);
        }
    }

    renderOSMVectorData() {
        this.buildingGrid = null;
        this.waterGrid = null;
        this.treeGrid = null;
        this.poiGrid = null;
        this.hudSnapshot = null;
        if (!this.osmData || !this.osmData.elements) return;

        const nodesMap = new Map();
        this.osmData.elements.forEach(el => {
            if (el.type === 'node') {
                nodesMap.set(el.id, { lat: el.lat, lon: el.lon, tags: el.tags });
            }
        });

        this.vectorGraphics.clear();
        this.terrainGraphics.clear();
        this.waterReflections.clear();
        this.treesGraphics.clear();
        this.buildingsColliders = [];
        this.waterColliders = [];
        this.treeColliders = [];
        this.roadsNetwork = [];
        this.vehicleRoads = [];
        this.pois = [];

        const projectNode = nodeId => {
            const node = nodesMap.get(nodeId);
            if (!node) return null;
            const meters = wgs84ToMeters(node.lat, node.lon, this.originLat, this.originLon);
            const pixels = metersToPixels(meters.x, meters.y);
            const { isoX, isoY } = toIsometric(pixels.px, pixels.py);
            return { x: isoX + this.worldOrigin.x, y: isoY + this.worldOrigin.y };
        };

        nodesMap.forEach((node, id) => {
            const name = node.tags?.name;
            if (name && (node.tags.amenity || node.tags.shop)) {
                this.pois.push({ name, ...projectNode(id) });
            }
        });

        // 1. Suelo, vegetación y agua
        this.terrainGraphics.fillStyle(0xa39a80, 1);
        this.terrainGraphics.fillPoints(projectMapSquare(this.worldOrigin, ProjectionConfig.AREA_HALF_SIZE_METERS + 62), true);
        const greenAreas = getAreaFootprints(this.osmData.elements, projectNode, tags => !!greenStyle(tags));
        for (const { points, holes, tags } of greenAreas) {
            const style = greenStyle(tags);
            this.terrainGraphics.fillStyle(style.ground, 1);
            fillArea(this.terrainGraphics, points, holes);
            this.terrainGraphics.lineStyle(1.2, style.edge, 0.8);
            for (const ring of [points, ...holes]) this.terrainGraphics.strokePoints(ring, true);
            const { bounds } = createPolygonCollider(points, holes);
            drawGrassDetail(this.terrainGraphics, points, holes, bounds, style.blades);
        }
        for (const { points, holes } of getAreaFootprints(this.osmData.elements, projectNode, isWaterArea)) {
            this.terrainGraphics.fillStyle(0x378897, 1);
            fillArea(this.terrainGraphics, points, holes);
            this.terrainGraphics.lineStyle(3, 0x91c6bc, 0.8);
            for (const ring of [points, ...holes]) this.terrainGraphics.strokePoints(ring, true);
            const footprint = createPolygonCollider(points, holes);
            this.waterColliders.push(footprint);
            drawWaterReflections(this.waterReflections, footprint);
        }
        for (const el of this.osmData.elements) {
            if (el.type !== 'way' || !el.tags || !el.nodes || !isWatercourse(el.tags)) continue;
            const points = el.nodes.map(projectNode);
            if (points.length < 2 || !points.every(Boolean)) continue;
            this.terrainGraphics.lineStyle(3, 0x378897, 1);
            this.terrainGraphics.strokePoints(points);
        }

        // 2. Renderizar Vías / Calles
        const roadSurfaces = [];
        for (const el of this.osmData.elements) {
            if (el.type !== 'way' || !el.nodes || !el.tags) continue;
            const { name, highway } = el.tags;
            if (!name && !highway) continue;
            const points = el.nodes.map(projectNode);
            if (points.length < 2 || !points.every(Boolean)) continue;
            if (name) {
                const x = points.reduce((sum, point) => sum + point.x, 0) / points.length;
                const y = points.reduce((sum, point) => sum + point.y, 0) / points.length;
                this.pois.push({ name, x, y });
            }
            if (!highway) continue;
            this.roadsNetwork.push(points);
            if (!pedestrianHighways.includes(highway)) this.vehicleRoads.push(points);
            roadSurfaces.push({ points, style: roadStyle(el.tags) });
        }
        drawRoads(this.vectorGraphics, roadSurfaces);

        // 3. Renderizar Edificios con Extrusión 2.5D y Estilos Semánticos
        const footprints = getBuildingFootprints(this.osmData.elements, projectNode);

        for (const { points, holes, tags } of footprints) {
            const rand = Math.random();
            const levels = tags['building:levels']
                ? parseInt(tags['building:levels'], 10) || 1
                : rand < 0.6 ? 1 : rand < 0.85 ? 2 : 3;

            const extrusionHeight = levels * 6;
            this.buildingsColliders.push({ ...createPolygonCollider(points, holes), height: extrusionHeight });
            const { roof: roofColor, wall: wallColor } = getBuildingColors(tags);

            for (const ring of [points, ...holes]) {
                for (let i = 0; i < ring.length; i++) {
                    const p1 = ring[i];
                    const p2 = ring[(i + 1) % ring.length];

                    this.vectorGraphics.fillStyle(wallColor, 0.95);
                    this.vectorGraphics.beginPath();
                    this.vectorGraphics.moveTo(p1.x, p1.y);
                    this.vectorGraphics.lineTo(p2.x, p2.y);
                    this.vectorGraphics.lineTo(p2.x, p2.y - extrusionHeight);
                    this.vectorGraphics.lineTo(p1.x, p1.y - extrusionHeight);
                    this.vectorGraphics.closePath();
                    this.vectorGraphics.fillPath();
                    drawWallDetail(this.vectorGraphics, p1, p2, extrusionHeight);
                }
            }

            const rings = [points, ...holes].map(ring =>
                ring.map(point => ({ x: point.x, y: point.y - extrusionHeight }))
            );
            this.vectorGraphics.fillStyle(roofColor, 1);
            fillArea(this.vectorGraphics, rings[0], rings.slice(1));
            drawRoofDetail(this.vectorGraphics, createPolygonCollider(rings[0], rings.slice(1)));
            this.vectorGraphics.lineStyle(1, 0x94a3b8, 0.8);
            for (const ring of rings) this.vectorGraphics.strokePoints(ring, true);
        }

        // 4. Renderizar Árboles
        nodesMap.forEach((node, id) => {
            if (node.tags?.natural === 'tree') {
                const { x: tx, y: ty } = projectNode(id);
                this.treeColliders.push({ x: tx, y: ty, radius: 3 });

                drawTree(this.treesGraphics, tx, ty, node.tags);
            }
        });
        this.buildSpatialGrids();
    }

    buildSpatialGrids() {
        this.buildingGrid = new SpatialGrid();
        this.waterGrid = new SpatialGrid();
        this.treeGrid = new SpatialGrid();
        this.poiGrid = new SpatialGrid();

        for (const building of this.buildingsColliders) {
            const { minX, minY, maxX, maxY } = building.bounds;
            this.buildingGrid.insert(building, minX - 5, minY - Math.max(0, building.height), maxX + 5, maxY + 8);
        }
        for (const water of this.waterColliders) {
            const { minX, minY, maxX, maxY } = water.bounds;
            this.waterGrid.insert(water, minX, minY, maxX, maxY);
        }
        for (const tree of this.treeColliders) {
            const { x, y, radius } = tree;
            this.treeGrid.insert(tree, x - radius, y - radius, x + radius, y + radius);
        }
        const poiRangeX = POI_RADIUS_METERS * ProjectionConfig.SCALE * Math.SQRT2;
        const poiRangeY = poiRangeX / 2;
        for (const poi of this.pois) {
            this.poiGrid.insert(poi, poi.x - poiRangeX, poi.y - poiRangeY, poi.x + poiRangeX, poi.y + poiRangeY);
        }

    }

    snapPlayerToRoad() {
        if (!this.player) return;

        const { x, y } = this.player;
        const canStand = point => !this.player.checkCollision(point.x, point.y, this.buildingsColliders);
        if (canStand({ x, y })) return;
        const testPoint = { x, y: y - 8 };

        let best = null;
        let bestDist = Infinity;
        for (const road of this.roadsNetwork) {
            for (let i = 0; i < road.length - 1; i++) {
                const proj = this.projectPointOnSegment(testPoint, road[i], road[i + 1]);
                const dx = proj.x - this.player.x;
                const dy = proj.y - this.player.y;
                const dist = dx * dx + dy * dy;
                if (dist < bestDist && canStand(proj)) {
                    bestDist = dist;
                    best = proj;
                }
            }
        }

        // Si no hay calles transitables, buscar terreno libre alrededor del origen.
        const limit = ProjectionConfig.AREA_HALF_SIZE_METERS;
        for (let radius = 5; !best && radius <= Math.SQRT2 * limit + 5; radius += 5) {
            for (let direction = 0; direction < 16; direction++) {
                const angle = direction * Math.PI / 8;
                const { px, py } = metersToPixels(radius * Math.cos(angle), radius * Math.sin(angle));
                const { isoX, isoY } = toIsometric(px, py);
                const candidate = { x: x + isoX, y: y + isoY };
                if (canStand(candidate)) {
                    best = candidate;
                    break;
                }
            }
        }

        if (best) {
            this.player.x = best.x;
            this.player.y = best.y;
            this.player.sprite.x = best.x;
            this.player.sprite.y = best.y;
            console.info('[GeoWalker] Origen ocupado: jugador reposicionado en terreno transitable.');
        } else {
            console.warn('[GeoWalker] Origen ocupado y no se encontró un punto transitable.');
        }
    }

    /**
     * Proyección ortogonal de un punto sobre un segmento (con clamp a los extremos).
     */
    projectPointOnSegment(p, a, b) {
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const apx = p.x - a.x;
        const apy = p.y - a.y;
        const ab2 = abx * abx + aby * aby;
        let t = ab2 === 0 ? 0 : (apx * abx + apy * aby) / ab2;
        t = Math.max(0, Math.min(1, t));
        return { x: a.x + t * abx, y: a.y + t * aby };
    }

    spawnTrafficAgents() {
        this.spawnVehicles();
        this.spawnPedestrians();
    }

    spawnVehicles() {
        if (this.vehicleRoads.length === 0) return;

        for (let i = 0; i < 30; i++) {
            const randomRoad = this.vehicleRoads[Math.floor(Math.random() * this.vehicleRoads.length)];
            if (!randomRoad || randomRoad.length === 0) continue;
            
            const models = ['car', 'taxi', 'truck'];
            this.spawnAgent(randomRoad, 'vehicle', models[i % models.length], 60 + Math.random() * 30);
        }
    }

    spawnPedestrians() {
        // Peatones usan TODAS las vías (roadsNetwork incluye peatonales, footway, path, etc.)
        if (this.roadsNetwork.length === 0) return;

        for (let i = 0; i < 50; i++) {
            const randomRoad = this.roadsNetwork[Math.floor(Math.random() * this.roadsNetwork.length)];
            if (!randomRoad || randomRoad.length === 0) continue;
            
            this.spawnAgent(randomRoad, 'pedestrian', i % 2 ? 'pedestrianA' : 'pedestrianB', 25 + Math.random() * 15);
        }
    }

    spawnAgent(road, type, model, speed) {
        const index = Math.floor(Math.random() * (road.length - 1));
        const start = road[index];
        const next = road[index + 1];
        const offset = Math.random();
        const x = Phaser.Math.Linear(start.x, next.x, offset);
        const y = Phaser.Math.Linear(start.y, next.y, offset);
        const vehicle = type === 'vehicle';
        const sprite = this.add.image(x, y, vehicle ? vehicleTexture(model) : personTexture(model))
            .setOrigin(0.5, vehicle ? 0.53 : 0.93).setScale(vehicle ? 0.76 : 0.66);
        if (vehicle) sprite.setRotation(Math.atan2(next.y - start.y, next.x - start.x));
        this.npcs.push({ sprite, road, targetIndex: index + 1, direction: 1, speed, type, model });
    }

    updateNPCs(delta, time) {
        const deltaSec = delta / 1000;
        for (const npc of this.npcs) {
            const targetNode = npc.road[npc.targetIndex];
            const dx = targetNode.x - npc.sprite.x;
            const dy = targetNode.y - npc.sprite.y;
            const distance = Math.hypot(dx, dy);
            const step = Math.min(distance, npc.speed * deltaSec);

            if (distance > 0) {
                npc.sprite.x += dx / distance * step;
                npc.sprite.y += dy / distance * step;
                if (npc.type === 'vehicle') npc.sprite.setRotation(Math.atan2(dy, dx));
                else animatePerson(npc.sprite, npc.model, dx, dy, time);
            }
            if (step === distance) {
                if (npc.targetIndex === 0 || npc.targetIndex === npc.road.length - 1) npc.direction *= -1;
                npc.targetIndex += npc.direction;
            }
        }
    }

    createHUD() {
        // Cuadro de telemetría HUD
        const hudBg = this.hudBg = this.add.rectangle(15, 15, 320, 195, 0x0f172a, 0.85);
        hudBg.setOrigin(0, 0);
        hudBg.setScrollFactor(0);
        hudBg.setStrokeStyle(1, 0x334155);

        this.hudText = this.add.text(25, 25, '', {
            fontFamily: 'monospace',
            fontSize: '11px',
            fill: '#38bdf8',
            lineSpacing: 3
        });
        this.hudText.setScrollFactor(0);

        // Botón "Copiar Coordenadas"
        this.copyBtn = this.add.text(25, 155, '📋 COPIAR COORDENADAS', {
            fontFamily: 'monospace',
            fontSize: '10px',
            fill: '#22d3ee',
            backgroundColor: '#0f172a',
            padding: { x: 8, y: 4 }
        });
        this.copyBtn.setScrollFactor(0);
        this.copyBtn.setInteractive({ useHandCursor: true });
        this.copyBtn.on('pointerover', () => this.copyBtn.setStyle({ fill: '#67e8f9', backgroundColor: '#1e293b' }));
        this.copyBtn.on('pointerout', () => this.copyBtn.setStyle({ fill: '#22d3ee', backgroundColor: '#0f172a' }));
        this.copyBtn.on('pointerdown', () => this.copyCoordinates());

        // Botón "Descargar Plano PDF"
        this.downloadBtn = this.add.text(180, 155, '📄 DESCARGAR PLANO PDF', {
            fontFamily: 'monospace',
            fontSize: '10px',
            fill: '#34d399',
            backgroundColor: '#0f172a',
            padding: { x: 8, y: 4 }
        });
        this.downloadBtn.setScrollFactor(0);
        this.downloadBtn.setInteractive({ useHandCursor: true });
        this.downloadBtn.on('pointerover', () => this.downloadBtn.setStyle({ fill: '#6ee7b7', backgroundColor: '#1e293b' }));
        this.downloadBtn.on('pointerout', () => this.downloadBtn.setStyle({ fill: '#34d399', backgroundColor: '#0f172a' }));
        this.downloadBtn.on('pointerdown', () => this.downloadAreaPDF());
        this.createExportMenu();

        // Brújula en coordenadas de pantalla, independiente de la proyección isométrica.
        const compassFace = this.add.graphics();
        compassFace.fillStyle(0x020617, 0.55).fillCircle(0, 3, 44);
        compassFace.fillStyle(0x101e32, 0.98).fillCircle(0, 0, 43);
        compassFace.lineStyle(2, 0x7891ad, 0.9).strokeCircle(0, 0, 42);
        compassFace.lineStyle(1, 0x425975, 0.8).strokeCircle(0, 0, 37);
        for (let i = 0; i < 16; i++) {
            const angle = i * Math.PI / 8;
            const inner = i % 4 ? 34 : 32;
            compassFace.lineBetween(inner * Math.cos(angle), inner * Math.sin(angle),
                37 * Math.cos(angle), 37 * Math.sin(angle));
        }

        const cardinals = [
            { label: 'N', east: 0, north: 1 },
            { label: 'S', east: 0, north: -1 },
            { label: 'E', east: 1, north: 0 },
            { label: 'O', east: -1, north: 0 }
        ].map(({ label, east, north }) => {
            const angle = getCompassAngle(east, north);
            return this.add.text(26 * Math.cos(angle), 26 * Math.sin(angle), label, {
                fontSize: '11px',
                fill: label === 'N' ? '#fda4af' : '#d1e0ef',
                fontStyle: 'bold'
            }).setOrigin(0.5);
        });

        this.compassNeedle = this.add.graphics();
        this.compass = this.add.container(this.scale.width - 70, 70, [
            compassFace, ...cardinals, this.compassNeedle
        ]).setScrollFactor(0).setDepth(10);

        // Tooltip para nombres de lugares (POIs)
        this.tooltipText = this.add.text(this.scale.width / 2, 40, '', {
            fontFamily: 'system-ui, sans-serif',
            fontSize: '13px',
            fontStyle: 'bold',
            fill: '#ffffff',
            backgroundColor: '#0284c7',
            padding: { x: 10, y: 5 }
        });
        this.tooltipText.setOrigin(0.5, 0.5);
        this.tooltipText.setScrollFactor(0);
        this.tooltipText.setVisible(false);

        const touch = window.matchMedia('(any-pointer: coarse)');
        const layout = () => this.layoutHUD(touch.matches);
        this.scale.on('resize', layout);
        touch.addEventListener('change', layout);
        this.events.once('shutdown', () => {
            this.scale.off('resize', layout);
            touch.removeEventListener('change', layout);
            this.game.canvas.parentElement?.classList.remove('compact-hud');
        });
        layout();
    }

    layoutHUD(touch) {
        const { width, height } = this.scale;
        const compact = touch || width < 600;
        const landscape = width > height;
        const app = this.game.canvas.parentElement;
        app.classList.toggle('compact-hud', compact);
        this.hudBg.setPosition(compact ? 8 : 15, compact ? 8 : 15);
        this.hudBg.setSize(compact ? Math.min(260, width - 16) : 320, compact ? 229 : 195);
        this.hudText.setPosition(compact ? 16 : 25, compact ? 16 : 25);
        this.hudText.setLineSpacing(compact ? 1 : 3);

        for (const [button, mobileX, desktopX] of [[this.copyBtn, 16, 25], [this.downloadBtn, 123, 180]]) {
            button.setPosition(compact ? mobileX : desktopX, compact ? 136 : 155);
            button.setPadding(6, compact ? 17 : 3);
        }
        this.copyBtn.setText(compact ? 'Copiar GPS' : '📋 COPIAR COORDENADAS');
        this.downloadBtn.setText(compact ? 'Plano PDF' : '📄 DESCARGAR PLANO PDF');

        this.compass.setPosition(width - (compact ? 45 : 70), compact && width < 370 ? 280 : compact ? 45 : 70);
        this.compass.setScale(compact ? 0.8 : 1);
        this.tooltipText.setPosition(compact ? width - 12 : width / 2, compact ? height - (landscape ? 113 : 38) : 40);
        this.tooltipText.setOrigin(compact ? 1 : 0.5, 0.5);
        this.tooltipText.setWordWrapWidth(compact ? Math.min(Math.max(100, width - (landscape ? 280 : 135)), 280) : 300, true);
    }

    updateCompassNeedle(cx, cy, angle) {
        this.compassNeedle.clear();
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const left = { x: cx + dy * 5, y: cy - dx * 5 };
        const right = { x: cx - dy * 5, y: cy + dx * 5 };
        const tip = { x: cx + dx * 20, y: cy + dy * 20 };
        const tail = { x: cx - dx * 15, y: cy - dy * 15 };
        const facet = (color, end, side) => this.compassNeedle.fillStyle(color, 1)
            .fillTriangle(cx, cy, end.x, end.y, side.x, side.y);
        facet(0xfda4af, tip, left);
        facet(0xe34f6a, tip, right);
        facet(0xdbeafe, tail, left);
        facet(0x6c86a7, tail, right);
        this.compassNeedle.fillStyle(0xf8fafc, 1).fillCircle(cx, cy, 2.5);
    }

    checkNearbyPOIs() {
        if (!this.player) return;

        const playerPos = this.player.getPosition();
        let closestPOI = null;
        let minDistanceSquared = POI_RADIUS_METERS ** 2;
        const candidates = this.poiGrid?.at(playerPos.x, playerPos.y) ?? this.pois;

        for (const poi of candidates) {
            const dx = poi.x - playerPos.x;
            const dy = poi.y - playerPos.y;
            const meters = isometricToMeters(dx, dy);
            const distanceSquared = meters.x ** 2 + meters.y ** 2;

            if (distanceSquared < minDistanceSquared) {
                minDistanceSquared = distanceSquared;
                closestPOI = poi;
            }
        }

        if (closestPOI) {
            const label = `📍 ${closestPOI.name}`;
            if (this.tooltipText.text !== label) this.tooltipText.setText(label);
            this.tooltipText.setVisible(true);
        } else {
            this.tooltipText.setVisible(false);
        }
    }

    getPlayerCoordinates() {
        const { x, y } = isometricToMeters(
            this.player.x - this.worldOrigin.x,
            this.player.y - this.worldOrigin.y
        );
        const dLat = y / ProjectionConfig.EARTH_RADIUS;
        const dLon = x / (ProjectionConfig.EARTH_RADIUS * Math.cos(this.originLat * Math.PI / 180));

        return {
            lat: this.originLat + (dLat * (180 / Math.PI)),
            lon: this.originLon + (dLon * (180 / Math.PI))
        };
    }

    updateHUD(time) {
        if (this.lastCompassAngle === undefined ||
            Math.cos(this.headingAngle - this.lastCompassAngle) < 0.99999) {
            this.updateCompassNeedle(0, 0, this.headingAngle);
            this.lastCompassAngle = this.headingAngle;
        }

        const previous = this.hudSnapshot;
        if (previous && time - previous.time < HUD_INTERVAL_MS) return;

        const { x, y } = this.player;
        const agents = this.npcs.length;
        const distance = Math.round(this.totalDistanceMeters);
        const moved = !previous || x !== previous.x || y !== previous.y;
        if (!moved && agents === previous.agents && distance === previous.distance) return;

        this.hudSnapshot = { time, x, y, agents, distance };
        this.updateHUDText();
        if (moved) this.checkNearbyPOIs();
    }

    updateHUDText() {
        if (!this.player) return;
        const { lat: currentLat, lon: currentLon } = this.getPlayerCoordinates();
        const utm = computeUTM(currentLat, currentLon);
        const latDMS = decimalToDMS(currentLat, true);
        const lonDMS = decimalToDMS(currentLon, false);

        this.hudText.setText([
            `LAT/LON:  ${currentLat.toFixed(5)}°, ${currentLon.toFixed(5)}°`,
            'Coordenadas geográficas',
            `          ${latDMS}, ${lonDMS}`,
            `UTM ZONE: ${utm.zone}`,
            `EASTING:  ${utm.easting} mE`,
            `NORTHING: ${utm.northing} mN`,
            `DISTANCIA: ${Math.round(this.totalDistanceMeters)} metros`,
            `AGENTES:   ${this.npcs.length} activos`
        ]);
    }
    
    getAreaBounds() {
        return calculateBBox(this.originLat, this.originLon);
    }

    createExportMenu() {
        const dialog = document.createElement('dialog');
        dialog.className = 'geo-export-dialog';
        dialog.setAttribute('aria-labelledby', 'geo-export-heading');
        dialog.innerHTML = `
            <h2 id="geo-export-heading">Exportar datos</h2>
            <p>Datos del área de simulación en coordenadas WGS 84.</p>
            <button type="button" data-export="csv">Tabla para Excel (.csv)</button>
            <button type="button" data-export="layers">Capas GeoJSON para ArcGIS (.zip)</button>
            <button type="button" data-export="all">Paquete completo (.zip)</button>
            <p class="geo-export-status" role="status"></p>
            <form method="dialog"><button type="submit">Cerrar</button></form>`;
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'geo-export-trigger';
        trigger.textContent = '⬇ EXPORTAR DATOS';
        trigger.setAttribute('aria-haspopup', 'dialog');
        this.game.canvas.parentElement.append(trigger, dialog);
        const keyboard = this.input.keyboard;
        let keyboardEnabled;
        trigger.addEventListener('click', () => {
            this.joystick.reset();
            keyboardEnabled = keyboard?.enabled;
            if (keyboard) {
                keyboard.resetKeys?.();
                keyboard.enabled = false;
            }
            dialog.querySelector('.geo-export-status').textContent = '';
            dialog.showModal();
        });
        dialog.addEventListener('close', () => {
            if (keyboard) keyboard.enabled = keyboardEnabled;
            trigger.focus();
        });
        for (const button of dialog.querySelectorAll('[data-export]')) {
            button.addEventListener('click', () => {
                const status = dialog.querySelector('.geo-export-status');
                try {
                    this.downloadAreaData(button.dataset.export);
                    status.textContent = 'Se inició la descarga.';
                } catch (error) {
                    console.error(error);
                    status.textContent = 'No se pudo exportar el área.';
                }
            });
        }
        this.events.once('shutdown', () => {
            if (dialog.open && keyboard) keyboard.enabled = keyboardEnabled;
            dialog.remove();
            trigger.remove();
        });
    }

    downloadAreaData(format) {
        if (!this.player || !this.osmData?.elements) throw Error('El área aún no está disponible.');
        const snapshot = {
            origin: { lat: this.originLat, lon: this.originLon },
            player: this.getPlayerCoordinates(),
            bounds: this.getAreaBounds(),
            elements: this.osmData.elements
        };
        const prefix = `GeoWalker_${this.originLat.toFixed(4)}_${this.originLon.toFixed(4)}`;
        let blob;
        let name;
        if (format === 'csv') {
            blob = new Blob([exportCoordinates(snapshot)], { type: 'text/csv;charset=utf-8' });
            name = prefix + '_coordenadas.csv';
        } else {
            const includeCoordinates = format === 'all';
            const files = [...exportLayers(snapshot, tags => !!greenStyle(tags)), ['LEEME.txt', exportNote(snapshot, includeCoordinates)]];
            if (includeCoordinates) files.push(['coordenadas.csv', exportCoordinates(snapshot)]);
            blob = exportZip(files);
            name = prefix + (includeCoordinates ? '_datos.zip' : '_capas.zip');
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    async copyCoordinates() {
        if (!this.player) return;

        // Esquinas del cuadrado 1km² en grados sexagesimales (DMS)
        // Tabla TSV (separada por tabulaciones) lista para pegar en Excel y transferir a ArcGIS:
        // Punto | Coordenada X (Longitud) | Coordenada Y (Latitud)
        const bounds = this.getAreaBounds();
        const corners = [
            { name: '1 (Noreste)', lat: bounds.north, lon: bounds.east },
            { name: '2 (Noroeste)', lat: bounds.north, lon: bounds.west },
            { name: '3 (Sureste)', lat: bounds.south, lon: bounds.east },
            { name: '4 (Suroeste)', lat: bounds.south, lon: bounds.west }
        ];

        const rows = ['PUNTO\tCOORDENADA X (LONGITUD)\tCOORDENADA Y (LATITUD)'];
        corners.forEach(c => {
            const xDMS = decimalToDMS(c.lon, false); // X = Longitud
            const yDMS = decimalToDMS(c.lat, true);  // Y = Latitud
            rows.push(c.name + '\t' + xDMS + '\t' + yDMS);
        });

        const textToCopy = rows.join('\n');

        try {
            await navigator.clipboard.writeText(textToCopy);
            
            const originalText = this.copyBtn.text;
            this.copyBtn.setText('✅ COPIADO');
            this.copyBtn.setStyle({ fill: '#34d399' });
            
            setTimeout(() => {
                this.copyBtn.setText(originalText);
                this.copyBtn.setStyle({ fill: '#22d3ee' });
            }, 2000);
        } catch (err) {
            console.error('Error al copiar:', err);
            console.log(textToCopy);
            alert('No se pudo copiar automáticamente. Revisa la consola (F12) para ver las coordenadas.');
        }
    }

    generateMapImage() {
        // ── Plano SIG profesional (fondo papel, marco, graticulado, leyenda) ──
        const M = 56;                 // margen del marco cartográfico
        const mapSize = 800;            // lienzo total
        const plotSize = mapSize - 2 * M; // 688 px de área de mapa = 1000 m
        const scale = plotSize / 1000;  // px por metro

        const canvas = document.createElement('canvas');
        canvas.width = mapSize * 2;
        canvas.height = mapSize * 2;
        const ctx = canvas.getContext('2d');
        ctx.scale(2, 2);

        const toXY = (lat, lon) => {
            const m = wgs84ToMeters(lat, lon, this.originLat, this.originLon);
            return {
                x: M + plotSize / 2 + m.x * scale,
                y: M + plotSize / 2 - m.y * scale
            };
        };

        const tracePath = (pts) => {
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        };

        // ── Fondo papel ──
        ctx.fillStyle = '#fbfaf5';
        ctx.fillRect(0, 0, mapSize, mapSize);
        ctx.fillStyle = '#f0efe6';
        ctx.fillRect(M, M, plotSize, plotSize);
        ctx.save();
        ctx.beginPath();
        ctx.rect(M, M, plotSize, plotSize);
        ctx.clip();

        const nodesMap = new Map();
        if (this.osmData && this.osmData.elements) {
            this.osmData.elements.forEach(el => {
                if (el.type === 'node') nodesMap.set(el.id, { lat: el.lat, lon: el.lon, tags: el.tags });
            });
        }

        const areas = [];   // {points, fill, stroke, isBuilding}
        const roads = [];   // {points, width}
        const watercourses = [];
        if (this.osmData && this.osmData.elements) {
            const projectNode = id => {
                const node = nodesMap.get(id);
                return node ? toXY(node.lat, node.lon) : null;
            };
            const features = getBuildingFootprints(this.osmData.elements, projectNode)
                .map(footprint => ({ ...footprint, isBuilding: true }));
            features.push(...getAreaFootprints(this.osmData.elements, projectNode, isWaterArea)
                .map(footprint => ({ ...footprint, isWater: true })));
            features.push(...getAreaFootprints(this.osmData.elements, projectNode, tags => !!greenStyle(tags) || tags.landuse === 'cemetery')
                .map(footprint => ({ ...footprint, isGreen: true })));
            for (const el of this.osmData.elements) {
                if (el.type === 'way' && el.nodes && el.tags) {
                    const points = el.nodes.map(projectNode);
                    if (!points.every(Boolean)) continue;
                    features.push({ points, tags: el.tags });
                }
            }
            features.forEach(({ points: pts, holes, tags, isBuilding = false, isWater = false, isGreen = false }) => {
                if (pts.length < 2) return;

                if (!isBuilding && !isWater && isWatercourse(tags)) watercourses.push(pts);
                const isHighway = !isBuilding && !!tags.highway;

                if (pts.length >= 3 && (isGreen || isWater || isBuilding)) {
                    let fill = '#f5f5f0', stroke = '#6b7280';
                    if (isWater)      { fill = '#bfdbfe'; stroke = '#3b82f6'; }
                    else if (isBuilding) {
                        const colors = getBuildingColors(tags);
                        fill = '#' + colors.roof.toString(16).padStart(6, '0');
                        stroke = '#' + colors.wall.toString(16).padStart(6, '0');
                    } else if (isGreen) { fill = '#bbf7d0'; stroke = '#15803d'; }
                    areas.push({ points: pts, holes, fill, stroke, isBuilding, isWater });
                }

                if (isHighway) {
                    const w = (tags.highway === 'motorway' || tags.highway === 'trunk' || tags.highway === 'primary') ? 7
                            : (tags.highway === 'secondary' || tags.highway === 'tertiary') ? 5 : 3;
                    roads.push({ points: pts, width: w });
                }
            });
        }

        // ── Áreas (parques, agua, edificios) ──
        areas.sort((a, b) => (a.isBuilding * 2 + a.isWater) - (b.isBuilding * 2 + b.isWater));
        areas.forEach(a => {
            ctx.beginPath();
            for (const ring of [a.points, ...a.holes]) {
                tracePath(ring);
                ctx.closePath();
            }
            ctx.fillStyle = a.fill;
            ctx.fill('evenodd');
            ctx.strokeStyle = a.stroke;
            ctx.lineWidth = a.isBuilding ? 1 : 1.5;
            ctx.stroke();
        });

        for (const points of watercourses) {
            ctx.beginPath();
            tracePath(points);
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // ── Vías: casing oscuro + relleno claro ──
        roads.forEach(r => {
            ctx.beginPath();
            tracePath(r.points);
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = r.width + 2;
            ctx.lineJoin = 'round';
            ctx.stroke();
            ctx.beginPath();
            tracePath(r.points);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = r.width;
            ctx.stroke();
        });
        ctx.restore();

        // ── Graticulado cada 100 m con etiquetas de coordenadas ──
        ctx.strokeStyle = 'rgba(100, 116, 139, 0.30)';
        ctx.lineWidth = 1;
        ctx.font = '9px monospace';
        ctx.fillStyle = '#475569';
        const metersPerDegLat = ProjectionConfig.EARTH_RADIUS * Math.PI / 180;
        const metersPerDegLon = metersPerDegLat * Math.cos(this.originLat * Math.PI / 180);
        ctx.textAlign = 'center';
        for (let d = -500; d <= 500; d += 100) {
            const gx = M + plotSize / 2 + d * scale;
            if (gx > M && gx < M + plotSize) {
                ctx.beginPath(); ctx.moveTo(gx, M); ctx.lineTo(gx, M + plotSize); ctx.stroke();
                const lonD = this.originLon + d / metersPerDegLon;
                ctx.fillText(Math.abs(lonD).toFixed(4) + (lonD >= 0 ? 'E' : 'O'), gx, M + plotSize + 14);
            }
            const gy = M + plotSize / 2 - d * scale;
            if (gy > M && gy < M + plotSize) {
                ctx.beginPath(); ctx.moveTo(M, gy); ctx.lineTo(M + plotSize, gy); ctx.stroke();
                const latD = this.originLat + d / metersPerDegLat;
                ctx.textAlign = 'right';
                ctx.fillText(Math.abs(latD).toFixed(4) + (latD >= 0 ? 'N' : 'S'), M - 11, gy + 3);
                ctx.textAlign = 'center';
            }
        }

        // ── Origen (centro) ──
        const oc = toXY(this.originLat, this.originLon);
        ctx.fillStyle = '#dc2626';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(oc.x, oc.y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#dc2626';
        ctx.beginPath();
        ctx.moveTo(oc.x - 16, oc.y); ctx.lineTo(oc.x + 16, oc.y);
        ctx.moveTo(oc.x, oc.y - 16); ctx.lineTo(oc.x, oc.y + 16);
        ctx.stroke();
        ctx.fillStyle = '#dc2626';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        if (this.player) {
            const { x, y } = isometricToMeters(this.player.x - this.worldOrigin.x, this.player.y - this.worldOrigin.y);
            const px = oc.x + x * scale;
            const py = oc.y - y * scale;
            ctx.beginPath();
            ctx.arc(px, py, 11, 0, Math.PI * 2);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 5;
            ctx.stroke();
            ctx.strokeStyle = '#1d4ed8';
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }

        // ── Marco cartográfico doble ──
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(M - 2, M - 2, plotSize + 4, plotSize + 4);
        ctx.lineWidth = 0.75;
        ctx.strokeRect(M - 8, M - 8, plotSize + 16, plotSize + 16);

        // ── Escala gráfica (barras alternadas de 50 m) ──
        const sbX = M, sbY = mapSize - 34, segW = 50 * scale;
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        for (let i = 0; i < 4; i++) {
            ctx.fillStyle = i % 2 === 0 ? '#1e293b' : '#ffffff';
            ctx.fillRect(sbX + i * segW, sbY, segW, 8);
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 0.75;
            ctx.strokeRect(sbX + i * segW, sbY, segW, 8);
            ctx.fillStyle = '#1e293b';
            ctx.fillText(String(i * 50), sbX + i * segW, sbY + 20);
        }
        ctx.fillText('200 m', sbX + 4 * segW, sbY + 20);
        ctx.textAlign = 'left';
        ctx.fillText('Barra de escala en metros - Cuadricula cada 100 m', sbX, sbY - 8);

        // ── Flecha Norte ──
        const nx = mapSize - 40, ny = 46;
        ctx.fillStyle = '#dc2626';
        ctx.beginPath();
        ctx.moveTo(nx, ny - 18); ctx.lineTo(nx - 8, ny + 8); ctx.lineTo(nx, ny + 2); ctx.lineTo(nx + 8, ny + 8);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('N', nx, ny + 24);

        return canvas.toDataURL('image/png');
    }

    downloadAreaPDF() {
        if (!this.player || !this.osmData) return;
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const ink = '#102b35';
        const muted = '#405660';
        const accent = '#246b63';
        const border = '#cddad9';
        const panel = '#f1f6f5';
        const left = 12;
        const right = 285;
        const sidebar = 184;
        const date = new Intl.DateTimeFormat('es-BO', {
            dateStyle: 'long', timeZone: 'America/La_Paz'
        }).format(new Date());

        function write(value, x, y, { size = 10, color = ink, bold = false, align = 'left' } = {}) {
            doc.setFont('helvetica', bold ? 'bold' : 'normal');
            doc.setFontSize(size);
            doc.setTextColor(color);
            doc.text(value, x, y, { align });
        }
        function rule(y) {
            doc.setDrawColor(border);
            doc.setLineWidth(0.3);
            doc.line(left, y, right, y);
        }
        function header(title, subtitle, page) {
            write('GEOWALKER', left, 12, { size: 8, bold: true, color: accent });
            write(title, left, 22, { size: 20, bold: true });
            write(subtitle, right, 22, { size: 9, color: muted, align: 'right' });
            rule(28);
            rule(197);
            write('Datos © colaboradores de OpenStreetMap · openstreetmap.org/copyright', left, 203, { size: 8, color: muted });
            write(`Página ${page} de 2`, right, 203, { size: 8, color: muted, align: 'right' });
        }

        header('Plano del área de simulación', 'Vista en planta · 1 km²', 1);
        doc.setDrawColor(border);
        doc.rect(left, 32, 162, 162);
        doc.addImage(this.generateMapImage(), 'PNG', left, 32, 162, 162);

        const utm = computeUTM(this.originLat, this.originLon);
        write('Ficha técnica', sidebar, 40, { size: 14, bold: true });
        write('Área y proyección del plano', sidebar, 49, { bold: true, color: accent });
        write('1 km² · 500 m desde el centro por eje', sidebar, 55);
        write('Proyección métrica local · cuadrícula de 100 m', sidebar, 61);
        write('Centro del área · WGS 84', sidebar, 72, { bold: true, color: accent });
        write(`Latitud ${this.originLat.toFixed(6)}°  ·  Longitud ${this.originLon.toFixed(6)}°`, sidebar, 78);
        write(`${decimalToDMS(this.originLat, true)}  ·  ${decimalToDMS(this.originLon, false)}`, sidebar, 84);
        write(`UTM orientativa · zona ${utm.zone}`, sidebar, 90);
        write(`Fecha de generación · ${date}`, sidebar, 99);

        write('Leyenda', sidebar, 115, { size: 14, bold: true });
        const legend = [
            ['#dc2626', 'Centro del área', 'dot'],
            ['#1d4ed8', 'Posición del jugador al exportar', 'ring'],
            ['#1e293b', 'Límite del área de simulación', 'line'],
            ['#718096', 'Edificios · color según uso', 'square'],
            ['#bbf7d0', 'Parques y áreas verdes', 'square'],
            ['#bfdbfe', 'Cuerpos de agua', 'square'],
            ['#475569', 'Vías', 'line'],
        ];
        legend.forEach(([color, label, symbol], i) => {
            const y = 124 + i * 8;
            doc.setFillColor(color);
            doc.setDrawColor(color);
            doc.setLineWidth(0.55);
            if (symbol === 'dot' || symbol === 'ring') doc.circle(sidebar + 2.5, y - 1, 1.5, symbol === 'dot' ? 'F' : 'S');
            else if (symbol === 'line') doc.line(sidebar, y - 1, sidebar + 5, y - 1);
            else doc.rect(sidebar, y - 2.7, 5, 3.4, 'F');
            write(label, sidebar + 9, y);
        });
        write('Plano de simulación para consulta académica.', sidebar, 184, { size: 8, color: muted });

        doc.addPage();
        header('Anexo del área de simulación', 'Coordenadas y datos de OpenStreetMap', 2);
        write('Esquinas del área de 1 km²', left, 40, { size: 14, bold: true });
        write('Latitud y longitud en grados decimales (WGS 84). UTM de referencia mediante aproximación local.', left, 47, { size: 9, color: muted });
        const { north, south, east, west } = this.getAreaBounds();
        const corners = [
            ['Noroeste (NO)', north, west],
            ['Noreste (NE)', north, east],
            ['Sureste (SE)', south, east],
            ['Suroeste (SO)', south, west],
        ];
        const columns = [17, 68, 111, 154, 185, 233];
        const row = (values, y, heading = false) => {
            values.forEach((value, i) => write(String(value), columns[i], y, { size: 10, bold: heading }));
        };
        doc.setFillColor(panel);
        doc.rect(left, 52, right - left, 10, 'F');
        row(['Esquina', 'Latitud', 'Longitud', 'Zona UTM', 'Este (m)', 'Norte (m)'], 58.5, true);
        corners.forEach(([name, lat, lon], i) => {
            const { zone, easting, northing } = computeUTM(lat, lon);
            const y = 62 + i * 10;
            if (i % 2) {
                doc.setFillColor(panel);
                doc.rect(left, y, right - left, 10, 'F');
            }
            row([name, lat.toFixed(6) + '°', lon.toFixed(6) + '°', zone, easting, northing], y + 6.5);
        });
        rule(102);

        write('Datos descargados de OpenStreetMap', left, 115, { size: 14, bold: true });
        const elements = this.osmData.elements;
        const count = predicate => elements.reduce((total, element) => total + Number(!!predicate(element)), 0);
        const isArea = el => el.type === 'way' || el.type === 'relation';
        const stats = [
            ['Edificios', count(el => isArea(el) && el.tags?.building && el.tags.building !== 'no')],
            ['Vías', count(el => el.type === 'way' && el.tags?.highway)],
            ['Áreas verdes', count(el => isArea(el) && el.tags && greenStyle(el.tags))],
            ['Cuerpos de agua', count(el => isArea(el) && el.tags && isWaterArea(el.tags))],
            ['Puntos de interés', count(el => el.type === 'node' && el.tags?.name && (el.tags.amenity || el.tags.shop))],
            ['Árboles', count(el => el.type === 'node' && el.tags?.natural === 'tree')],
            ['Total de elementos OSM', elements.length],
        ];
        stats.forEach(([label, total], i) => {
            const x = left + (i % 4) * 69;
            const y = 121 + Math.floor(i / 4) * 24;
            doc.setFillColor(panel);
            doc.roundedRect(x, y, 66, 20, 2, 2, 'F');
            write(label, x + 4, y + 7, { size: 9, color: muted });
            write(String(total), x + 4, y + 15, { size: 14, bold: true });
        });
        write('La consulta puede incluir elementos OSM que se extienden más allá del límite dibujado.', left, 177, { size: 9, color: muted });

        const fileName = `GeoWalker_Plano_${this.originLat.toFixed(4)}_${this.originLon.toFixed(4)}_${Date.now()}.pdf`;
        doc.save(fileName);
        const originalText = this.downloadBtn.text;
        this.downloadBtn.setText('✅ PDF GENERADO');
        this.downloadBtn.setStyle({ fill: '#34d399' });
        setTimeout(() => {
            this.downloadBtn.setText(originalText);
            this.downloadBtn.setStyle({ fill: '#34d399' });
        }, 2000);
    }

}

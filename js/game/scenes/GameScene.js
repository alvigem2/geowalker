import { Player } from '../entities/Player.js';
import { wgs84ToMeters, metersToPixels, toIsometric, computeUTM, decimalToDMS } from '../../gis/projections.js';

export class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
        this.osmData = null;
        this.originLat = 0;
        this.originLon = 0;
        this.buildingsColliders = [];
        this.roadsNetwork = [];
        this.vehicleRoads = [];
        this.npcs = [];
        this.pois = [];
        this.hudText = null;
        this.compassNeedle = null;
        this.tooltipText = null;
        this.totalDistanceMeters = 0;
        this.copyBtn = null;
        this.downloadBtn = null;
    }

    init(data) {
        this.osmData = data && data.osmData ? data.osmData : (this.game.initialOSMData ? this.game.initialOSMData.osmData : null);
        this.originLat = data && data.originLat ? data.originLat : (this.game.initialOSMData ? this.game.initialOSMData.originLat : 0);
        this.originLon = data && data.originLon ? data.originLon : (this.game.initialOSMData ? this.game.initialOSMData.originLon : 0);
        
        this.buildingsColliders = [];
        this.roadsNetwork = [];
        this.vehicleRoads = [];
        this.npcs = [];
        this.pois = [];
        this.totalDistanceMeters = 0;
    }

    create() {
        const { width, height } = this.scale;
        
        this.cameras.main.setBackgroundColor('#0f172a');

        this.vectorGraphics = this.add.graphics();
        this.treesGraphics = this.add.graphics();

        this.renderOSMVectorData();

        this.player = new Player(this, width / 2, height / 2);
        // Si el spawn cae dentro de un edificio, reposicionar en la calle más cercana
        this.snapPlayerToRoad();
        this.spawnTrafficAgents();

        this.cameras.main.startFollow(this.player.sprite, true, 0.08, 0.08);
        this.createHUD();
    }

    update(time, delta) {
        if (this.player) {
            const { width, height } = this.scale;
            const prevX = this.player.x;
            const prevY = this.player.y;

            this.player.update(time, delta, this.buildingsColliders, width, height);

            const dx = this.player.x - prevX;
            const dy = this.player.y - prevY;
            const stepPixels = Math.sqrt(dx * dx + dy * dy);
            this.totalDistanceMeters += stepPixels / 4;

            this.updateNPCs(delta);
            this.updateHUDText();
            this.checkNearbyPOIs();
        }
    }

    renderOSMVectorData() {
        if (!this.osmData || !this.osmData.elements) return;

        const nodesMap = new Map();
        this.osmData.elements.forEach(el => {
            if (el.type === 'node') {
                nodesMap.set(el.id, { lat: el.lat, lon: el.lon, tags: el.tags });
            }
        });

        this.vectorGraphics.clear();
        this.treesGraphics.clear();
        this.buildingsColliders = [];
        this.roadsNetwork = [];
        this.vehicleRoads = [];
        this.pois = [];

        // 1. Renderizar Parques, Áreas Verdes y Agua
        this.osmData.elements.forEach(el => {
            if (el.type === 'way' && el.nodes) {
                const points = [];
                let isPark = false;
                let isWater = false;

                if (el.tags) {
                    if (el.tags.leisure === 'park' || el.tags.landuse === 'grass') isPark = true;
                    if (el.tags.waterway || el.tags.natural === 'water') isWater = true;
                }

                if (isPark || isWater) {
                    for (const nodeId of el.nodes) {
                        const node = nodesMap.get(nodeId);
                        if (node) {
                            const m = wgs84ToMeters(node.lat, node.lon, this.originLat, this.originLon);
                            const p = metersToPixels(m.x, m.y);
                            const iso = toIsometric(p.px, p.py);
                            points.push({ x: iso.isoX + this.scale.width / 2, y: iso.isoY + this.scale.height / 2 });
                        }
                    }

                    if (points.length >= 3) {
                        this.vectorGraphics.fillStyle(isWater ? 0x0284c7 : 0x166534, isWater ? 0.8 : 0.5);
                        this.vectorGraphics.beginPath();
                        this.vectorGraphics.moveTo(points[0].x, points[0].y);
                        for (let i = 1; i < points.length; i++) {
                            this.vectorGraphics.lineTo(points[i].x, points[i].y);
                        }
                        this.vectorGraphics.closePath();
                        this.vectorGraphics.fillPath();
                    }
                }
            }
        });

        // 2. Renderizar Vías / Calles
        this.osmData.elements.forEach(el => {
            if (el.type === 'way' && el.nodes) {
                const points = [];
                let isHighway = false;
                let highwayType = '';
                let placeName = null;

                if (el.tags) {
                    if (el.tags.highway) {
                        isHighway = true;
                        highwayType = el.tags.highway;
                    }
                    if (el.tags.name) placeName = el.tags.name;
                }

                for (const nodeId of el.nodes) {
                    const node = nodesMap.get(nodeId);
                    if (node) {
                        const m = wgs84ToMeters(node.lat, node.lon, this.originLat, this.originLon);
                        const p = metersToPixels(m.x, m.y);
                        const iso = toIsometric(p.px, p.py);
                        points.push({ x: iso.isoX + this.scale.width / 2, y: iso.isoY + this.scale.height / 2 });
                    }
                }

                if (points.length < 2) return;

                if (placeName) {
                    let cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
                    let cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
                    this.pois.push({ name: placeName, x: cx, y: cy });
                }

                if (isHighway) {
                    this.roadsNetwork.push(points);
                    const pedestrianOnly = ['pedestrian', 'footway', 'path', 'steps'];
                    if (!pedestrianOnly.includes(highwayType)) {
                        this.vehicleRoads.push(points);
                    }

                    this.vectorGraphics.lineStyle(5, 0x1e293b, 1);
                    this.vectorGraphics.beginPath();
                    this.vectorGraphics.moveTo(points[0].x, points[0].y);
                    for (let i = 1; i < points.length; i++) {
                        this.vectorGraphics.lineTo(points[i].x, points[i].y);
                    }
                    this.vectorGraphics.strokePath();
                }
            }
        });

        // 3. Renderizar Edificios con Extrusión 2.5D y Estilos Semánticos
        this.osmData.elements.forEach(el => {
            if (el.type === 'way' && el.nodes) {
                const points = [];
                let isBuilding = false;
                let isChurch = false;
                let isBank = false;
                let levels = 1;

                if (el.tags && el.tags.building) {
                    isBuilding = true;
                    if (el.tags.amenity === 'place_of_worship' || el.tags.building === 'church') isChurch = true;
                    if (el.tags.amenity === 'bank') isBank = true;

                    if (el.tags['building:levels']) {
                        levels = parseInt(el.tags['building:levels']) || 1;
                    } else {
                        const rand = Math.random();
                        levels = rand < 0.6 ? 1 : (rand < 0.85 ? 2 : 3);
                    }
                }

                if (!isBuilding) return;

                for (const nodeId of el.nodes) {
                    const node = nodesMap.get(nodeId);
                    if (node) {
                        const m = wgs84ToMeters(node.lat, node.lon, this.originLat, this.originLon);
                        const p = metersToPixels(m.x, m.y);
                        const iso = toIsometric(p.px, p.py);
                        points.push({ x: iso.isoX + this.scale.width / 2, y: iso.isoY + this.scale.height / 2 });
                    }
                }

                if (points.length < 3) return;

                let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                points.forEach(p => {
                    if (p.x < minX) minX = p.x;
                    if (p.x > maxX) maxX = p.x;
                    if (p.y < minY) minY = p.y;
                    if (p.y > maxY) maxY = p.y;
                });

                this.buildingsColliders.push({ points: points, bounds: { minX, maxX, minY, maxY } });

                const extrusionHeight = levels * 6;
                let wallColor = 0x334155;
                let roofColor = 0x475569;
                if (isChurch) { wallColor = 0x78350f; roofColor = 0x92400e; }
                else if (isBank) { wallColor = 0x1e3a8a; roofColor = 0x1d4ed8; }

                for (let i = 0; i < points.length; i++) {
                    const p1 = points[i];
                    const p2 = points[(i + 1) % points.length];
                    
                    this.vectorGraphics.fillStyle(wallColor, 0.95);
                    this.vectorGraphics.beginPath();
                    this.vectorGraphics.moveTo(p1.x, p1.y);
                    this.vectorGraphics.lineTo(p2.x, p2.y);
                    this.vectorGraphics.lineTo(p2.x, p2.y - extrusionHeight);
                    this.vectorGraphics.lineTo(p1.x, p1.y - extrusionHeight);
                    this.vectorGraphics.closePath();
                    this.vectorGraphics.fillPath();
                }

                const roofPoints = points.map(p => ({ x: p.x, y: p.y - extrusionHeight }));
                this.vectorGraphics.fillStyle(roofColor, 1);
                this.vectorGraphics.lineStyle(1, 0x94a3b8, 0.8);
                this.vectorGraphics.beginPath();
                this.vectorGraphics.moveTo(roofPoints[0].x, roofPoints[0].y);
                for (let i = 1; i < roofPoints.length; i++) {
                    this.vectorGraphics.lineTo(roofPoints[i].x, roofPoints[i].y);
                }
                this.vectorGraphics.closePath();
                this.vectorGraphics.fillPath();
                this.vectorGraphics.strokePath();
            }
        });

        // 4. Renderizar Árboles
        nodesMap.forEach((node) => {
            if (node.tags && node.tags.natural === 'tree') {
                const m = wgs84ToMeters(node.lat, node.lon, this.originLat, this.originLon);
                const p = metersToPixels(m.x, m.y);
                const iso = toIsometric(p.px, p.py);
                const tx = iso.isoX + this.scale.width / 2;
                const ty = iso.isoY + this.scale.height / 2;

                this.treesGraphics.fillStyle(0x15803d, 1);
                this.treesGraphics.fillCircle(tx, ty - 6, 4);
                this.treesGraphics.fillStyle(0x78350f, 1);
                this.treesGraphics.fillRect(tx - 1, ty - 2, 2, 3);
            }
        });
    }

    /**
     * Si el punto de spawn cae dentro de un edificio (colisiona), reposiciona
     * al jugador en el punto más cercano de la red de calles para que pueda moverse.
     */
    snapPlayerToRoad() {
        if (!this.player) return;

        const playerRadius = 8;
        const testPoint = { x: this.player.x, y: this.player.y - playerRadius };

        let insideBuilding = false;
        for (const building of this.buildingsColliders) {
            if (!building.bounds) continue;
            if (
                testPoint.x >= building.bounds.minX - playerRadius &&
                testPoint.x <= building.bounds.maxX + playerRadius &&
                testPoint.y >= building.bounds.minY - playerRadius &&
                testPoint.y <= building.bounds.maxY + playerRadius
            ) {
                if (this.player.isPointInPolygon(testPoint, building.points)) {
                    insideBuilding = true;
                    break;
                }
            }
        }

        if (!insideBuilding) return;

        // Buscar el punto más cercano sobre los segmentos de la red de calles
        let best = null;
        let bestDist = Infinity;
        for (const road of this.roadsNetwork) {
            for (let i = 0; i < road.length - 1; i++) {
                const proj = this.projectPointOnSegment(testPoint, road[i], road[i + 1]);
                const dx = proj.x - this.player.x;
                const dy = proj.y - this.player.y;
                const dist = dx * dx + dy * dy;
                if (dist < bestDist) {
                    bestDist = dist;
                    best = proj;
                }
            }
        }

        if (best) {
            this.player.x = best.x;
            this.player.y = best.y;
            this.player.sprite.x = best.x;
            this.player.sprite.y = best.y;
            this.player.head.x = best.x;
            this.player.head.y = best.y - 18;
            console.info('[GeoWalker] Spawn dentro de edificio: reposicionado a la calle más cercana.');
        } else {
            console.warn('[GeoWalker] Spawn dentro de edificio y sin calles cercanas para reposicionar.');
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
            
            const startPoint = randomRoad[0];
            // Usar sprite de vehículo real (car o truck aleatorio)
            const vehicleType = Math.random() < 0.7 ? 'spr_vehicle_car' : 'spr_vehicle_truck';
            const npcSprite = this.add.image(startPoint.x, startPoint.y, vehicleType);
            npcSprite.setOrigin(0.5, 0.8);
            npcSprite.setScale(0.5); // Ajustar escala según tus sprites

            this.npcs.push({
                sprite: npcSprite,
                road: randomRoad,
                currentIndex: 0,
                speed: 60 + Math.random() * 30,
                type: 'vehicle'
            });
        }
    }

    spawnPedestrians() {
        // Peatones usan TODAS las vías (roadsNetwork incluye peatonales, footway, path, etc.)
        if (this.roadsNetwork.length === 0) return;

        for (let i = 0; i < 50; i++) {
            const randomRoad = this.roadsNetwork[Math.floor(Math.random() * this.roadsNetwork.length)];
            if (!randomRoad || randomRoad.length === 0) continue;
            
            const startPoint = randomRoad[0];
            // Usar sprite de peatón real
            const pedType = Math.random() < 0.5 ? 'spr_pedestrian_1' : 'spr_pedestrian_2';
            const npcSprite = this.add.image(startPoint.x, startPoint.y, pedType);
            npcSprite.setOrigin(0.5, 0.8);
            npcSprite.setScale(0.5); // Ajustar escala según tus sprites

            this.npcs.push({
                sprite: npcSprite,
                road: randomRoad,
                currentIndex: 0,
                speed: 25 + Math.random() * 15, // Más lento que vehículos
                type: 'pedestrian'
            });
        }
    }

    updateNPCs(delta) {
        const deltaSec = delta / 1000;
        for (const npc of this.npcs) {
            const targetNode = npc.road[npc.currentIndex + 1];
            if (!targetNode) {
                npc.currentIndex = 0;
                continue;
            }
            const dx = targetNode.x - npc.sprite.x;
            const dy = targetNode.y - npc.sprite.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 5) {
                npc.currentIndex++;
            } else {
                // Peatones se mueven más lento y con dirección más "enfocada"
                // Vehículos pueden tener velocidad variable
                npc.sprite.x += (dx / dist) * npc.speed * deltaSec;
                npc.sprite.y += (dy / dist) * npc.speed * deltaSec;
            }
        }
    }

    createHUD() {
        // Cuadro de telemetría HUD
        const hudBg = this.add.rectangle(15, 15, 320, 180, 0x0f172a, 0.85);
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

        // Brújula circular
        const compassX = this.scale.width - 70;
        const compassY = 70;

        const compassBg = this.add.circle(compassX, compassY, 35, 0x0f172a, 0.85);
        compassBg.setScrollFactor(0);
        compassBg.setStrokeStyle(2, 0x334155);

        this.add.text(compassX, compassY - 24, 'N', { fontSize: '10px', fill: '#ef4444', fontStyle: 'bold' }).setOrigin(0.5).setScrollFactor(0);
        this.add.text(compassX, compassY + 24, 'S', { fontSize: '10px', fill: '#94a3b8' }).setOrigin(0.5).setScrollFactor(0);
        this.add.text(compassX + 24, compassY, 'E', { fontSize: '10px', fill: '#94a3b8' }).setOrigin(0.5).setScrollFactor(0);
        this.add.text(compassX - 24, compassY, 'O', { fontSize: '10px', fill: '#94a3b8' }).setOrigin(0.5).setScrollFactor(0);

        this.compassNeedle = this.add.graphics();
        this.compassNeedle.setScrollFactor(0);

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
    }

    updateCompassNeedle(cx, cy, angle) {
        this.compassNeedle.clear();
        const tipX = cx + Math.cos(angle) * 18;
        const tipY = cy + Math.sin(angle) * 18;
        const tailX = cx - Math.cos(angle) * 18;
        const tailY = cy - Math.sin(angle) * 18;

        this.compassNeedle.lineStyle(2, 0xef4444, 1);
        this.compassNeedle.beginPath();
        this.compassNeedle.moveTo(cx, cy);
        this.compassNeedle.lineTo(tipX, tipY);
        this.compassNeedle.strokePath();

        this.compassNeedle.lineStyle(2, 0x94a3b8, 1);
        this.compassNeedle.beginPath();
        this.compassNeedle.moveTo(cx, cy);
        this.compassNeedle.lineTo(tailX, tailY);
        this.compassNeedle.strokePath();
    }

    checkNearbyPOIs() {
        if (!this.player || this.pois.length === 0) return;

        const playerPos = this.player.getPosition();
        let closestPOI = null;
        let minDistancePixels = 40 * 4;

        for (const poi of this.pois) {
            const dx = poi.x - playerPos.x;
            const dy = poi.y - playerPos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < minDistancePixels) {
                minDistancePixels = dist;
                closestPOI = poi;
            }
        }

        if (closestPOI) {
            this.tooltipText.setText(`📍 ${closestPOI.name}`);
            this.tooltipText.setVisible(true);
        } else {
            this.tooltipText.setVisible(false);
        }
    }

    updateHUDText() {
        if (!this.player) return;
        const isoX = this.player.x - this.scale.width / 2;
        const isoY = this.player.y - this.scale.height / 2;
        const px = isoX / 2 + isoY;
        const py = isoY - isoX / 2;

        const metersX = px / 4;
        const metersY = -py / 4;

        const dLat = metersY / 6378137;
        const dLon = metersX / (6378137 * Math.cos(this.originLat * Math.PI / 180));

        const currentLat = this.originLat + (dLat * (180 / Math.PI));
        const currentLon = this.originLon + (dLon * (180 / Math.PI));
        const utm = computeUTM(currentLat, currentLon);
        const latDMS = decimalToDMS(currentLat, true);
        const lonDMS = decimalToDMS(currentLon, false);

        // Detectar dirección de movimiento para la brújula
        let moveAngle = -Math.PI / 4;
        let isMoving = false;

        const up = this.player.cursors.up.isDown || this.player.keys.W.isDown;
        const down = this.player.cursors.down.isDown || this.player.keys.S.isDown;
        const left = this.player.cursors.left.isDown || this.player.keys.A.isDown;
        const right = this.player.cursors.right.isDown || this.player.keys.D.isDown;

        if (up && left) { moveAngle = -Math.PI / 2; isMoving = true; }
        else if (up && right) { moveAngle = 0; isMoving = true; }
        else if (down && left) { moveAngle = Math.PI; isMoving = true; }
        else if (down && right) { moveAngle = Math.PI / 2; isMoving = true; }
        else if (up) { moveAngle = -3 * Math.PI / 4; isMoving = true; }
        else if (down) { moveAngle = Math.PI / 4; isMoving = true; }
        else if (left) { moveAngle = -3 * Math.PI / 4; isMoving = true; }
        else if (right) { moveAngle = -Math.PI / 4; isMoving = true; }

        const compassX = this.scale.width - 70;
        const compassY = 70;
        this.updateCompassNeedle(compassX, compassY, isMoving ? moveAngle : -Math.PI / 4);

        this.hudText.setText([
            `LAT/LON:  ${currentLat.toFixed(5)}°, ${currentLon.toFixed(5)}°`,
            `DMS:      ${latDMS}, ${lonDMS}`,
            `UTM ZONE: ${utm.zone}`,
            `EASTING:  ${utm.easting} mE`,
            `NORTHING: ${utm.northing} mN`,
            `DISTANCIA: ${Math.round(this.totalDistanceMeters)} metros`,
            `AGENTES:   ${this.npcs.length} activos`
        ]);
    }
    
    getAreaBounds() {
        const metersPerDegreeLat = 111320;
        const dLatDeg = 500 / metersPerDegreeLat;
        const dLonDeg = 500 / (metersPerDegreeLat * Math.cos(this.originLat * Math.PI / 180));

        return {
            north: this.originLat + dLatDeg,
            south: this.originLat - dLatDeg,
            east: this.originLon + dLonDeg,
            west: this.originLon - dLonDeg
        };
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
        const canvas = document.createElement('canvas');
        const mapSize = 800;
        canvas.width = mapSize;
        canvas.height = mapSize;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#1a2f1a';
        ctx.fillRect(0, 0, mapSize, mapSize);

        const scale = mapSize / 1000;

        const latLonToCanvas = (lat, lon) => {
            const m = wgs84ToMeters(lat, lon, this.originLat, this.originLon);
            return {
                x: mapSize / 2 + m.x * scale,
                y: mapSize / 2 - m.y * scale
            };
        };

        const nodesMap = new Map();
        if (this.osmData && this.osmData.elements) {
            this.osmData.elements.forEach(el => {
                if (el.type === 'node') {
                    nodesMap.set(el.id, { lat: el.lat, lon: el.lon, tags: el.tags });
                }
            });
        }

        const areasToDraw = [];
        const linesToDraw = [];

        if (this.osmData && this.osmData.elements) {
            this.osmData.elements.forEach(el => {
                if (el.type !== 'way' || !el.nodes || !el.tags) return;
                const tags = el.tags;
                const canvasPoints = [];
                for (const nodeId of el.nodes) {
                    const node = nodesMap.get(nodeId);
                    if (node) canvasPoints.push(latLonToCanvas(node.lat, node.lon));
                }
                if (canvasPoints.length < 2) return;

                const isPark = tags.leisure === 'park' || tags.landuse === 'grass';
                const isWater = tags.waterway || tags.natural === 'water';
                const isBuilding = !!tags.building;
                const isHighway = !!tags.highway;

                if (canvasPoints.length >= 3 && (isPark || isWater || isBuilding)) {
                    let fillColor = '#9ca3af';
                    if (isWater) fillColor = '#3b82f6';
                    else if (isPark) fillColor = '#22c55e';
                    else if (isBuilding) {
                        if (tags.amenity === 'place_of_worship' || tags.building === 'church') fillColor = '#d97706';
                        else if (tags.amenity === 'bank') fillColor = '#1e40af';
                        else if (tags.amenity === 'restaurant' || tags.amenity === 'cafe' || tags.amenity === 'fast_food') fillColor = '#dc2626';
                    }
                    areasToDraw.push({ points: canvasPoints, fillColor, isBuilding });
                }

                if (isHighway) {
                    const width = (tags.highway === 'motorway' || tags.highway === 'trunk') ? 5 : 3;
                    linesToDraw.push({ points: canvasPoints, width });
                }
            });
        }

        // Dibujar áreas
        areasToDraw.forEach(area => {
            ctx.beginPath();
            ctx.moveTo(area.points[0].x, area.points[0].y);
            for (let i = 1; i < area.points.length; i++) {
                ctx.lineTo(area.points[i].x, area.points[i].y);
            }
            ctx.closePath();
            ctx.fillStyle = area.fillColor;
            ctx.fill();
            if (area.isBuilding) {
                ctx.strokeStyle = '#4b5563';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        });

        // Dibujar vías
        linesToDraw.forEach(line => {
            ctx.beginPath();
            ctx.moveTo(line.points[0].x, line.points[0].y);
            for (let i = 1; i < line.points.length; i++) {
                ctx.lineTo(line.points[i].x, line.points[i].y);
            }
            ctx.strokeStyle = '#374151';
            ctx.lineWidth = line.width;
            ctx.stroke();
            ctx.strokeStyle = '#9ca3af';
            ctx.lineWidth = 1;
            ctx.stroke();
        });

        // Cuadrícula GIS cada 100m
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        const gridStep = 100 * scale;
        for (let x = mapSize / 2; x < mapSize; x += gridStep) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, mapSize); ctx.stroke();
        }
        for (let x = mapSize / 2; x > 0; x -= gridStep) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, mapSize); ctx.stroke();
        }
        for (let y = mapSize / 2; y < mapSize; y += gridStep) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(mapSize, y); ctx.stroke();
        }
        for (let y = mapSize / 2; y > 0; y -= gridStep) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(mapSize, y); ctx.stroke();
        }

        // Origen centro
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(mapSize / 2, mapSize / 2, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('ORIGEN', mapSize / 2, mapSize / 2 - 12);

        // Escala gráfica
        ctx.fillStyle = '#ffffff';
        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        const barX = 20, barY = mapSize - 40, barW = 200 * scale;
        ctx.fillRect(barX, barY, barW, 6);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, barY, barW, 6);
        ctx.fillText('0', barX, barY + 18);
        ctx.fillText('200m', barX + barW - 20, barY + 18);
        ctx.fillText('Escala gráfica - 1km²', barX, barY - 6);

        // Norte
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 16px monospace';
        ctx.textAlign = 'right';
        ctx.fillText('N ^', mapSize - 20, 30);

        // Título
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 16px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('PLANO GIS - GeoWalker 1km²', 20, 30);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px monospace';
        ctx.fillText(`Centro: ${this.originLat.toFixed(5)} ${this.originLon.toFixed(5)}`, 20, 48);

        return canvas.toDataURL('image/png');
    }

    downloadAreaPDF() {
        if (!this.player || !this.osmData) return;
        const { jsPDF } = window.jspdf;
        const mapImage = this.generateMapImage();
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        doc.setFont('helvetica');
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, 297, 210, 'F');
        
        doc.setTextColor(56, 189, 248);
        doc.setFontSize(24);
        doc.setFont('helvetica', 'bold');
        doc.text('GeoWalker - Plano de Área SIM', 20, 30);
        
        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(203, 213, 225);
        doc.text('Simulador Web GIS 2.5D - Datos OpenStreetMap', 20, 40);
        
        doc.setDrawColor(56, 189, 248);
        doc.setLineWidth(0.5);
        doc.line(20, 45, 277, 45);
        
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('INFORMACIÓN DEL ÁREA DE SIMULACIÓN', 20, 58);
        
        doc.setFont('helvetica', 'normal');
        const info = [
            `Fecha de generación: ${new Date().toLocaleString()}`,
            `Centro del área (Origen): ${this.originLat.toFixed(6)}°, ${this.originLon.toFixed(6)}°`,
            `Área total: 1 km² (radio 500m)`,
            `Límites: ±500m Norte/Sur/Este/Oeste desde el origen`,
        ];
        
        info.forEach((line, i) => {
            doc.text(line, 20, 68 + i * 7);
        });
        
        // Insertar el mapa real (vista top-down) en el PDF - formato cuadrado 1:1
        doc.addImage(mapImage, 'PNG', 98.5, 95, 100, 100);

        // Segunda página: Estadísticas OSM + Límites geográficos
        doc.addPage();
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, 297, 210, 'F');

        // Estadísticas OSM
        const stats = { buildings: 0, roads: 0, parks: 0, water: 0, pois: 0, trees: 0 };
        if (this.osmData && this.osmData.elements) {
            this.osmData.elements.forEach(el => {
                if (el.tags) {
                    if (el.tags.building) stats.buildings++;
                    else if (el.tags.highway) stats.roads++;
                    else if (el.tags.leisure === 'park' || el.tags.landuse === 'grass') stats.parks++;
                    else if (el.tags.waterway || el.tags.natural === 'water') stats.water++;
                    else if (el.tags.name && !el.tags.highway && !el.tags.building) stats.pois++;
                    else if (el.tags.natural === 'tree') stats.trees++;
                }
            });
        }

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(56, 189, 248);
        doc.setFontSize(18);
        doc.text('ESTADÍSTICAS DE DATOS OSM', 20, 25);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(203, 213, 225);
        doc.setFontSize(11);
        const statsLines = [
            `Edificios: ${stats.buildings}`,
            `Vías/Carreteras: ${stats.roads}`,
            `Parques/Áreas verdes: ${stats.parks}`,
            `Cuerpos de agua: ${stats.water}`,
            `Puntos de interés (POIs): ${stats.pois}`,
            `Árboles: ${stats.trees}`,
            `Total elementos OSM: ${this.osmData.elements.length}`
        ];

        statsLines.forEach((line, i) => {
            doc.text(line, 20, 40 + i * 7);
        });

        // Límites geográficos
        doc.setTextColor(56, 189, 248);
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.text('LÍMITES GEOGRÁFICOS DEL ÁREA (1km²)', 20, 100);
        
        const bounds = this.getAreaBounds();
        
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        
        const boundsInfo = [
            `Norte (Lat): ${bounds.north.toFixed(6)}°`,
            `Sur (Lat):  ${bounds.south.toFixed(6)}°`,
            `Este (Lon):  ${bounds.east.toFixed(6)}°`,
            `Oeste (Lon): ${bounds.west.toFixed(6)}°`,
            '',
            `Centro: ${this.originLat.toFixed(6)}°, ${this.originLon.toFixed(6)}°`,
            `Radio: 500 metros`,
            `Superficie: 1,000,000 m² (1 km²)`
        ];
        
        boundsInfo.forEach((line, i) => {
            doc.text(line, 20, 115 + i * 6);
        });
        
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(56, 189, 248);
        doc.text('ESQUINAS DEL RECTÁNGULO DE SIMULACIÓN', 20, 170);
        
        const corners = [
            { name: 'Noreste (NE)', lat: bounds.north, lon: bounds.east },
            { name: 'Noroeste (NO)', lat: bounds.north, lon: bounds.west },
            { name: 'Sureste (SE)', lat: bounds.south, lon: bounds.east },
            { name: 'Suroeste (SO)', lat: bounds.south, lon: bounds.west }
        ];
        
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(203, 213, 225);
        corners.forEach((corner, i) => {
            const utmCorner = computeUTM(corner.lat, corner.lon);
            doc.text(
                `${corner.name}: ${corner.lat.toFixed(6)}°, ${corner.lon.toFixed(6)}° | UTM: ${utmCorner.easting}mE, ${utmCorner.northing}mN`,
                20, 182 + i * 7
            );
        });
        
        // Mapa real (vista top-down) a la derecha
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(56, 189, 248);
        doc.text('MAPA DEL AREA (VISTA PLANA)', 213.5, 115, { align: 'center' });

        // Usar la imagen generada como referencia visual pequeña (cuadrada 1:1)
        doc.addImage(mapImage, 'PNG', 178.5, 125, 70, 70);
        
        // Pie de página
        const pageCount = doc.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(7);
            doc.setTextColor(100, 116, 139);
            doc.text(
                `GeoWalker v1.0 - Simulador GIS 2.5D | Datos © OpenStreetMap Contributors | Página ${i} de ${pageCount}`,
                297 / 2, 205, { align: 'center' }
            );
        }
        
        // Guardar PDF
        const fileName = `GeoWalker_Plano_${this.originLat.toFixed(4)}_${this.originLon.toFixed(4)}_${Date.now()}.pdf`;
        doc.save(fileName);
        
        // Feedback visual
        const originalText = this.downloadBtn.text;
        this.downloadBtn.setText('✅ PDF GENERADO');
        this.downloadBtn.setStyle({ fill: '#34d399' });
        
        setTimeout(() => {
            this.downloadBtn.setText(originalText);
            this.downloadBtn.setStyle({ fill: '#34d399' });
        }, 2000);
    }
}
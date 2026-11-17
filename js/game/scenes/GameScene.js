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
    
    async copyCoordinates() {
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

        const textToCopy = [
            `=== GeoWalker - Coordenadas Actuales ===`,
            `Latitud/Longitud: ${currentLat.toFixed(6)}°, ${currentLon.toFixed(6)}°`,
            `DMS: ${latDMS}, ${lonDMS}`,
            `UTM Zone: ${utm.zone}`,
            `Easting: ${utm.easting} mE`,
            `Northing: ${utm.northing} mN`,
            `Distancia recorrida: ${Math.round(this.totalDistanceMeters)} m`,
            `Área de simulación: 1km² (500m radio)`,
            `Origen: ${this.originLat.toFixed(6)}°, ${this.originLon.toFixed(6)}°`,
            `Fecha: ${new Date().toLocaleString()}`
        ].join('\n');

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

    downloadAreaPDF() {
        if (!this.player || !this.osmData) return;
        const { jsPDF } = window.jspdf;
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
        doc.text('ESTADÍSTICAS DE DATOS OSM', 20, 130);
        
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(203, 213, 225);
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
            doc.text(line, 20, 140 + i * 7);
        });
        
        // Segunda página: Límites geográficos
        doc.addPage();
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, 297, 210, 'F');
        doc.setTextColor(56, 189, 248);
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.text('LÍMITES GEOGRÁFICOS DEL ÁREA (1km²)', 20, 25);
        
        const metersPerDegreeLat = 111320;
        const dLatDeg = 500 / metersPerDegreeLat;
        const dLonDeg = 500 / (metersPerDegreeLat * Math.cos(this.originLat * Math.PI / 180));
        
        const bounds = {
            north: this.originLat + dLatDeg,
            south: this.originLat - dLatDeg,
            east: this.originLon + dLonDeg,
            west: this.originLon - dLonDeg
        };
        
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
            doc.text(line, 20, 40 + i * 8);
        });
        
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(56, 189, 248);
        doc.text('ESQUINAS DEL RECTÁNGULO DE SIMULACIÓN', 20, 120);
        
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
                20, 132 + i * 8
            );
        });
        
        // Mini mapa esquemático
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(56, 189, 248);
        doc.text('REPRESENTACIÓN ESQUEMÁTICA', 150, 40);
        
        doc.setFont('courier', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(148, 163, 184);
        const asciiMap = [
            '     N (Norte)',
            '     ▲',
            '     │',
            '  ┌──┼──┐',
            '  │  │  │  ← 500m',
            'W │  ●  │ E  (● = Origen)',
            '  │  │  │',
            '  └──┼──┘',
            '     │',
            '     ▼',
            '     S (Sur)'
        ];
        asciiMap.forEach((line, i) => {
            doc.text(line, 150, 50 + i * 5);
        });
        
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
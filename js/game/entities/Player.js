import { isPointInPolygon } from '../../gis/buildingFootprints.js';
import { isometricToMeters, ProjectionConfig } from '../../gis/projections.js';
import { animatePerson, personTexture } from '../actorArt.js';

const JOYSTICK_SPEED_FACTOR = 0.5;

/**
 * Entidad del Jugador (Avatar 8 Bits) con Colisiones Robóticas - GeoWalker
 * Gestiona movimiento, límites de 1km2 y colisión dual (Poligonal + Cajas contenedoras).
 */
export class Player {
    constructor(scene, x, y, joystick) {
        this.scene = scene;
        this.joystick = joystick;
        this.x = x;
        this.y = y;
        this.speed = 120; // Velocidad en píxeles por segundo

        // Controles de teclado (WASD y Flechas)
        this.cursors = scene.input.keyboard?.createCursorKeys();
        this.keys = scene.input.keyboard?.addKeys({
            W: Phaser.Input.Keyboard.KeyCodes.W,
            A: Phaser.Input.Keyboard.KeyCodes.A,
            S: Phaser.Input.Keyboard.KeyCodes.S,
            D: Phaser.Input.Keyboard.KeyCodes.D
        });

        this.sprite = scene.add.image(x, y, personTexture('player')).setOrigin(0.5, 0.93);
    }

    update(time, delta, buildings) {
        let vx = 0;
        let vy = 0;
        const deltaSec = delta / 1000;

        if (this.cursors?.left.isDown || this.keys?.A.isDown) vx = -1;
        else if (this.cursors?.right.isDown || this.keys?.D.isDown) vx = 1;

        if (this.cursors?.up.isDown || this.keys?.W.isDown) vy = -1;
        else if (this.cursors?.down.isDown || this.keys?.S.isDown) vy = 1;

        if (vx === 0 && vy === 0) {
            vx = (this.joystick?.x ?? 0) * JOYSTICK_SPEED_FACTOR;
            vy = (this.joystick?.y ?? 0) * JOYSTICK_SPEED_FACTOR;
        } else if (vx !== 0 && vy !== 0) {
            vx *= 0.7071;
            vy *= 0.7071;
        }

        const dx = vx * this.speed * deltaSec;
        const dy = vy * this.speed * deltaSec;
        const previousX = this.x;
        const previousY = this.y;
        const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 2);
        for (let i = 0; i < steps; i++) {
            const nextX = this.x + dx / steps;
            const nextY = this.y + dy / steps;
            if (dx && !this.checkCollision(nextX, this.y, buildings)) this.x = nextX;
            if (dy && !this.checkCollision(this.x, nextY, buildings)) this.y = nextY;
        }

        // Sincronizar gráficos
        this.sprite.x = this.x;
        this.sprite.y = this.y;
        animatePerson(this.sprite, 'player', this.x - previousX, this.y - previousY, time);
    }

    /**
     * Verificación estricta de colisión con doble capa (Polígono exacto + Caja contenedora)
     */
    checkCollision(x, y, buildings) {
        const origin = this.scene.worldOrigin;
        const meters = isometricToMeters(x - origin.x, y - origin.y);
        const limit = ProjectionConfig.AREA_HALF_SIZE_METERS;
        if (Math.abs(meters.x) > limit || Math.abs(meters.y) > limit) {
            return true;
        }

        // 2. Colisión contra edificios de OSM
        const playerRadius = 8; // Radio de colisión corporal del avatar
        const testPoint = { x, y: y - playerRadius };

        const nearbyBuildings = buildings === this.scene.buildingsColliders
            ? this.scene.buildingGrid?.at(x, y) ?? buildings
            : buildings;
        for (const building of nearbyBuildings) {
            if (this.hitsBuilding(testPoint, building, playerRadius)) return true;
        }
        const feet = { x, y };
        const water = this.scene.waterGrid?.at(x, y) ?? this.scene.waterColliders;
        const trees = this.scene.treeGrid?.at(x, y) ?? this.scene.treeColliders;
        return water.some(area => this.hitsBuilding(feet, area, 0)) ||
            trees.some(tree => (x - tree.x) ** 2 + (y - tree.y) ** 2 <= tree.radius ** 2);
    }

    hitsBuilding(point, building, radius) {
        const bounds = building.bounds;
        return bounds &&
            point.x >= bounds.minX - radius && point.x <= bounds.maxX + radius &&
            point.y >= bounds.minY - radius && point.y <= bounds.maxY + radius &&
            this.isPointInPolygon(point, building.points) &&
            !building.holes?.some(hole => this.isPointInPolygon(point, hole));
    }

    isPointInPolygon(point, polygon) {
        return isPointInPolygon(point, polygon);
    }

    getPosition() {
        return { x: this.x, y: this.y };
    }
}

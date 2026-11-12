/**
 * Entidad del Jugador (Avatar 8 Bits) con Colisiones Robóticas - GeoWalker
 * Gestiona movimiento, límites de 1km2 y colisión dual (Poligonal + Cajas contenedoras).
 */
export class Player {
    constructor(scene, x, y) {
        this.scene = scene;
        this.x = x;
        this.y = y;
        this.speed = 120; // Velocidad en píxeles por segundo

        // Controles de teclado (WASD y Flechas)
        this.cursors = scene.input.keyboard.createCursorKeys();
        this.keys = scene.input.keyboard.addKeys({
            W: Phaser.Input.Keyboard.KeyCodes.W,
            A: Phaser.Input.Keyboard.KeyCodes.A,
            S: Phaser.Input.Keyboard.KeyCodes.S,
            D: Phaser.Input.Keyboard.KeyCodes.D
        });

        // Sprite visual de 8 bits
        this.sprite = scene.add.rectangle(x, y, 16, 24, 0x00ffcc);
        this.sprite.setOrigin(0.5, 1.0);
        
        this.head = scene.add.circle(x, y - 20, 5, 0xffffff);
        this.head.setOrigin(0.5, 0.5);
    }

    update(time, delta, buildings, mapWidth, mapHeight) {
        let vx = 0;
        let vy = 0;
        const deltaSec = delta / 1000;

        if (this.cursors.left.isDown || this.keys.A.isDown) vx = -1;
        else if (this.cursors.right.isDown || this.keys.D.isDown) vx = 1;

        if (this.cursors.up.isDown || this.keys.W.isDown) vy = -1;
        else if (this.cursors.down.isDown || this.keys.S.isDown) vy = 1;

        if (vx !== 0 && vy !== 0) {
            vx *= 0.7071;
            vy *= 0.7071;
        }

        const nextX = this.x + vx * this.speed * deltaSec;
        const nextY = this.y + vy * this.speed * deltaSec;

        // Comprobar colisión en X y mover si es válido
        if (!this.checkCollision(nextX, this.y, buildings, mapWidth, mapHeight)) {
            this.x = nextX;
        }

        // Comprobar colisión en Y y mover si es válido
        if (!this.checkCollision(this.x, nextY, buildings, mapWidth, mapHeight)) {
            this.y = nextY;
        }

        // Sincronizar gráficos
        this.sprite.x = this.x;
        this.sprite.y = this.y;
        this.head.x = this.x;
        this.head.y = this.y - 18;
    }

    /**
     * Verificación estricta de colisión con doble capa (Polígono exacto + Caja contenedora)
     */
    checkCollision(x, y, buildings, mapWidth, mapHeight) {
        // 1. Restricción del Bounding Box global de 1km² (Radio de 500m)
        const centerX = mapWidth / 2;
        const centerY = mapHeight / 2;
        const distX = x - centerX;
        const distY = y - centerY;
        const metersFromCenter = Math.sqrt(distX * distX + distY * distY) / 4;
        
        if (metersFromCenter > 500) {
            return true; // Límite del mundo superado
        }

        // 2. Colisión contra edificios de OSM
        const playerRadius = 8; // Radio de colisión corporal del avatar
        const testPoint = { x, y: y - playerRadius };

        for (const building of buildings) {
            // Capa A: Comprobación rápida por caja contenedora (Bounding Box del edificio)
            if (building.bounds) {
                if (
                    testPoint.x >= building.bounds.minX - playerRadius &&
                    testPoint.x <= building.bounds.maxX + playerRadius &&
                    testPoint.y >= building.bounds.minY - playerRadius &&
                    testPoint.y <= building.bounds.maxY + playerRadius
                ) {
                    // Capa B: Si está dentro de la caja, comprobamos el polígono exacto (Ray-Casting)
                    if (this.isPointInPolygon(testPoint, building.points)) {
                        return true; // Colisión confirmada
                    }
                }
            }
        }

        return false;
    }

    /**
     * Algoritmo Ray-Casting para verificar si un punto está dentro de un polígono
     */
    isPointInPolygon(point, polygon) {
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

    getPosition() {
        return { x: this.x, y: this.y };
    }
}
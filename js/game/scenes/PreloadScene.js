export class PreloadScene extends Phaser.Scene {
    constructor() {
        super('PreloadScene');
    }

    preload() {
        // Mostrar una barra o texto de carga mientras preparamos las texturas
        const width = this.scale.width;
        const height = this.scale.height;
        
        const loadingText = this.add.text(width / 2, height / 2, 'Cargando texturas del entorno 2.5D...', {
            fontFamily: 'monospace',
            fontSize: '14px',
            fill: '#38bdf8'
        }).setOrigin(0.5);

        // Generar texturas procedurales internas de alta calidad (asfalto, ladrillo, pasto) 
        // para que no dependas de archivos externos rotos y funcione al 100% de inmediato.
        this.generateProceduralTextures();
    }

    generateProceduralTextures() {
        const graphics = this.add.graphics();

        // 1. Textura de Asfalto (para las calles)
        graphics.fillStyle(0x1e293b, 1);
        graphics.fillRect(0, 0, 32, 32);
        // Pequeños puntos de ruido simulando grano de asfalto
        graphics.fillStyle(0x0f172a, 0.5);
        graphics.fillRect(4, 4, 2, 2);
        graphics.fillRect(20, 15, 2, 2);
        graphics.fillRect(10, 25, 2, 2);
        graphics.generateTexture('tex_asphalt', 32, 32);
        graphics.clear();

        // 2. Textura de Ladrillo / Concreto (para edificios)
        graphics.fillStyle(0x334155, 1);
        graphics.fillRect(0, 0, 32, 32);
        graphics.lineStyle(1, 0x475569, 1);
        graphics.strokeRect(0, 0, 32, 16);
        graphics.strokeRect(0, 16, 32, 16);
        graphics.generateTexture('tex_building', 32, 32);
        graphics.clear();

        // 3. Textura de Pasto (para parques)
        graphics.fillStyle(0x166534, 1);
        graphics.fillRect(0, 0, 32, 32);
        graphics.fillStyle(0x22c55e, 0.4);
        graphics.fillCircle(8, 8, 3);
        graphics.fillCircle(24, 20, 3);
        graphics.generateTexture('tex_grass', 32, 32);
        graphics.clear();

        // Una vez creadas las texturas, saltamos directamente a nuestra GameScene
        this.scene.start('GameScene', this.game.initialOSMData);
    }
}
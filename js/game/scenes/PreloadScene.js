export class PreloadScene extends Phaser.Scene {
    constructor() {
        super('PreloadScene');
    }

    preload() {
        // Mostrar una barra o texto de carga mientras preparamos las texturas
        const width = this.scale.width;
        const height = this.scale.height;
        
        const loadingText = this.add.text(width / 2, height / 2, 'Cargando assets del entorno 2.5D...', {
            fontFamily: 'monospace',
            fontSize: '14px',
            fill: '#38bdf8'
        }).setOrigin(0.5);

        // Cargar imágenes desde /assets/tiles/ y /assets/sprites/
        // Usamos this.load.image() para cargar archivos PNG reales
        // Con pixelArt: true en la config, las imágenes se renderizan nítidas (sin blur) al escalar
        
        // ── TILES DE TERRENO (suelos) ──
        // Calles y asfalto
        this.load.image('tex_asphalt', 'assets/tiles/terrain/asphalt.png');
        this.load.image('tex_asphalt_sidebar', 'assets/tiles/terrain/asphalt_sidebar.png');
        
        // Césped / parques
        this.load.image('tex_grass', 'assets/tiles/grass/grass_01.png');
        this.load.image('tex_grass_02', 'assets/tiles/grass/grass_02.png');
        this.load.image('tex_dirt', 'assets/tiles/terrain/dirt.png');
        
        // Agua (ríos, canales)
        this.load.image('tex_water_river', 'assets/tiles/water/river_01.png');
        this.load.image('tex_water_canal', 'assets/tiles/water/canal_01.png');
        this.load.image('tex_water_pond', 'assets/tiles/water/pond_01.png');
        
        // Pavimento / aceras
        this.load.image('tex_pavement', 'assets/tiles/terrain/pavement.png');
        this.load.image('tex_pedestrian', 'assets/tiles/terrain/pedestrian.png');

        // ── SPRITES DE EDIFICIOS (categorizados por familia OSM) ──
        // Residencial (casas, apartamentos) - techos de teja, paredes con ventanas
        this.load.image('spr_building_residential_1', 'assets/sprites/buildings/residential/house_01.png');
        this.load.image('spr_building_residential_2', 'assets/sprites/buildings/residential/house_02.png');
        this.load.image('spr_building_residential_3', 'assets/sprites/buildings/residential/apartment_01.png');
        
        // Comercial / Bancos / Oficinas - concreto, cristal, terrazas planas
        this.load.image('spr_building_commercial_1', 'assets/sprites/buildings/commercial/office_01.png');
        this.load.image('spr_building_commercial_2', 'assets/sprites/buildings/commercial/bank_01.png');
        this.load.image('spr_building_commercial_3', 'assets/sprites/buildings/commercial/shop_01.png');
        
        // Gastronomía (restaurantes, cafés, pizzerías) - estilo cálido
        this.load.image('spr_building_gastronomy_1', 'assets/sprites/buildings/gastronomy/restaurant_01.png');
        this.load.image('spr_building_gastronomy_2', 'assets/sprites/buildings/gastronomy/cafe_01.png');
        this.load.image('spr_building_gastronomy_3', 'assets/sprites/buildings/gastronomy/pizzeria_01.png');
        
        // Religioso / Iglesias - muros coloniales, terracota
        this.load.image('spr_building_religious_1', 'assets/sprites/buildings/religious/church_01.png');
        this.load.image('spr_building_religious_2', 'assets/sprites/buildings/religious/chapel_01.png');

        // ── ENTIDADES ──
        // Jugador
        this.load.image('spr_player', 'assets/sprites/player/player_01.png');
        
        // Vehículos (NPCs de tráfico)
        this.load.image('spr_vehicle_car', 'assets/sprites/vehicles/car_01.png');
        this.load.image('spr_vehicle_truck', 'assets/sprites/vehicles/truck_01.png');
        
        // Peatones
        this.load.image('spr_pedestrian_1', 'assets/sprites/pedestrians/pedestrian_01.png');
        this.load.image('spr_pedestrian_2', 'assets/sprites/pedestrians/pedestrian_02.png');

        // ── UI ──
        this.load.image('ui_compass_bg', 'assets/ui/compass_bg.png');
        this.load.image('ui_compass_needle', 'assets/ui/compass_needle.png');

        // Fallback: si faltan archivos, generamos texturas procedurales como respaldo
        this.load.on('loaderror', (file) => {
            console.warn(`Asset no encontrado: ${file.key} (${file.url}) - usando fallback procedural`);
        });

        // Al terminar la carga, iniciamos GameScene
        this.load.once('complete', () => {
            this.scene.start('GameScene', this.game.initialOSMData);
        });
    }
}
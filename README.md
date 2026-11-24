# GeoWalker

Simulador web SIG en perspectiva isométrica. Selecciona un punto en el mapa y recorre un cuadrado de 1 km² construido con datos de OpenStreetMap.

## Probarlo

Clona el repositorio y, desde la carpeta del proyecto, inicia un servidor HTTP local con Python 3.

```sh
git clone https://github.com/alvigem2/geowalker.git
cd geowalker
python -m http.server 8000
```

Abre [GeoWalker en localhost](http://localhost:8000/). El simulador necesita conexión a Internet para cargar el mapa base, los datos de OpenStreetMap y las bibliotecas web.

- Selecciona un lugar haciendo clic en el mapa, arrastrando el marcador o usando el buscador. Después pulsa **Iniciar Simulación GeoWalker**.
- Usa WASD o las flechas en escritorio. En pantallas táctiles, usa el joystick en pantalla.
- Consulta las coordenadas, el rumbo y los puntos de interés en el HUD. Puedes copiar coordenadas o exportar el área en PDF, CSV y GeoJSON.

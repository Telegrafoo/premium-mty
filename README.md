# Premium MTY

Gasolineras con la Premium más barata de Monterrey y su área metropolitana, con los precios oficiales que cada estación reporta al regulador de energía (antes CRE, hoy CNE).

## Cómo funciona

- `scripts/update_prices.py` descarga los precios y ubicaciones oficiales, filtra el área metropolitana, descarta precios imposibles, marca los dudosos y guarda una foto diaria en `data/`.
- `.github/workflows/update-prices.yml` corre ese script todos los días a las 6:00 am (hora de Monterrey) y guarda los datos nuevos en el repositorio.
- `index.html`, `css/` y `js/` son la app. Es una página estática: GitHub Pages la sirve tal cual.

## Publicar en GitHub

1. Crea un repositorio nuevo en GitHub y sube esta carpeta.
2. En **Settings → Pages**, elige *Deploy from a branch*, rama `main`, carpeta `/ (root)`.
3. En **Settings → Actions → General → Workflow permissions**, elige *Read and write permissions* para que la actualización diaria pueda guardar los datos.
4. En la pestaña **Actions**, abre *Actualizar precios* y pulsa *Run workflow* para la primera actualización.

## Probar en tu computadora

```bash
python3 -m http.server 5180
```

Luego abre http://localhost:5180.

## Lo que hay que saber de los datos

- La fuente no dice cuándo reportó cada estación su precio. La app muestra "precio sin cambio desde", contado desde el primer día en que lo vimos.
- Se descartan precios fuera de $20 a $40. Quedan "por verificar" los que están $4 o más debajo de la mediana, los menores a su propia Magna y los duplicados. Uno entre $2.50 y $4 debajo de la mediana se acepta cuando se mantiene 3 días.
- La zona es aproximada: la fuente no trae municipio.
- El mapa usa mosaicos de OpenStreetMap con su atribución. Si la app crece mucho en visitas, conviene cambiar a un proveedor de mapas con plan propio.

# Cangrejal Alerta

Plataforma web colaborativa para que los habitantes de la Cuenca del Río Cangrejal reporten en tiempo real incidentes de movilidad, seguridad y ambiente.

## Cómo abrirlo en Visual Studio Code

1. Descarga y descomprime la carpeta `cangrejal-alerta`.
2. Abre la carpeta en Visual Studio Code (`Archivo → Abrir carpeta...`).
3. Instala la extensión **Live Server** (de Ritwick Dey) desde el marketplace de VS Code, si no la tienes.
4. Haz clic derecho sobre `index.html` y selecciona **"Open with Live Server"**.
5. Se abrirá en tu navegador en una dirección como `http://127.0.0.1:5500`.

También puedes abrir `index.html` directamente con doble clic, aunque la geolocalización funciona mejor cuando el sitio corre sobre `http://localhost` o `https`.

## Estructura del proyecto

```
cangrejal-alerta/
├── index.html   → estructura de la página y del formulario de reporte
├── style.css    → estilos (paleta inspirada en la selva y el río)
└── script.js    → lógica: reportes, geolocalización, fotos, votos, reputación
```

## Qué incluye esta versión

- Formulario de reporte con título, descripción, categoría (11 tipos + Otro), nivel de gravedad y evidencia obligatoria (foto y/o ubicación GPS automática).
- Feed de reportes con filtro por categoría, foto adjunta, ubicación, gravedad y hora relativa ("hace 5 min").
- Verificación comunitaria: botones ✅ Confirmado / ❌ Información incorrecta. Al llegar a 3 confirmaciones netas aparece el distintivo "🟢 Información verificada por la comunidad"; al llegar a 3 negaciones netas se marca como "❌ información incorrecta".
- Reputación de usuario: cada nombre acumula puntos (+5 cuando uno de sus reportes se verifica, −5 cuando se marca incorrecto) y se muestra como estrellas.
- Marca de "✔ Información oficial" para quien publique marcando la casilla de Patronato / COPECO / Alcaldía / Policía / Bomberos.
- Todo se guarda en el `localStorage` del navegador (no requiere backend ni base de datos).

## Próximos pasos sugeridos (no incluidos todavía)

- Backend real (por ejemplo Node + una base de datos) para que los reportes se compartan entre distintos dispositivos y no solo en el navegador de cada persona.
- Autenticación real para moderadores en vez de una casilla de confianza.
- Mapa interactivo (Leaflet/Google Maps) mostrando todos los reportes con pines por categoría.
- Agrupación automática de reportes duplicados por cercanía geográfica y tiempo.

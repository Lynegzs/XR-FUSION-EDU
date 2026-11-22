# XR FUSION EDU

Laboratorio inmersivo de **modelos 3D, control por gestos con cámara web, Realidad Aumentada (RA) y Realidad Virtual (RV)** para educación tecnológica (`index.html` + `<model-viewer 4.1.0>` + `A-Frame 1.8.0` + MediaPipe Tasks Vision `@0.10.18`).

---

## Características principales (Fase 0 + Fase 1)

- **Biblioteca local de 13 modelos `.glb`** en `public/models/` (servidos en `/models/`), con materiales PBR optimizados para hardware oscuro e iluminación de estudio seleccionable (`☼ LUZ: ESTUDIO`).
- **Importación local y remota**: carga de archivos `.glb` por selector o arrastrar/soltar (URLs `blob:` temporales en la pestaña) y carga por URL `https://` con validación.
- **Visualización optimizada y tema dual**: escena 3D ampliada, biblioteca con desplazamiento interno, barra de estado compacta, diseño adaptable (escritorio, tableta y móvil con objetivos táctiles ≥ 44 px) y cambio de tema oscuro/claro (`T`).
- **Control por gestos de manos (MediaPipe Tasks Vision `@0.10.18`)**: funciona con 1 o 2 manos suavizadas mediante `OneEuroFilter`, HUD compacto con video en espejo, toggle de esqueleto, cambio de cámara frontal/trasera (`⇄`) y subtítulos en vivo.
- **Respaldo universal y privacidad**: los gestos son totalmente opcionales (siempre funcionan ratón, pantalla táctil, botones y teclado). **El video y los landmarks se procesan exclusivamente en tu navegador y nunca se envían a servidores externos.**

---

## Control por gestos y atajos

| Gesto / Tecla | Acción en `<model-viewer>` / Laboratorio |
|---|---|
| **Mano abierta** o **pellizco + arrastre** | Rotar el modelo 3D (`cameraOrbit`) |
| **Dos manos (separar / juntar)** | Zoom acercar / alejar (`fieldOfView`) |
| **Deslizar mano lateralmente** | Cambiar al modelo siguiente o anterior de la biblioteca |
| **Índice señalando** (mantener ~0,5 s) | Abrir la **Ficha pedagógica del modelo** |
| **Pulgar arriba** (mantener ~0,5 s) | Confirmar y avanzar la siguiente etapa de la **Misión XR** |
| **Pellizco** con **Modo fijar punto** activo | Fijar un marcador 3D sobre la superficie bajo la retícula |
| Tecla **`C`** | Encender / apagar cámara de gestos |
| Tecla **`R`** | Reiniciar vista de cámara 3D |
| Tecla **`T`** | Alternar tema oscuro / claro |
| Tecla **`?`** | Abrir guía rápida |

> **Requisito de cámara:** `navigator.mediaDevices.getUserMedia` exige un contexto seguro (`https://` o `http://localhost`).

---

## Uso sin internet (estructura `vendor/` offline)

Al iniciar la cámara, la aplicación busca primero los archivos locales en `./vendor/` y solo recurre a la CDN (`cdn.jsdelivr.net` / `unpkg.com` / `storage.googleapis.com`) como respaldo si faltan en disco:

```text
public/
├── models/                                  # 13 archivos .glb locales
└── vendor/
    ├── mediapipe/
    │   └── tasks-vision/
    │       ├── vision_bundle.mjs            # @mediapipe/tasks-vision@0.10.18
    │       └── wasm/
    │           ├── vision_wasm_internal.js
    │           ├── vision_wasm_internal.wasm
    │           ├── vision_wasm_nosimd_internal.js
    │           └── vision_wasm_nosimd_internal.wasm
    └── models/
        └── hand_landmarker.task             # Modelo float16 HandLandmarker
```

### Cómo poblar o actualizar la carpeta `vendor/` manualmente

1. **Bundle y WASM de `@mediapipe/tasks-vision@0.10.18`** (desde `node_modules` tras `npm install`, o desde `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/`):
   ```bash
   mkdir -p public/vendor/mediapipe/tasks-vision/wasm public/vendor/models
   cp node_modules/@mediapipe/tasks-vision/vision_bundle.mjs public/vendor/mediapipe/tasks-vision/
   cp node_modules/@mediapipe/tasks-vision/wasm/* public/vendor/mediapipe/tasks-vision/wasm/
   ```
2. **Modelo `hand_landmarker.task`**:
   ```bash
   curl -L https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task \
     -o public/vendor/models/hand_landmarker.task
   ```
3. Si ejecutas el build estático (`npm run build`), Vite copiará `public/models/` y `public/vendor/` dentro de `dist/`, dejándolo listo para Live Server, servidor local o GitHub Pages sin conexión a internet (excepto `<model-viewer>` y `A-Frame` si no se cachean previamente en el navegador).

---

## Ejecución y verificación local

```bash
npm install
npm run dev       # Inicia el servidor en http://localhost:3000
npm run build     # Genera dist/ para despliegue estático
```

---

## Créditos

- **XR FUSION EDU** — Jaime Galan + Savier Lara
- **Visión artificial:** [MediaPipe Tasks Vision](https://developers.google.com/mediapipe) (`@mediapipe/tasks-vision@0.10.18`, Apache 2.0)
- **Visor 3D / RA / RV:** [`<model-viewer 4.1.0>`](https://modelviewer.dev/) y [A-Frame 1.8.0](https://aframe.io/)

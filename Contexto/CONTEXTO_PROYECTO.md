# Proyecto Malcriado Vinos — Contexto Completo

## Descripción
Sistema de gestión comercial con tienda web estática (GitHub Pages), panel administrador (SPA React), API REST local, base de datos SQLite, Supabase como respaldo en la nube, y WhatsApp como fallback final.

---

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js + Express, API REST |
| BD local | SQLite (better-sqlite3) |
| BD nube | Supabase (PostgreSQL) |
| Frontend admin | React + TypeScript + Vite |
| Tienda web | HTML/CSS/JS estático (vanilla) |
| Deploy web | GitHub Pages (rama gh-pages) |
| Inicio rápido | `iniciar-lite.vbs` (VBScript) |

---

## Estructura del Proyecto

```
Malcriado Vinos/
├── api-server.js          # API REST (Express, rutas, DB, SSE, Supabase, deploy)
├── package.json           # Dependencias y scripts
├── vite.config.ts         # Configuración Vite para SPA React
├── iniciar-lite.vbs       # Lanzador (abre Chrome kiosko + servidor)
├── database.db            # SQLite (productos, pedidos, config, caja)
├── web/                   # Tienda web estática (subida a gh-pages)
│   ├── index.html         # Catálogo + carrito + checkout + pedidos vía API/Supabase/WhatsApp
│   ├── logo.jpeg          # Logo
│   └── data.json          # Productos + config generado al hacer deploy
├── src/                   # SPA React (admin panel)
│   ├── App.tsx            # Layout principal, tabs, SSE, notificaciones
│   ├── components/
│   │   ├── PanelWeb.tsx   # Config tienda web (banners, popup, categorías, Supabase)
│   │   ├── PedidosWeb.tsx # Lista pedidos (locales + Supabase, sincronización)
│   │   ├── Backups.tsx    # Crear/restaurar backups de la DB
│   │   └── ...            # Otros componentes
├── dist/                  # Build de la SPA React (generado con `npm run build`)
├── backups/               # Backups de database.db
├── contexto/              # Documentación del proyecto
└── .gitignore
```

---

## Estados del Proyecto

### Completado
- [x] Servidor Express con rutas principales (productos, pedidos, config, caja)
- [x] SSE push notifications al recibir pedidos
- [x] Tienda web estática (`web/index.html`) con:
  - Catálogo de productos con badges NUEVO/OFERTA
  - Carrito, checkout con formulario
  - Envío de pedidos: API local → Supabase → WhatsApp (fallback progresivo)
  - Banners, popup de bienvenida, búsqueda
  - Botón OFERTAS en header
  - Footer con créditos
  - Iconos sociales SVG (WhatsApp, Instagram, Facebook)
- [x] Panel administrador SPA React con:
  - Productos CRUD
  - Pedidos (locales + Supabase, con sincronización)
  - Configuración general + Supabase + GitHub
  - Caja registradora
  - Backups
  - Toast notifications
- [x] Deploy a GitHub Pages (script POST /api/deploy-ghpages)
- [x] Integración Supabase:
  - Configuración URL + anon key en panel admin
  - Web store escribe a Supabase cuando API no disponible
  - PedidosWeb muestra pedidos desde Supabase
  - Botón "Sincronizar desde Supabase" (importa pedidos a BD local)
- [x] Logo copiado a `web/`, rutas relativas en web store
- [x] `iniciar-lite.vbs` funcional (detecta Node, Chrome, mata proceso previo, splash screen)

### Pendiente / A Mejorar
- [ ] Restaurar server después de editar `api-server.js` (usar `iniciar-lite.vbs`)
- [ ] Reconstruir SPA después de cambios en `src/` (ejecutar `npm run build`)
- [ ] Probar flujo completo: pedido desde GitHub Pages → Supabase → sincronizar a admin
- [ ] Mejorar robustez de sincronización Supabase

---

## Credenciales y URLs

- **Supabase URL**: `https://hgypooztigvmixpecimz.supabase.co`
- **Supabase Anon Key**: `(guardada en panel admin → Configuración → Supabase)`
- **GitHub Pages**: `https://malcriadodevinos-bot.github.io/malcriado-vinos/`
- **GitHub Repo**: `malcriadodevinos-bot/malcriado-vinos`
- **GitHub Token**: `(guardado en panel admin → Configuración → GitHub)`
- **API Local**: `http://localhost:4050`
- **Node.js**: `C:\Program Files\nodejs\node.exe` (no está en PATH)

---

## Cómo iniciar

1. Ejecutar `iniciar-lite.vbs` (abre Chrome kiosko con splash → admin panel)
2. O manualmente: `$env:STANDALONE="true"; $env:PORT="4050"; & "C:\Program Files\nodejs\node.exe" api-server.js`
3. Admin panel: `http://localhost:4050/`
4. Tienda web: `http://localhost:4050/web/`

## Cómo desplegar a GitHub Pages

1. Panel admin → Configuración → llenar GitHub Token, Repo, Web URL
2. Click "Guardar Datos GitHub"
3. Click "Desplegar en GitHub Pages"
4. El script genera `web/data.json` con productos + config (incluye Supabase)
5. Sube a rama `gh-pages` (solo `index.html`, `logo.jpeg`, `data.json`)

## Scripts npm

| Comando | Función |
|---------|---------|
| `npm run build` | Build SPA React a `dist/` |
| `npm run dev` | No usar (obsoleto) |
| `node api-server.js` | Iniciar servidor (con STANDALONE=true) |

## Supabase SQL (ejecutar en SQL Editor)

```sql
CREATE TABLE orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_name text,
  client_phone text,
  items text,
  total numeric,
  notes text,
  delivery_type text,
  status text DEFAULT 'nuevo',
  date timestamptz DEFAULT now()
);
```

## Notas Importantes

- **Siempre reiniciar server** después de editar `api-server.js` (cerrar Chrome, ejecutar `iniciar-lite.vbs`)
- **Siempre rebuildear SPA** después de editar `src/` (`npm run build`)
- `iniciar-lite.vbs` inicia el servidor en background y abre Chrome en modo kiosko
- La tienda web en GitHub Pages **no tiene acceso a la API local**; usa Supabase como backend
- El panel admin sólo funciona conectado al servidor local
- Los pedidos entran por: API local → SSE notifica admin → también se guardan en BD local
- Si la API local no está disponible (ej: gh-pages), los pedidos van a Supabase
- Si Supabase falla, se abre WhatsApp con el detalle del pedido

## Historial de Cambios Recientes

- Integración Supabase completa (config, escritura desde web store, lectura/sync en admin)
- Migración de `https.get` a `fetch` en endpoints Supabase (mejor compatibilidad)
- Corrección de rutas y orden en `api-server.js`
- Banner y popup configurables desde admin
- Badges NUEVO/OFERTA en productos
- Botón OFERTAS en header
- Deploy a GitHub Pages funcional con gh-pages branch

# 📚 Documentación Maestra — Inventario Pro

> [!IMPORTANT]
> **REGLA CRÍTICA PARA TODOS LOS AGENTES:**
> **SIEMPRE**, después de realizar cualquier modificación en el proyecto (arreglar errores, agregar funciones, modificar lógica, etc.), es **OBLIGATORIO** actualizar este archivo (`DOCUMENTACION_MAESTRA.md`). 
> Debes documentar claramente en la Bitácora (o en la sección pertinente):
> 1. Qué errores tenía el sistema y cómo se solucionaron.
> 2. Qué nuevas funciones o lógicas se agregaron.
> 3. Cualquier cambio estructural o de comportamiento que otro agente deba conocer en el futuro.

> Este archivo unifica toda la documentación del proyecto para brindar contexto completo a la Inteligencia Artificial.

---

## 📄 Archivo: `README.md`

# 📦 Inventario Pro — Docker Edition

## Stack
- **Frontend**: HTML/CSS/JS puro servido por Nginx
- **Backend**: FastAPI (Python) + SQLAlchemy
- **Base de datos**: PostgreSQL 16
- **Orquestación**: Docker Compose

## 🚀 Inicio rápido

### Requisitos
- Docker Desktop instalado y corriendo
- Docker Compose v2+

### Levantar la app

```bash
# 1. Clona o descarga este proyecto
cd inventario_app

# 2. Levanta todos los servicios
docker compose up --build

# 3. Abre en tu navegador:
#    Frontend:  http://localhost:3000
#    API Docs:  http://localhost:8000/docs
#    API:       http://localhost:8000
```

### Comandos útiles

```bash
# Ver logs en tiempo real
docker compose logs -f

# Detener sin borrar datos
docker compose stop

# Detener Y borrar contenedores (datos se conservan en volumen)
docker compose down

# ⚠️ Borrar TODO incluyendo la base de datos
docker compose down -v
```

## 📁 Estructura del proyecto

```
inventario_app/
├── docker-compose.yml       # Orquestación de servicios
├── README.md
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── __init__.py
│       ├── main.py          # Endpoints FastAPI
│       ├── models.py        # Tablas PostgreSQL
│       ├── schemas.py       # Validación de datos
│       └── database.py      # Conexión a BD
└── frontend/
    └── index.html           # UI completa
```

## 🔗 Endpoints API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /productos | Listar todos |
| POST | /productos | Crear producto |
| PUT | /productos/{id} | Editar producto |
| DELETE | /productos/{id} | Eliminar |
| PATCH | /productos/{id}/qty?delta=N | Ajuste rápido |
| POST | /productos/{id}/ajuste | Ajuste formal |
| POST | /ventas | Registrar venta |
| GET | /movimientos | Historial |
| GET | /reporte | Resumen de ventas |
| GET | /docs | Swagger UI automático |


---

## 📄 Archivo: `ESTRUCTURA_PROYECTO.md`

# 🏗️ Bitácora de Estructura y Arquitectura — Inventario Pro

> Este documento es una referencia rápida (Bitácora Arquitectónica) para mapear todas las funcionalidades y la estructura actual del proyecto. Sirve para que cualquier nuevo desarrollador o Inteligencia Artificial entienda de inmediato el esqueleto del software "Inventario Pro".
> *Última actualización: 2026-04-01*

## 📚 Visión General
**Inventario Pro** es una aplicación Web (SPA) monolítica ligera y veloz, diseñada para gestionar un catálogo de productos complejos (especialmente ropa con variaciones de talla, color, género), realizar órdenes de compra, procesar ventas usando escaneo de códigos de barra USB, y entregar reportes financieros visuales.

### Stack Tecnológico
- **Frontend:** Vanilla HTML, CSS (`styles.css`), JavaScript (`app.js`, `dashboard.js`, `oc.js`, `contabilidad.js`, `conteo.js`, `devoluciones.js`). Sistema de navegación mediante **Sidebar Colapsable (Lumina Glass Design)** con persistencia de estado.
- **Backend:** Python + FastAPI. Arquitectura asíncrona, protegida con **Rate Limiting** (slowapi) y Middleware de seguridad (HSTS, CSP, XSS protection).
- **Base de Datos:** PostgreSQL (en producción via Docker). Gestión de integridad via SQLAlchemy 2.0 y **Automatización de Respaldos (24h)**.
- **Seguridad/Hardening:** Despliegue en Docker con usuario no-root, gestión estricta de secretos en `.env`, y autenticación **2FA (TOTP)** obligatoria para el admin.

---

## 📂 Estructura de Directorios Principal

```text
/inventario_app_v2
├── docker-compose.yml       # Orquestador del stack (UI puerto 80, API puerto 8000). Aislado de la red host.
├── .env                     # [CRÍTICO] Gestión de secretos: credenciales de BD y SECRET_KEY de JWT.
├── ROADMAP.md               # Bitácora de ideas, mejoras propuestas y progreso.
├── SECURITY_AUDIT.md        # Registro de hardening y auditoría de seguridad para producción.
├── ESTRUCTURA_PROYECTO.md   # Este documento de arquitectura estructural.
├── backend/                 # API en Python FastAPI.
│   ├── app/                 # Código fuente principal.
│   │   ├── main.py          # Entrypoint con Middleware de seguridad y Rate Limiting.
│   │   ├── auth.py          # Gestión de JWT, cifrado de claves y autenticación.
│   │   ├── services.py      # Lógica de negocio y validaciones de seguridad (Password policy).
│   │   └── ...
│   ├── uploads/devoluciones/ # Fotos de los diseños devueltos (fuera de git; no las sirve nginx).
│   └── Dockerfile           # Imagen optimizada con usuario de sistema restringido (appuser).
└── frontend/                # SPA Vanilla Web.
    ├── index.html           # Estructura central con Toasts Containers y Bell UI.
    ├── styles.css           # Estética premium, animaciones y diseño del panel de notificaciones.
    ├── app.js               # Lógica general, polling de alertas y sistema de Toasts persistentes.
    └── devoluciones.js      # Apartado «↩️ Devoluciones»: piezas devueltas con foto, venta y descarte.
```

---

## ⚙️ Módulos de Operación y Funcionalidad del Frontend (Interfaces)

La aplicación utiliza una estructura de **Sidebar Navigation** moderna, donde las secciones se cargan dinámicamente sin recargar la página:

1. **📈 Dashboard (`dashboard.js`)**
   - **Propósito:** Panel de control visual y analítico inmediato para dueños de negocio.
   - **Funcionalidades:** Muestra tarjetas de KPIs como "Ventas Hoy", "Margen Promedio", "Ventas del Mes", y métricas de advertencia como "Productos en Alerta". Utiliza `Chart.js` para visualizar líneas de tendencia históricas de ingresos, barras del *Top 10* de unidades más vendidas y gráficos de dona para la densidad del inventario por cantidad de piezas disponibles.

2. **📋 Inventario (`app.js`)**
   - **Propósito:** Catálogo principal central de alta, baja y edición de productos maestros en tiempo real.
   - **Funcionalidades:** Presenta una tabla expansible de productos en la empresa. Cuenta con filtros anidados (Ej: Selecciona Categoría Primaria y luego Subcategoría). Tiene botones para "Ajuste manual de mercancía" o Edición.
   - **Notas y Proveedores:** Soporta `notas_internas` y `proveedores_alternativos` a nivel de base de datos con campos dedicados en el modal de edición, e incluye tooltips flotantes en la tabla principal para rápida visualización.
   - Introduce el "Asistente inteligente de Ropa" en su modal, minimizando esfuerzos de tipeo combinando Género/Público/Peso/Colores para autogenerar tallas estándares con alertas correspondientes.
   - **Variantes Rápidas e Indicadores:** Incorpora una tarjeta de KPI para "Unidades Disponibles" (suma total de stock de todos los productos) y agrega botones contextuales de creación acelerada en la tabla de inventario: `🎨 + Color` en filas de productos padre y `📐 + Talla` en subfilas de color, interactuando con un modal premium (`overlay-variante-rapida`) que hereda automáticamente los atributos del elemento base/padre.

3. **💰 Registrar Venta (POS - Point of Sale) (`app.js`)**
   - **Propósito:** Un cajero de flujo acelerado optimizado para el vendedor.
   - **Funcionalidades:** Interfaz completamente compatible con receptores de eventos nativos para responder de forma asíncrona a la lectura por "pistolas USB de código de barras". Agrega unidades al carrito sumando métricas al vuelo si el código se repite. Ofrece un selector de Origen ("Canales" como venta por Amazon, mostrador directo, web) y finaliza con botón verde para cobro final emitiendo ticket en consola.
   - **Métricas y Eliminación:** Presenta tarjetas KPI dinámicas de ventas e ingresos diarios/mensuales sincronizadas en tiempo real. Incluye un botón para eliminar ventas realizadas en el historial de transacciones, actualizando de forma inmediata y automática los indicadores financieros agregados.


4. **🕘 Historial / Trazabilidad (`app.js`)**
   - **Propósito:** Tracker completo de acciones para auditar.
   - **Funcionalidades:** Una vista de solo-lectura listando cualquier incremento (Entradas y Ajustes positivos) y detrimento (Ventas/Mermas/Ajustes a la baja) referenciado con la variable temporal (*timestamps* inmutables). Permite búsqueda textual o filtro por tipología de evento para rastrear "cuándo o por qué desapareció un artículo".

5. **📊 Reporte Financiero Automático (`app.js`)**
   - **Propósito:** Contabilidad simple basada en rangos temporales (Ej: Seleccionar un mes o quincena concreta usando Inputs nativos *date*).
   - **Funcionalidades:** Extrae todos los tickets consolidados en el lapso elegido. Analiza las tuplas y muestra dinero total bruto atrapado y a su vez resta automáticamente los *precios de costo*, entregándole al usuario la utilidad/ganancia real lograda sin intervenciones matemáticas de hojas de cálculo externas. Imprime además una pequeña tabla ordenando lo que más trajo volumen monetario.

6. **🛒 Órdenes de Compra / Reabastecimiento (`oc.js`)**
   - **Propósito:** Control formal y central de la entrada de mercancía futura proveniente de grandes fábricas.
   - **Funcionalidades:** Permite abrir y editar carritos de estado `Borrador`. Bloquea su sobre-escritura total si pasa a estado de `Enviada` o `Confirmada`. Mismo soporte robusto para scanner. Posee un renderizado complejo en `jsPDF` que lee items dispares (Playera S Azul, Playera M Azul, etc.) y los re-agrupa de forma visual e inteligente en una celda PDF "matrical" para que la fabricante lo entienda fácilmente al leer el correo.
   - **Duplicación Rápida:** Incluye un botón "📋 Duplicar" para clonar al vuelo cualquier orden (y su contenido) generando un nuevo Borrador, facilitando el proceso frecuente de resurtido automático.
   - Registra de forma independiente dentro de los "items fantasma de la OC" para jamás estropear la BD transaccional.
   - Soporta registro de compra de Insumos (Catálogo recurrente) y Equipos, con la capacidad de establecer pagos a Meses Sin Intereses (MSI).

7. **💵 Contabilidad y Finanzas (`contabilidad.js`)**
   - **Propósito:** Registrar y proyectar el flujo de efectivo real del negocio (Ingresos vs Egresos).
   - **Funcionalidades:** Dashboard financiero (exclusivo admin) que muestra utilidades mensuales, registro manual de ingresos (ej. depósitos de Amazon netos) y tabla de auditoría.
   - **Integración MSI y OC:** Genera egresos automatizados al confirmar Órdenes de Compra. Si la OC es de Equipo o Insumo y a Meses Sin Intereses, el sistema divide inteligentemente el gasto creando filas proyectadas a futuro mes a mes.
   - **Catálogo de Insumos:** Módulo CRUD auxiliar que alimenta los selectores de las órdenes de compra para cargar cajas, viniles o material sin teclearlo a mano.

8. **↩️ Playeras en Devolución (`devoluciones.js`)**
   - **Propósito:** dar segunda vida a las prendas que regresan de un cliente: cada pieza devuelta queda registrada con su **diseño fotografiado**, disponible para re-venderse o descartarse. Resuelve el caso real de tener dos playeras negras de la misma talla en stock pero con diseños distintos.
   - **Funcionalidades:** listado con filtros por estado (`disponible` / `vendida` / `descartada`) y buscador; tarjetas con foto, producto/color/talla, unidades, precio y botones de acción; **venta directa** de la pieza (genera folio `YYYYMMDD-DEV{id}-HHMMSS`, descuenta stock y graba el `Movimiento` con canal «Devolución»); **descarte** (baja el stock y graba ajuste con canal «Devolución descartada»); edición de unidades, precio, diseño y notas (el stock se ajusta por la diferencia).
   - **Foto obligatoria:** ninguna pieza se registra sin su imagen del diseño. El navegador la **comprime en canvas** (≤1000 px, fondo blanco, JPEG 0.82 — 3.5 MB → ~10 KB) antes de subirla; el backend valida extensión declarada **y firma binaria real**, limita a 8 MB y la guarda fuera del árbol que sirve nginx.
   - **Dos caminos de alta:** el modal «Devolver» de una venta registrada (devolución total o parcial, con reparto de unidades por diseño) y el alta manual desde el propio apartado.
   - **Permisos:** registrar / editar / descartar / subir foto = **solo admin**; ver el listado, las fotos y vender = cualquier sesión activa (`admin`, `vendedor`; `bodeguero` solo consulta).
   - **Integración con Inventario:** la columna «**Devueltas**» de la tabla de inventario se alimenta de `GET /devoluciones/resumen` (unidades disponibles por producto), de modo que el stock mostrado ya incluye las piezas devueltas.

9. **⚙️ Administración (Auditoría, Usuarios y Base de Datos) (`app.js`)**
   - **Propósito:** Control total del sistema y resguardo de la información.
   - **Funcionalidades:** 
     - **Auditoría (`#page-logs`, solo admin):** Página con dos pestañas (`.audit-tabs`). La pestaña **Registros** muestra 5 KPIs (`/audit-logs/stats`), filtros por usuario, acción, rango de fechas y paginación servidor (`skip`/`limit`, `AUDIT_PAGE_SIZE = 50`) sobre `/audit-logs`, con badges por tipo de acción y exportación a CSV. La pestaña **Respaldos** alberga el módulo de backups (antes página independiente).
     - **Gestión de Usuarios:** Creación, edición y eliminación de personal. Visualización en tiempo real del estado de **2FA (TOTP)** para cada operario.
     - **Respaldos (Backups):** Sistema de generación de SQL a un clic. Incluye **Automatización de 24 horas** integrada en el ciclo de vida del backend (Lifespan), garantizando un resguardo diario ininterrumpido sin bloqueos de contraseña (`pg_dump -w`).

10. **🔔 Interacciones Globales (Notificaciones y Atajos)**
   - **Propósito:** Comunicación proactiva de eventos y navegación acelerada.
   - **Notificaciones:** 
     - **Campana Header:** Polling automático cada 15s al backend para mostrar conteo de alertas no leídas.
     - **Toasts Persistentes:** Las notificaciones de éxito duran 12s, mientras que los **errores permanecen fijos** hasta que el usuario los cierra manualmente.
     - **Panel Histórico:** Desplegable que permite marcar alertas como leídas y revisar logs rápidos de inventario.
   - **Shortcuts (Atajos de Teclado):** Accesibles con la tecla `?` o el botón en el header (⌨️). Soportan navegación entre módulos (`Alt+1..7`), búsqueda global (`Ctrl+K`), creación rápida de productos y OCs, y cierre de modales con `Esc`.

---

## 🗄️ Modelado de Datos (Arquitectura Backend: `models.py`)

Las tablas troncales hiper-relacionadas del dominio de mercancía son:

1. **`Producto`**: "La Verdad Absoluta". Posee un SKU auto-generado único. Aloja costo estándar, venta recomendada al momento de consulta, y stock base (`qty`). También salva strings serializados en JSON si ameritaran "variantes de modelo".
2. **`Movimiento`**: Sujeto únicamente a Insertar, nunca a Actualizar o Borrar (Audit). Es disparado tras bambalinas por el módulo lógico Service. Graba tanto el monto financiero de la acción como el "motivo textual" de justificación por la diferencia en volumen con respecto al ID del Producto maestro.
3. **`OrdenCompra`**: Representa físicamente el papel/PDF que asocia un solo documento emitido a la imprenta hacia un "Proveedor X" con estados mutables en su ciclo de vida.
4. **`OrdenCompraItem`**: Desacoplado con eliminación en Cascada en caso de borrar la OC, amarra cada renglón a su "id_padre". Retiene las subvariables altamente atomizadas por diseño (por ejemplo, tiene columnas nativas explícitas de `público` y `talla`, en vez de un string JSON combinado masivo). De esta forma se consolida y procesa matemáticamente sin riesgo en el servidor en el momento exacto en que la OC es requerida para el PDF.
5. **`Devolucion`**: pieza (o lote de piezas idénticas) devuelta por un cliente y disponible para re-venderse. FK a `productos` con `ON DELETE SET NULL` (igual que `Movimiento`: borrar el producto maestro no borra el histórico). Guarda `diseno` + `imagen` (nombre del archivo en `uploads/devoluciones/`) porque dos playeras del mismo color y talla pueden tener diseños distintos; `qty`, `precio`, `motivo`, `notas`, `folio_origen` y `estado` (`disponible` | `vendida` | `descartada`, indexado) con `fecha_ingreso`/`fecha_salida`. Los cambios de estado mueven stock y generan su `Movimiento` (ver bitácora 2026-09-30 «Playeras en devolución»).

> **Tipos de dinero (importante):** todas las columnas monetarias (costos, precios, subtotales, montos contables) usan `Numeric(12,2)` — precisión exacta de centavos en PostgreSQL. **Nunca volver a `Float`** (doble binario) para dinero. Al leerlas, SQLAlchemy devuelve `Decimal`: no mezclar con `float` en aritmética ni pasar `Decimal` crudo a columnas JSON (ver bitácora 2026-09-27, hallazgo #6).

---

## 🛡️ Capa de Seguridad (Hardening)

El proyecto ha sido auditado y fortalecido para despliegue en VPS (Hetzner/DigitalOcean):

1. **Aislamiento Docker:** El proceso principal corre bajo un usuario sin privilegios (`appuser`) y la base de datos se consume por la red interna de Docker (`db:5432`). ⚠️ **Pendiente para VPS (verificado 2026-09-27 y confirmado 2026-09-30):** `docker-compose.yml` todavía mapea `5432:5432` al host — se conserva a propósito para herramientas de BD locales, y **advertencia explícita en el propio compose** (decisión del usuario 2026-09-30); eliminarlo es acción obligatoria antes de exponer el VPS (ver guía abajo).
2. **Rate Limiting:** Los endpoints `/auth/login`, `/auth/2fa/verify` y los dos pasos WebAuthn de login (`/auth/webauthn/login/options` y `/auth/webauthn/login/verify`) están protegidos contra ataques de fuerza bruta mediante `slowapi` (**10 intentos/minuto y 100/hora por IP**). El limitador es *proxy-aware* (solo confía en `X-Forwarded-For` si el par inmediato es una IP de red interna) y puede desactivarse sin tocar código con la variable de entorno `RATE_LIMIT_DISABLED=1`.
3. **Seguridad HTTP:** Inyección automática de cabeceras `HSTS`, `X-Frame-Options` (contra clickjacking), y `X-Content-Type-Options`.
4. **Política de Contraseñas:** Validación de complejidad mínima (8+ caracteres, símbolos, mayúsculas) forzada tanto en Frontend como en Backend.
5. **Autenticación en toda la API:** todas las rutas exigen JWT (`Bearer`) con rol verificado (`require_role`), salvo las públicas por diseño: `/health`, `/auth/login`, `/auth/2fa/verify` y los pasos WebAuthn del segundo factor (`/auth/webauthn/login/options` y `/auth/webauthn/login/verify`, que exigen un `temp_token` de 5 min con claim `2fa_pending`). Corregido el 2026-09-27 (hallazgo #10: `/productos`, `/notificaciones` y `/sku/preview` respondían sin token).
6. **Secretos rotados (2026-09-30):** la contraseña de PostgreSQL y la `SECRET_KEY` que estuvieron en el historial de GitHub fueron reemplazadas por valores nuevos (solo viven en `.env`, ignorado por git). Ver bitácora «Rotación de credenciales ejecutada».
7. **Subida de archivos validada (2026-09-30, fotos de devoluciones):** el único punto de subida del sistema (`POST /devoluciones/{id}/imagen` y el `foto` de `POST /devoluciones`, ambos solo admin) valida la extensión declarada contra una lista blanca (`.jpg/.jpeg/.png/.webp`), **verifica la firma binaria real** del contenido (no basta el `Content-Type` ni el nombre), rechaza archivos vacíos y limita a **8 MB**. Los archivos se guardan con nombre generado (`dev_{id}_{uuid4}{ext}`) en `backend/uploads/devoluciones/`, **fuera del árbol que sirve nginx** y solo se entregan por el endpoint autenticado (`GET /devoluciones/{id}/imagen`, `FileResponse`), nunca por URL estática. La carpeta está en `.gitignore`. Al reemplazar una foto, la anterior se borra del disco.

### Guía de endurecimiento para VPS (documentada el 2026-09-30 — ejecución pendiente)

Pasos en orden para publicar en un VPS limpio (Ubuntu/Debian). Decisión del usuario 2026-09-30: **solo documentar** (no se ejecutó nada de esto en la máquina local).

1. **Endurecer el acceso SSH (antes que nada):** crear usuario no root con `sudo`; subir su llave pública (`ssh-copy-id`); en `/etc/ssh/sshd_config` fijar `PermitRootLogin no` y `PasswordAuthentication no`; reiniciar `sshd`.
2. **Firewall (UFW):** permitir solo `22/tcp`, `80/tcp` y `443/tcp`; `ufw enable`. El API (`8000`) y la BD (`5432`) **no** se abren al exterior.
3. **Docker:** instalar Docker Engine + plugin `compose` desde el repositorio oficial; agregar el usuario al grupo `docker`.
4. **Código y secretos en el servidor:** `git clone` del repositorio; `cp .env.example .env` y generar valores **nuevos** (nunca reutilizar los locales): contraseña de BD y `SECRET_KEY` (`python -c "import secrets; print(secrets.token_urlsafe(64))"`). `.env` no se versiona (ya está en `.gitignore`).
5. **`docker-compose.yml` en el servidor:** eliminar el mapeo `5432:5432` (ya marcado con advertencia en el archivo); opcional: quitar también `8000:8000` si el proxy inverso enruta por la red interna de Docker.
6. **Primer arranque:** `docker compose up -d --build` (el build es estricto en TLS; no usar `PIP_EXTRA`, que es solo para la máquina local con antivirus). Con BD vacía, definir `ADMIN_INITIAL_PASSWORD` antes del primer arranque (o tomar la contraseña aleatoria única del log) y cambiarla al primer inicio de sesión. Con BD existente, `alembic current` debe responder `c4d9e7a12f63 (head)` (revisión vigente desde 2026-09-30: tabla `devoluciones`; la anterior era `a3f8c2d91b47`, passkeys).
7. **Traefik + SSL:** proxy inverso con certificados Let's Encrypt para el frontend (y opcionalmente la API); el tráfico directo a puertos internos queda cerrado por UFW.
8. **Respaldos:** el scheduler del backend ya corre solo (cada 24 h, 7 copias, carpeta `backups/` montada al host); se recomienda copiarlas periódicamente fuera del VPS.
9. **Verificación post-despliegue:** `/health` → 200; login normal; catálogo carga; y desde fuera, `curl` sin token a `/productos` → 401.

#### Variante rápida: migrar todo desde un snapshot (documentada y verificada el 2026-09-30)

Si se quiere llevar **el proyecto completo con datos** en un solo archivo, `snapshot.py` (raíz) genera `versiones_seguras/Inventario_Snapshot_<fecha>.zip` con: todo el código, `.env` local, `backups/` y `base_de_datos_snapshot.sql` (dump `pg_dump --no-owner --no-privileges`). ⚠️ El ZIP **incluye los secretos locales** (rotarlos en el VPS) y `backend/.venv` (venv de Windows, inútil en Linux: borrarlo). Snapshot de referencia: `Inventario_Snapshot_20260930_232316.zip` (11,5 MB; 1.766 archivos; incluye passkeys, sello `c4d9e7a12f63`, `conteo.js` v1.1.0, `devoluciones.js` v1.1.0 y `nginx/frontend.conf`; generado tras el commit `97c1d59`).

Las fotos de las devoluciones **sí viajan dentro del ZIP**: el `os.walk` de `snapshot.py` solo excluye las carpetas `.git`, `__pycache__`, `venv`, `node_modules`, `versiones_seguras`, los archivos `~$*` y las extensiones `.zip`/`.pyc`, por lo que `backend/uploads/devoluciones/` se empaqueta completo (verificado en código el 2026-09-30). En el ZIP de referencia no hay entradas `uploads/` simplemente porque aún no existe ninguna foto real (el E2E se autolimpió); el módulo y su migración sí están incluidos.

Secuencia verificada (sustituye a los pasos 4–6 anteriores):

1. Copiar el ZIP al VPS (`scp`), descomprimir en la carpeta del proyecto y `rm -rf backend/.venv`.
2. **Editar ANTES del primer arranque** (el `.env` del ZIP trae los valores locales): (a) `docker-compose.yml`: eliminar `5432:5432`; (b) `.env`: contraseña de BD nueva (actualizarla también dentro de `DATABASE_URL`), `SECRET_KEY` nueva y **agregar** las claves `WEBAUTHN_RP_ID=<dominio sin esquema>`, `WEBAUTHN_RP_NAME=Inventario Pro`, `WEBAUTHN_ORIGIN=https://<dominio>` (el `.env` local no las trae y sin ellas quedarían en `localhost`); (c) `frontend/app.js` línea 1: apuntar `const API` a la URL real del API (por defecto usa `hostname:8000`, puerto que en el VPS no queda expuesto).
3. **Restaurar la BD en orden seguro** — NO usar `python snapshot.py restore`: ese script arranca la app antes de restaurar el SQL y el seed podría chocar con los datos del dump. Orden correcto:
   - `docker compose up -d db` y esperar a que `pg_isready` responda dentro del contenedor;
   - `docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < base_de_datos_snapshot.sql`;
   - verificar conteos con un `SELECT count(*)` de control; y
   - `docker compose up -d --build` (build estricto en TLS, sin `PIP_EXTRA`).
4. **Post-arranque:** `alembic current` → `c4d9e7a12f63`; **permisos de escritura en Linux** — los bind mounts sí respetan el propietario del host, y la app corre como `appuser` (`uid/gid 999`): `sudo chown -R 999:999 backend/uploads backups` (carpetas donde escribe fotos de devoluciones y respaldos; en Docker Desktop de Windows/Mac no aplica porque el montaje es permisivo); resetear la contraseña del admin con `ADMIN_RESET_PASSWORD` (el script también borra sus passkeys); las passkeys registradas en `localhost` **no funcionan** bajo el dominio nuevo (cambió el RP ID): volver a registrarlas desde el botón 🔑. Continuar con los pasos 1–3, 7–9 de esta guía (SSH, UFW, Traefik+SSL, respaldos, verificación).

---

## 🤖 Directrices de Continuidad y Reglas Bases de Operación

Cualquier agente que modifique este proyecto DEBE alinear sus procesos al siguiente estándar para evitar romper las integraciones actuales:

1. **No mezclar Frameworks Web JS:** Mantener y fomentar funciones tradicionales del DOM tipo `getElementById()`, literales de plantillas con `\`\` ` y clases compartidas para lograr manipulación in-situ. Evítese por encima de todo importar bibliotecas o "binders reactivos" en JavaScript. 
2. **Refactor de Base de Datos Alembic:** Cuando en una nueva característica de *roadmap* se requiera una nueva clase de BD o alterar tipos de variables, JAMÁS alteres el schema de SQLite directo. Altera en `models.py` y dispara el flujo Alembic para asegurar sincronía entre entornos Dev/Docker.
3. **Persistencia sobre la capa Servicios:** Los enrutadores (`main.py`) están estrictamente pensados para recibir datos JSON mediante inyección Pydantic, y de ahí redirigirlos en forma de dict o modelo hacia las funciones robustas en `services.py`. Abstengase de pegar código "Fat-Controller" de +40 líneas dentro del endpoint de API mismo.
4. **Respeta los `// === SEPARADORES ===` en Frontend:** Los archivos JS han alcanzado tallas de >1k líneas. Utilizar y respetar cabeceras visuales de demarcación de bloques al introducir métodos nuevos para evitar un caos en la lectura. Mantener el encapsulamiento funcional.
5. **Generador y Scanner Universal de SKU:** Siempre que agregues cualquier botón UI o input capaz de manejar mercancía nueva o vieja, inyéctale los callbacks de `onScannerEnter()` unificando la usabilidad. Nunca dependas de botones tipo "Aceptar Scanner". Si está en la variable de texto "terminada en enter/carry Return" asúmalo ejecutado.


---

## 📄 Archivo: `ROADMAP.md`

# 🗺️ Roadmap — Inventario Pro (Kromo Pinceles)

> Bitácora de ideas, mejoras y progreso para la aplicación de inventario.
> Última actualización: 2026-03-31

---

## ✅ Mejoras Implementadas (Completadas)

### 1. Dashboard con KPIs Visuales
- **Progreso:** 100% Completado.
- Gráficas de ventas por diferentes periodos (7d, 30d, 90d) usando Chart.js.
- Visualización de productos más vendidos y tendencias de stock.
- KPIs principales: Ventas Hoy, Ventas del Mes, Margen Promedio, y Alertas de Stock.

### 2. Códigos de Barras y Escaneo USB
- **Progreso:** 100% Completado.
- Generación visual de códigos de barras basados en SKU para etiquetas físicas.
- Integración full-duplex con escáneres USB en "Registro de Venta" y "Órdenes de Compra" (Auto-selección y agregación rápida sin clics).

### 3. Automatización de Banco de Precios (Carga Masiva Excel)
- **Progreso:** 100% Completado.
- Parseo avanzado de Excel para extraer, unificar y agrupar productos con jerarquías.
- Extracción inteligente de colores compuestos y tallas desde las descripciones, automatizando precios y costos de miles de variantes.

### 4. Filtro y Estados de Órdenes de Compra
- **Progreso:** 100% Completado.
- Estados de Borrador, Enviada, Confirmada y Cancelada. Filtro unificado.
- PDF dinámico con consolidación automática de variantes para envío a proveedores.
- Solución completa de persistencia de items al guardar la orden.

### 5. Exportar Inventario a Excel/CSV Mejorado
- **Progreso:** 100% Completado.
- Exportación estructurada directa (a .xlsx) usando ExcelJS.
- Inserción de formato nativo, celdas de colores para alertas de stock y formatos configurables.
- **Mejora 2026-03-28:** Ordenamiento inteligente en el Excel: los productos con stock aparecen primero; los agotados al final.

### 6. Búsqueda Global Omnipresente (Ctrl+K)
- **Progreso:** 100% Completado.
- Modal global accionado en cualquier lugar del DOM con `Ctrl+K`.
- Resultados predictivos con navegación por teclado (flechas y Enter) que dirige la acción acorde a la página activa.

### 7. Alertas Automáticas y "Reposición con 1 clic"
- **Progreso:** 100% Completado.
- Sistema de notificación flotante que detecta stock bajo en tiempo real.
- Botón inteligente de reposición que pre-llena una Orden de Compra con cantidades sugeridas (3x stock mínimo) para todos los productos en alerta.

### 11. Notas Internas y Proveedores Alternativos en Productos
- **Progreso:** 100% Completado.
- Añadidos campos `notas_internas` y `proveedores_alternativos` a la ficha del producto.
- Sistema de burbuja de notificaciones con historial persistente (Marcado de lectura).

### 12. Módulo de Contabilidad, Finanzas e Integración de MSI
- **Progreso:** 100% Completado.
- Creada tabla `contabilidad_transacciones` para llevar control de gastos puros e ingresos directos (comisiones).
- Las Órdenes de Compra soportan Ropa, Insumos y Equipos, capturando campos nuevos de Marca y Canal.
- Cálculo automático de Meses Sin Intereses (MSI): al autorizar una OC a MSI, se deduce el monto prorrateado proyectándolo a los meses correspondientes sin afectar la rentabilidad del mes corriente. El reparto es **exacto al centavo**: cuotas iguales de 2 decimales y la última absorbe el ajuste, de modo que la suma de las cuotas siempre equivale al total de la OC (`services.cuotas_msi`).
- CRUD para gestionar un Catálogo recurrente de Insumos (vinil, cajas, hilos).

---

## 🔥 Prioridad Alta — Alto Impacto (En Progreso / Siguiente)

### 8. Historial de Precios por Producto
- **Progreso:** 100% Completado.
- Tabla `historial_precios` en la BD que guarda automáticamente cada cambio de costo o precio de venta.
- El backend detecta la variación al actualizar un producto y registra el registro anterior vs nuevo con timestamp.
- Botón 🕒 en la fila de cada variante abre un modal con el historial completo de cambios.
- Ayuda a detectar cuándo suben precios los proveedores y ajustar márgenes en tiempo real.

---

## 💡 Prioridad Media — Calidad de Vida (Planificadas)

### 9. Modo "Conteo Físico" / Inventariado
- **Progreso:** 100% Completado.
- Pantalla dedicada con escaneo USB ciego para contar inventario físico sin ver el stock lógico.
- Lista diferencial en tiempo real: Sistema (teórico) vs Físico (contado), con chips de color por estado (✅ OK / ⚠️ Diferencia).
- Botón de ajuste masivo aplica todos los movimientos correctores de una sola vez.
- **Conteo por Plantilla Excel (`conteo.js` v1.1.0):** descarga una plantilla `.xlsx` generada al momento (solo colores con stock ≥ 1, con todas sus tallas; sin columna «Sistema» — conteo ciego) y reimporta el archivo lleno para cargar el conteo con la tabla de diferencias y avisos de filas inválidas. Reglas: celda vacía = omitir; `0` = ajustar a cero.

### 10. Duplicar Órdenes de Compra
- **Progreso:** 100% Completado.
- Botón "📋 Duplicar" en cada orden de compra (cualquier estado).
- Endpoint `POST /ordenes-compra/{id}/duplicar` que clona proveedor, notas e items en un nuevo borrador con folio único.
- Registro en audit log con folios original y nuevo.

### 11. Notas Internas y Proveedores Alternativos en Productos
- **Progreso:** 100% Completado.
- Campos `notas_internas` y `proveedores_alternativos` editables en el modal del producto con `<textarea>` estilizados.
- Tooltips mejorados con hover popup animado (glassmorphism oscuro) en la tabla de inventario.
- Búsqueda global incluye contenido de notas y proveedores.

---

## 🚀 Prioridad Futura — Inteligencia y Proyecciones

### 12. Proyección de Stock Inteligente / IA de Compras
- **Progreso:** 0% (Planificado).
- Motor de cálculo que evalúa la velocidad de venta diaria y cruza con el stock actual, para avisar cuántos días quedan antes de "quiebre de inventario". Sugiere cantidad a comprar óptima.

### 13. Margen Rentabilidad Avanzado
- **Progreso:** 10% (Global en dashboard hecho, pero profundo por variante no).
- Cruzar el canal de venta vs variante para saber qué talla de qué color deja más o menos dinero porcentualmente, a fin de descontinuar lo no rentable.

---

## 🔐 Seguridad y Operación Confiable (Funcionalidades 14 — 21)

> Estas funcionalidades fueron agregadas en 2026-03-28 como respuesta a la madurez operativa de la app.
> Se numeran a partir del #14 para preservar la cronología de ideación, aunque algunas tienen **prioridad de implementación muy alta** (como #14 y #15).

### 14. Autenticación de Usuarios (Login / Sesiones)
- **Progreso:** 100% Completado.
- Login con usuario y contraseña protegido por hash `passlib[pbkdf2_sha256]`.
- Sesión en el Frontend mediante `JWT` almacenado en `localStorage`.
- Backend valida el token en cada request con un `Depends(get_current_user)` de FastAPI.

### 15. Control de Roles y Permisos (RBAC)
- **Progreso:** 100% Completado.
- Roles implementados: `admin` (acceso total), `vendedor` (POS y consulta de stock), `bodeguero` (ajustes y conteo físico).
- Cada endpoint del backend revisa el rol garantizado por la dependencia `require_role()`.
- La UI oculta/muestra los reportes, órdenes de compra y vistas según el `rol` almacenado.

### 16. Registro de Auditoría (Log de Acciones de Usuario)
- **Progreso:** 100% Completado.
- Nueva tabla `audit_log` en la BD: quién hizo qué y cuándo (usuario, acción, timestamp, IP de origen).
- Registra eventos sensibles: logins, edición de precios, eliminación de productos, ajustes de stock.
- Sección de solo lectura en el panel de Admin para revisar el historial de acciones con KPIs y badges de color.
- Filtros avanzados por acción, usuario, fechas y paginación. Exportable a CSV.

### 17. Bloqueo de Sesión por Inactividad
- **Progreso:** 0% (Planificado). 🔶 **Prioridad Media**
- Temporizador JavaScript de inactividad (~15 minutos configurable).
- Al agotarse muestra una pantalla de bloqueo que exige reingreso de contraseña antes de devolver el control.
- Previene accesos no autorizados si el operador deja la terminal abierta.

### 18. Respaldo Automático de la Base de Datos
- **Progreso:** 100% Completado. 🟢
- Script de `pg_dump` ejecutado automáticamente cada 24 horas usando `lifespan` y `asyncio`.
- **Mejora 2026-03-31:** Se implementó el flag `-w` y el uso de `PGPASSWORD` para automatización real sin prompts.
- Endpoints de Admin para listar respaldos, disparar un respaldo manual y descargar el archivo `.sql` vía interfaz.
- **Doble Seguridad:** Retención rotativa de seguridad.
- **Restauración Inteligente:** Función de restauración rápida con backup de seguridad automático (`pre_restore`) antes de realizar Wipe & Restore.

### 19. Validación y Sanitización de Entradas (Endurecimiento del API)
- **Progreso:** 60% Completado.
- Pydantic activo con validación de schemas.
- Cabeceras de seguridad HTTP implementadas: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`.
- `slowapi` (Rate Limiter) **reactivado el 2026-09-27** con límites seguros (`10/minute;100/hour` por IP) en `/auth/login`, `/auth/2fa/verify` y los endpoints WebAuthn de login (2026-09-30). Se eliminó el límite agresivo de 5/hora causante de la incidencia 2026-03-30. No hay límites globales ni middleware (el polling de `/notificaciones` no se ve afectado). Interruptor de emergencia: env `RATE_LIMIT_DISABLED=1`.
- Pendiente: `max_length` y rangos numéricos explícitos en schemas Pydantic, `Content-Security-Policy`.

### 20. Verificación de Integridad y Prevención de Corrupción de BD
- **Progreso:** 0% (Planificado). 🔶 **Prioridad Media**
- Implementar rutinas automáticas para chequeo de estructura (e.g. `pg_checksums` o scripts de monitoreo interno).
- Detección proactiva de registros huérfanos garantizando consistencia completa en llaves foráneas (FKs).
- **"Dry-run backups":** Mecanismo para probar silenciosamente que un respaldo funciona (descomprimiéndolo en un esquema o base de pruebas) antes de marcarlo como "Válido" para uso del sistema.
- Alertas de umbrales críticos de tamaño y bloqueos prolongados (deadlocks) en consultas concurrentes.

### 21. Autenticación de Dos Factores (2FA: TOTP + Passkeys)
- **Progreso:** 100% Completado.
- Implementación completa de TOTP usando `pyotp` con compatibilidad con Google Authenticator y Authy.
- Flujo de setup: Botón 🔐 en la barra superior → genera QR + secreto → usuario escanea y confirma con primer código.
- Flujo de login: Credenciales → Token temporal de 5 min → Pantalla de verificación 2FA → JWT final.
- Ventana de tolerancia de ±2 intervalos (`valid_window=2`) para compensar desfase de reloj.
- Endpoints TOTP: `/auth/2fa/setup`, `/auth/2fa/enable`, `/auth/2fa/verify`.
- Panel de Admin permite desactivar 2FA de cualquier usuario.
- Script de emergencia `reset_admin_2fa.py` para resetear 2FA + contraseña del admin desde el contenedor Docker (desde 2026-09-30 también elimina las passkeys del usuario).
- **Passkeys (WebAuthn/FIDO2, implementadas el 2026-09-30):** segundo factor que **convive** con el TOTP (no lo sustituye); el usuario elige en pantalla según los métodos que tenga configurados.
  - La llave privada **nunca sale del dispositivo** (Windows Hello, Touch ID, llave USB); el servidor guarda solo la llave pública en `webauthn_credentials` (migración Alembic `a3f8c2d91b47`).
  - Endpoints de gestión (autenticados): `POST /auth/webauthn/register/options`, `POST /auth/webauthn/register/verify`, `GET /auth/webauthn/credenciales`, `DELETE /auth/webauthn/credenciales/{id}`.
  - Endpoints de login (públicos, exigen `temp_token` con claim `2fa_pending`; rate limit `10/min;100/h`): `POST /auth/webauthn/login/options`, `POST /auth/webauthn/login/verify` (emite el JWT final).
  - Seguridad: `user_verification=required` (huella/PIN obligatorios en el dispositivo), retos en memoria con TTL de 5 min y verificación de `sign_count` contra clonación.
  - Gestión desde la UI: botón 🔑 «Passkey» en la barra lateral (visible solo si el navegador puede usarlas) → registrar este dispositivo / listar / eliminar.
  - **Requiere contexto seguro:** funciona en `localhost` o HTTPS; **no** en IP plana por LAN. Para el VPS definir `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME` y `WEBAUTHN_ORIGIN` en `.env` (ver `.env.example`).
- **Incidencia 2026-03-30:** El Rate Limiter bloqueó el login tras múltiples pruebas de 2FA. Se deshabilitó temporalmente y se ejecutó reset de emergencia. **Resuelto el 2026-09-27:** reactivado con límites seguros (10/min;100/h) y kill-switch por env.

## 📝 Historial de Revisiones / Bitácora

| Fecha       | Evento Clave Registrado                                                               |
|-------------|---------------------------------------------------------------------------------------|
| 2026-03-27  | Documento de Roadmap Inicial creado (10 ideas base).                                  |
| 2026-03-27  | Implementación de KPIs visuales en Dashboard con gráficas.                            |
| 2026-03-28  | Fixes Mayores en Órdenes de Compra (Estados y items fantasma en modal).               |
| 2026-03-28  | Inyección masiva de precios unificados vía Excel; Lógica del parser lista.            |
| 2026-03-28  | Soporte 100% de Lector de código de barras USB para Ventas/Compras.                   |
| 2026-03-28  | Roadmap actualizado: Categorización de progresos y expansión de ideas.                |
| 2026-03-28  | Exportación a ExcelJS (colores y formatos de stock de celdas).                        |
| 2026-03-28  | Implementación de Búsqueda Global Omnipresente (Ctrl+K) - Fix Reactividad.            |
| 2026-03-28  | Sistema de Alertas Flotantes y Reposición con 1-Clic liberado.                        |
| 2026-03-28  | Notas Internas, Proveedores Alternativos y Burbuja de Notificaciones.                 |
| 2026-03-28  | Historial de Precios: tabla BD + detección automática en services + modal frontend.   |
| 2026-03-28  | Modo Conteo Físico: página ciego con escaneo, diferencial y ajuste masivo.            |
| 2026-03-28  | Excel ordenado: productos con stock al inicio, agotados al final.                     |
| 2026-03-28  | Roadmap expandido con 6 funcionalidades de Seguridad (ítems #14 al #19).              |
| 2026-03-28  | **Sistema de Autenticación JWT y RBAC**: Implementado en Backend y Frontend.          |
| 2026-03-28  | **Fix de Seguridad**: Resuelto error de 72 bytes en hashing y cuelgue de lifespan API.|
| 2026-03-28  | **Optimización Docker**: Habilitado --reload en backend para desarrollo fluido.       |
| 2026-03-28  | **Actualización:** Requerir password al crear usuario y doble confirmación.           |
| 2026-03-28  | **Log de Auditoría Premium:** KPIs visuales, badges por acción, tabs y filtros.       |
| 2026-03-28  | **Respaldo Automático 24h**: Descarga, creación manual, retención de 7 archivos.      |
| 2026-03-28  | **Restauración de BD**: Funcionalidad Wipe & Restore con safety backup automático.    |
| 2026-03-28  | **UI Premium**: Rediseño vertical de Backups usando parámetros *Luminous Ledger*.     |
| 2026-03-29  | **Auditoría de Seguridad VPS**: Documento `SECURITY_AUDIT.md` creado con hallazgos.   |
| 2026-03-29  | **Etiquetas PNG**: Migración de generación de etiquetas de barras de PDF a PNG.        |
| 2026-03-30  | **2FA (TOTP) Implementado**: Setup QR, verificación con tolerancia, flujo completo.   |
| 2026-03-30  | **Rate Limiter (SlowAPI)**: Integrado para proteger login (5 intentos/hora).          |
| 2026-03-30  | **Cabeceras de Seguridad HTTP**: `HSTS`, `X-Content-Type-Options`, `X-Frame-Options`. |
| 2026-03-30  | **🚨 Incidencia**: Rate Limiter bloqueó login tras pruebas masivas de 2FA.            |
| 2026-03-30  | **Script `reset_admin_2fa.py`**: Herramienta de emergencia para resetear admin.       |
| 2026-03-31  | **Sidebar Navigation**: Transición a diseño empresarial *Lumina Glass* colapsable.    |
| 2026-03-31  | **Estabilización Administrativa**: Fix en renderizado de usuarios y backups 24h.      |
| 2026-03-31  | **Sincronización 2FA/Usuarios**: Consolidación de IDs y lógica de navegación.  |
| 2026-03-31  | **Reset de Emergencia**: Script `reset_admin_2fa.py` verificado y funcional.         |
| 2026-03-31  | **UI de Notificaciones**: Implementación de campana, panel y toasts dinámicos.       |
| 2026-03-31  | **Validación de Passwords**: Ajustada a min 8 caracteres por petición de usuario.    |
| 2026-04-01  | **Login y 2FA Estabilizados**: Fix de bloqueo JS en formulario 2FA y fondo rediseñado con gradiente oscuro *Lumina Glass*. |
| 2026-04-01  | **Restauración de Historial**: Fix crítico eliminando overrides visuales rotos; recupera funcionalidad analítica y exportación de tickets PDF. |
| 2026-04-01  | **Sincronización de Notificaciones**: Match reestablecido entre la maqueta UI de la Campana y los eventos de polling de alertas en `app.js`. |
| 2026-04-01  | **Shortcuts de Teclado**: Panel de atajos (`Ctrl+K`, `Ctrl+N`, `Alt+1..7`, `?`, `Esc`) con modal premium, botón integrado en el header y botón rojo para cerrar modal. |
| 2026-04-01  | **Notas Internas y Proveedores Alt.**: Campos `textarea` en modal de producto + tooltips hover mejorados en inventario. |
| 2026-04-01  | **Duplicar OC**: Endpoint `/ordenes-compra/{id}/duplicar` + botón "📋 Duplicar" para todas las órdenes. |
| 2026-06-01  | **Fix de Interfaz y Cobro**: Corrección de error de objeto nulo `Cannot set properties of null (setting 'textContent')` al procesar cobros en `app.js`. |
| 2026-06-01  | **Eliminación de Ventas**: Opción de eliminar ventas registradas desde la interfaz, recalculando y deduciendo ingresos en tiempo real. |
| 2026-06-01  | **Corrección de Indicadores POS**: Fix en visualización de KPIs de ventas/ingresos de hoy y del mes en el panel POS al cargar la vista. |
| 2026-06-01  | **Métrica de Unidades Disponibles**: Agregado el KPI "Unidades Disponibles" en el módulo Inventario que calcula la suma del stock total. |
| 2026-06-01  | **Fix de Variantes `[object Object]`**: Corrección del tipado en el esquema Pydantic (`backend/app/schemas.py`) permitiendo `List[Any]` para soportar correctamente objetos `{val, sku}`, y fix en `editProducto()` y `saveProducto()` de `frontend/app.js` al procesar y almacenar variantes existentes. |
| 2026-06-01  | **Variación Rápida de Productos**: Creación de botones contextuales `🎨 + Color` (nivel padre) y `📐 + Talla` (nivel color) con un nuevo modal dinámico `overlay-variante-rapida` para agregar variantes directamente desde la tabla de inventario con herencia de datos del padre. |
| 2026-06-02  | **Precios Diferenciados Menudeo/Mayoreo**: Se agregó el campo `costo_menudeo` a la base de datos para Playeras y Sudaderas. Integración en `oc.js` para aplicar automáticamente costo de menudeo (≤11 pzas) o mayoreo (≥12 pzas) al crear/editar Órdenes de Compra, manteniendo la capacidad de sobreescribir precios manualmente. |
| 2026-06-02  | **Corrección de Carga de Precios**: El script `create_inventory_from_excel.py` ahora lee e inserta correctamente las columnas de Menudeo y Mayoreo directamente a la base de datos `inventario_db`. |
| 2026-06-02  | **Actualización Segura de Precios**: Se creó el script `backend/update_prices.py` para actualizar `costo` y `costo_menudeo` de los productos existentes leyendo `precios.xlsx`, sin borrar ni sobrescribir el inventario actual (evitando pérdida de datos de ventas/existencias). |
| 2026-06-02  | **Edición Manual de Mayoreo/Menudeo**: Se modificó el formulario de agregar/editar productos en `index.html` y `app.js` para exponer "Precio Mayoreo" y "Precio Menudeo" directamente en la interfaz, permitiendo modificarlos manualmente sin depender de la importación desde Excel. |
| 2026-06-02  | **Ventas Recientes y Folios Automáticos**: Se solucionó el error donde ventas con múltiples productos se mostraban fragmentadas. Ahora en "Ventas Recientes" se agrupan por ticket (folio) y se procesan como un solo bloque. Se implementó autogeneración de folios no editables (formato `YYYYMMDD-CANAL-HHMMSS`) en el PDF del ticket (`app.js`). |
| 2026-06-02  | **UI de Ventas Recientes**: Se rediseñó la UI de "Ventas Recientes" para mostrar las ventas como globos con colores únicos por ticket (basado en hash del folio). Se agregó botón global para eliminar toda la venta agrupada, y un nuevo botón "📥 Ticket" que permite volver a descargar el PDF con la función `descargarTicketReciente`. Además, se alargó el contenedor de ventas recientes a `650px` con scroll interno en `index.html`. |
| 2026-06-02  | **Validación de Backend (Gestión de Ventas)**: Se revisó y confirmó que los endpoints `/ventas-agrupadas`, `/ventas/devolver` y `/ventas/cancelar-completo/{folio}` junto con sus funciones en `services.py` están correctamente implementados y funcionales. El error 404 reportado anteriormente era un falso positivo. Se procede a crear la UI dedicada en el Frontend. |
| 2026-06-02  | **Frontend - Módulo Gestión de Ventas**: Se completó la implementación UI del módulo "Gestión de Ventas" (`#page-gestion_ventas`) en `index.html` y `app.js`. Se conectaron exitosamente los métodos `loadVentasAgrupadas`, `descargarTicketPDF`, `cancelarVentaCompleta` y `confirmarDevolucionParcial`. Los errores pendientes de `Pending Errors` respecto a la interfaz y API integration han sido resueltos. |
| 2026-06-02  | **Resolución de Error 404 en Ventas Agrupadas**: Se detectó que el servidor FastAPI dentro del contenedor de Docker `inventario_api` requería reinicio para cargar las nuevas rutas expuestas en `main.py`. Se reinició el contenedor (`docker compose restart backend`) y se verificó que la pestaña Gestión de Ventas carga exitosamente y realiza transacciones de devolución/cancelación. |
| 2026-06-02  | **Corrección en Tickets y Redondeo de Moneda**: 1) Se solucionó el problema por el cual los tickets PDF se descargaban vacíos ($0.00) debido a un desfase en el nombre del atributo de items (`cart` vs `detalles`); ahora se envían y aceptan ambos atributos de forma compatible. 2) Se forzó el redondeo a exactamente 2 cifras decimales en la función de formato `mxn` agregando el atributo `maximumFractionDigits: 2`, corrigiendo el valor de ticket promedio de $404.444 a $404.44. |



---

## 📄 Archivo: `SECURITY_AUDIT.md`

# Guía de Auditoría y Mitigación de Seguridad: Inventario Pro

Este documento detalla los hallazgos de seguridad encontrados en el análisis de la aplicación y proporciona una guía para mitigar brechas al desplegar en un VPS (Hetzner) accesible mediante Nginx/Traefik y SSL (Let's Encrypt).

## 1. Hallazgos del Análisis Actual

> **Cierre de auditoría (2026-09-27):** los 10 hallazgos de código (#1–#10) quedaron corregidos y verificados (ver bitácora principal). El estado de los hallazgos de infraestructura de abajo fue reconciliado ese día contra el repositorio real.

### Infraestructura y Docker — Estado Real Verificado (2026-09-27)
- **~~Usuario Root~~**: ✅ Resuelto. `backend/Dockerfile` crea `appgroup`/`appuser` y los procesos corren con `USER appuser` (no-root).
- **~~Secretos Hardcodeados~~**: ✅ Resuelto. `SECRET_KEY` y `DATABASE_URL` ya no están en `docker-compose.yml`; se inyectan vía `env_file: .env` (ignorado por Git). Nota: el commit histórico `ad9b1e7` todavía contiene la URL con contraseña; al publicar el repo, rotar esa credencial en el VPS.
- **~~Modo Desarrollo~~**: ✅ Resuelto. El backend ya no usa `--reload` (`command: uvicorn app.main:app --host 0.0.0.0 --port 8000`). El bind-mount `./backend:/app` se conserva a propósito para el flujo de desarrollo.
- **⚠️ Puerto 5432 Expuesto (único pendiente de infraestructura)**: `docker-compose.yml` conserva `- "5432:5432"` para conexiones locales (herramientas de BD y backend fuera de Docker). **Acción obligatoria antes de desplegar en VPS:** eliminar ese mapeo (una línea); el backend se conecta por la red interna de Docker y no lo necesita. En un host público es vulnerabilidad crítica si la contraseña es débil o hay exploits de PostgreSQL.

### 🟢 Aplicación (Backend) — Mitigaciones Aplicadas
- **~~Endpoints sin autenticación~~**: ✅ Corregido el 2026-09-27 (hallazgo #10 de la auditoría): `GET /productos`, `/notificaciones` (GET/PUT/DELETE) y `GET /sku/preview` ahora exigen JWT con rol verificado (`require_role`). Públicos por diseño: `/health`, `/auth/login`, `/auth/2fa/verify` y los pasos WebAuthn del segundo factor (`/auth/webauthn/login/options` y `/auth/webauthn/login/verify`, protegidos por `temp_token` de 5 min).
- **~~Falta de Rate Limiting~~**: ✅ Implementado con `slowapi`. **Reactivado el 2026-09-27** tras la pausa por la incidencia 2026-03-30, ahora con límites seguros `10/minute;100/hour` por IP en `/auth/login`, `/auth/2fa/verify` y los endpoints WebAuthn de login. Key-func *proxy-aware* (valida `X-Forwarded-For` solo si el peer es IP privada) y kill-switch `RATE_LIMIT_DISABLED=1`. El 429 devuelve `{"error": "<mensaje en español>"}` y el frontend lo muestra en el recuadro de error del login.
- **~~Política de Contraseñas Débil~~**: ✅ Validación implementada en `services.py:validar_password()` — mínimo 8 caracteres, letras, números y caracteres especiales.
- **JWT Estático**: El tiempo de expiración es de 8 horas, pero no hay un sistema de "Revocación" o "Refresh Tokens" para sesiones robadas. ⚠️ Pendiente transferido al endurecimiento de VPS.
- **~~Cabeceras de Seguridad HTTP~~**: ✅ Implementadas: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`.

### 🚩 Frontend
- **Potencial XSS (pendiente menor, verificado 2026-09-27)**: los textos se interpolan en plantillas `innerHTML` sin helper de escape (no existe `escapeHtml` en el frontend). Vector acotado (los textos provienen de usuarios autenticados), pero se recomienda un helper de escape al renderizar nombres/notas.

---

## 2. Guía de Mitigación (Plan de Acción)

### A. Endurecimiento del VPS (Hetzner / Ubuntu)
1.  **Firewall (UFW)**: 
    - `ufw default deny incoming`
    - `ufw allow 22/tcp` (SSH)
    - `ufw allow 80/tcp` (HTTP para validación de certificados)
    - `ufw allow 443/tcp` (HTTPS)
    - `ufw enable`
2.  **SSH Seguro**: Cambiar puerto 22 o usar solo llaves SSH (desactivar `PasswordAuthentication`).
3.  **Fail2Ban**: Instalar y configurar para bloquear IPs que intenten SSH repetidamente.

### B. Configuración de Red (Traefik + Nginx)
Se recomienda la siguiente jerarquía:
- **Traefik**: Actúa como punto de entrada único, gestiona certificados Let's Encrypt automáticamente y redirige a Nginx o directamente al backend.
- **Cabeceras de Seguridad**: Configurar en Traefik/Nginx:
    - `Strict-Transport-Security (HSTS)`
    - `X-Content-Type-Options: nosniff`
    - `X-Frame-Options: DENY`
    - `Content-Security-Policy (CSP)`

### C. Seguridad en el Código (FastAPI)
- **~~Rate Limiting~~**: ✅ Implementado (2026-09-27): `10/minute;100/hour` por IP en `/auth/login`, `/auth/2fa/verify` y los endpoints WebAuthn de login con `slowapi`; mensaje de error en español y kill-switch `RATE_LIMIT_DISABLED=1`. Se descartó el bloqueo de 1 hora tras 3 intentos por considerarse demasiado agresivo (fue la causa de la incidencia 2026-03-30).
- **Validación de Datos**: Usar Pydantic para asegurar que no se inyecten scripts en los campos de texto.
- **Secrets**: Usar un archivo `.env` con permisos restringidos (`chmod 600`) y cargarlos dinámicamente.

### D. Seguridad en Docker
- **Non-Root User**: Modificar el Dockerfile para usar un usuario `appuser`.
- **Isolation**: La base de datos solo debe estar en la red interna de Docker (`networks: internal`).

---

## 3. Recomendaciones de Futura Implementación

### 🛡️ ~~Autenticación de Dos Factores (2FA)~~
✅ **Implementado (2026-03-30)**. TOTP completo usando `pyotp`. Compatible con Google Authenticator y Authy.
- Setup: Botón 🔐 en barra superior → QR + secreto → confirmación con primer código.
- Login: Credenciales → Token temporal (5 min) → Verificación TOTP → JWT final.
- Tolerancia de ±2 intervalos para desfase de reloj.
- Script de emergencia: `reset_admin_2fa.py`.

### 🛡️ Captcha
Integrar **Cloudflare Turnstile** en la página de login. Es menos intrusivo que Google reCAPTCHA y ofrece una capa de protección contra bots automatizados.

### 🛡️ Cifrado en Reposo
Si decides guardar DNI o teléfonos, usa la librería `cryptography` de Python para cifrar esos campos específicos antes de guardarlos en PostgreSQL.

---

## 4. Incidencias Registradas

| Fecha       | Incidencia                                              | Resolución                                                  |
|-------------|--------------------------------------------------------|-------------------------------------------------------------|
| 2026-03-30  | Rate Limiter (`slowapi`) bloqueó login de admin         | Deshabilitado temporalmente + reset de 2FA + re-hash de     |
|             | tras múltiples pruebas consecutivas de 2FA              | contraseña via `reset_admin_2fa.py` ejecutado en contenedor  |
| 2026-09-27  | Rate Limiter reactivado (fix definitivo)                | Límites seguros `10/minute;100/hour`, key-func proxy-aware,  |
|             |                                                         | handler 429 en español, kill-switch `RATE_LIMIT_DISABLED=1` |

### Archivos modificados en el fix de emergencia (2026-03-30):
- `backend/app/main.py` — SlowAPI comentado (imports, middleware, handler)
- `backend/app/reset_admin_2fa.py` — Script actualizado: resetea 2FA + contraseña + estado activo

### Archivos modificados en la reactivación (2026-09-27):
- `backend/app/main.py` — Limiter activo con `enabled` por env, key-func `_client_ip` (proxy-aware), handler `_rate_limit_handler` (429 en español) y decoradores `@limiter.limit("10/minute;100/hour")` en `/auth/login` y `/auth/2fa/verify`
- `frontend/app.js` — `doLogin` y verificación 2FA ahora leen `e.detail || e.error` para mostrar el mensaje del 429 (versión `v1.1.5`)

---

**Nota**: Esta guía es un documento vivo y debe actualizarse conforme el proyecto crezca.


---

## 📄 Archivo: `INSTRUCCIONES_BACKUP.md`

# 📦 Sistema de Respaldo Definitivo (Snapshots)

Este sistema te permite guardar **toda la aplicación** (tu código fuente exacto + la base de datos completa de Postgres) en un solo archivo comprimido `.zip`.

Esta es la mejor forma de asegurar que nunca vas a perder datos o configuraciones si realizas una actualización grande, o si quieres clonar el proyecto a otra computadora.

## 🛠️ Cómo crear un Snapshot

Abre tu terminal (PowerShell o CMD) en la carpeta principal del proyecto y ejecuta:

```bash
python snapshot.py
```

### ¿Qué hace este comando?
1. Extrae un `.sql` seguro de la base de datos de Docker mientras está encendida.
2. Apaga los contenedores brevemente para evitar que archivos queden "abiertos" y se corrompan.
3. Comprime **TODO** el código, la configuración (`.env`) y la base de datos en un archivo llamado `Inventario_Snapshot_AÑO-MES-DIA_HORA.zip`.
4. Enciende los contenedores automáticamente para que no pierdas tiempo.

📂 **Los backups se guardarán en la carpeta `versiones_seguras/`.** Esta carpeta es ignorada por Git de forma automática para no sobrecargar el repositorio si usamos uno.

---

## ♻️ Cómo restaurar o "volver atrás en el tiempo"

Si una actualización salió mal o llevaste tu archivo `.zip` a una computadora **completamente nueva**, la recuperación es igual de fácil.

Coloca el archivo `.zip` en la carpeta `versiones_seguras` (si no existe, créala) y ejecuta:

```bash
python snapshot.py restore
```

*Nota: Por defecto, elegirá el archivo ZIP **más reciente** que tengas.* 

### Opcional: Escoger un archivo exacto
Si quieres volver a una versión específica que no es la última:

```bash
python snapshot.py restore versiones_seguras/Inventario_Snapshot_20231024_120000.zip
```

### ⚠️ ADVERTENCIA CRÍTICA EN LA RESTAURACIÓN ⚠️
Restaurar un snapshot es una acción destructiva:
1. Apagará los contenedores actuales.
2. **Borrará por completo la base de datos actual**.
3. Sobrescribirá todo el código actual con el que venía en el ZIP.
4. Levantará la base de datos exacta de ese día.

**NUNCA corras la restauración si tienes información nueva importante sin antes haber hecho un snapshot nuevo.**


---

## 📄 Archivo: `IDEAS_FUTURO.md`

# 🚀 Ideas a Futuro y Modelos de Negocio — Inventario Pro

Este documento sirve como reserva de ideas y análisis estratégicos para la posible comercialización de la plataforma después de probar su estabilidad en producción para el negocio principal.

---

## 💎 1. Modelo SaaS (Software as a Service)
La idea es vender el acceso al sistema mediante una membresía mensual o anual (suscripción).

### Requerimientos para Evolucionar a SaaS:
- **Multitenencia (Multi-tenancy):** Modificar la base de datos para que una sola instancia del backend pueda manejar múltiples empresas de forma aislada (un `empresa_id` en todas las tablas).
- **Gestión de Suscripciones:** Integración con pasarelas de pago (Stripe/PayPal) para automatizar cobros y bloqueos de cuenta por falta de pago.
- **Onboarding Automático:** Un flujo donde un nuevo cliente se registra y el sistema le crea su espacio de trabajo al instante.
- **Infraestructura Escalable:** Pasar de un solo contenedor a un cluster (ej. Kubernetes o similar) si el volumen de clientes crece masivamente.

---

## 🛠️ 2. Modelo de Implementación Local / Particular
Vender el software como un producto cerrado ("llave en mano") para que negocios individuales lo corran en su propio hardware o nube privada.

### Propuesta de Valor:
- **Privacidad Total:** El cliente es dueño de sus datos y no dependen de la estabilidad de tus servidores centrales.
- **Funcionamiento Offline:** Se puede instalar en redes locales (LAN) para que funcione incluso si el negocio se queda sin internet.
- **Cobro por Implementación:** Un pago inicial fuerte por la licencia y configuración, más una cuota opcional por soporte técnico y mantenimiento anual.

---

## 📈 3. Próximos Pasos (Después de Producción)
1. **Validación en el "Mundo Real":** Observar el rendimiento de la aplicación actual en el VPS de Hetzner con carga real de productos y ventas diarias.
2. **Feedback de Usuarios Internos:** Escuchar a los vendedores y bodegueros para pulir la UX antes de intentar venderla a terceros.
3. **Seguridad Avanzada:** Asegurar que el sistema de logs y auditoría sea infalible para generar confianza en futuros clientes.

---

> [!NOTE]
> Este documento se mantendrá como referencia. Por ahora, el enfoque es **100% estabilidad y seguridad** para el uso interno del negocio.


---

## 📄 Archivo: `implementation_plan.md`

# Plan de Implementación: Historial de Precios, Conteo Físico y Exportación a Excel

Se implementarán las siguientes características en el sistema Inventario Pro para cumplir con el Roadmap (#8 y #9) y la mejora solicitada para el archivo Excel.

## User Review Required

> [!WARNING]
> La implementación del historial de precios requerirá una migración en la base de datos (creación de nueva tabla) usando Alembic.
> Para el Conteo Físico, se creará un módulo completamente nuevo y dedicado (similar al punto de venta y órdenes de compra).

## Proposed Changes

---
### 1. Backend: Historial de Precios

Se requiere registrar cada vez que cambie el costo o el precio de venta de un producto.

#### [MODIFY] [models.py](file:///d:/35%20-%20Docker%20Compose/01%20-%20App%20Inventario/inventario_app_v2/backend/app/models.py)
Añadiremos el modelo `HistorialPrecio` para persistir los cambios.
- `id`, `producto_id` (FK a productos).
- `costo_anterior`, `costo_nuevo`.
- `venta_anterior`, `venta_nuevo`.
- `fecha`.

#### [MODIFY] [schemas.py](file:///d:/35%20-%20Docker%20Compose/01%20-%20App%20Inventario/inventario_app_v2/backend/app/schemas.py)
Creación del modelo Pydantic `HistorialPrecioOut` para la salida en la API.

#### [MODIFY] [services.py](file:///d:/35%20-%20Docker%20Compose/01%20-%20App%20Inventario/inventario_app_v2/backend/app/services.py)
Se modificará la función `actualizar_producto` para detectar cambios entre los valores de la base de datos y la actualización solicitada. Si `p.costo != data.costo` o `p.venta != data.venta`, se guardará un registro en la tabla `HistorialPrecio`. Se añadirá además una función `get_historial_precios(db, producto_id)`.

#### [MODIFY] [main.py](file:///d:/35%20-%20Docker%20Compose/01%20-%20App%20Inventario/inventario_app_v2/backend/app/main.py)
Añadir soporte en `lifespan` para crear la tabla de historial si no existe (con SQLAlchemy local migration). Añadir el endpoint `GET /productos/{id}/historial-precios`.

---
### 2. Frontend: Interfaz para Historial de Precios

#### [MODIFY] [index.html](file:///d:/35%20-%20Docker%20Compose/01%20-%20App%20Inventario/inventario_app_v2/frontend/index.html)
Se añadirá un nuevo "Modal" o "Overlay" llamado `overlay-historial-precio` con una pequeña tabla para mostrar allí las variaciones descubiertas junto con sus fechas de cambio.

#### [MODIFY] [app.js](file:///d:/35%20-%20Docker%20Compose/01%20-%20App%20Inventario/inventario_app_v2/frontend/app.js)
Se incluirá una función `abrirHistorialPrecio(productoId, nombreProducto)` para cargar los datos en este nuevo modal y un botón para invocarla, probablemente en la columna "Acciones" de cada producto en el stock maestro, o dentro del bloque de "Editar".

---
### 3. Frontend: Módulo de Conteo Físico (Inventariado)

Esta será una pantalla "ciega" optimizada para terminales y pistolas USB de escáner de códigos de barra. 

#### [MODIFY] [index.html](file:///d:/35%20-%20Docker%20Compose/01%20-%20App%20Inventario/inventario_app_v2/frontend/index.html)
- Añadir un nuevo botón al menú de navegación: `<button onclick="showPage('conteo', this)">📦 Conteo Físico</button>`.
- Crear el componente contenedor `<div class="page" id="page-conteo">...</div>`. 
  Llevará un buscador de SKU (para escanear y sumar 1 elemento silenciosamente de igual manera que Vender) y una tabla central de "Lo Escaneado".

#### [NEW] [conteo.js](file:///d:/35%20-%20Docker%20Compose/01%20-%20App%20Inventario/inventario_app_v2/frontend/conteo.js)
Archivo dedicado para alojar la lógica asilada:
- **Estado (State):** Array de productos que han sido detectados en físico.
- **Acción "Finalizar Conteo":** Cuando el cajero haya validado físicamente los estantes, la App consultará la cantidad lógica versus la física. Solamente a aquellas que difieran lanzará un `req('POST', '/productos/{id}/ajuste')` con el Delta correspondiente y el motivo "Ajuste por Conteo Físico".

---
### 4. Mejora: Exportación a Excel Ordenada

El usuario solicitó que aquellos productos que tengan existencias (`qty > 0`) aparezcan siempre por encima que el resto sin existencias (`qty <= 0`).

#### [MODIFY] [app.js](file:///d:/35%20-%20Docker%20Compose/01%20-%20App%20Inventario/inventario_app_v2/frontend/app.js)
Dentro de la función `exportExcel()`, antes de ejecutar la inyección a ExcelJS, aplicaremos ordenación a los productos con este fragmento semántico:

```javascript
    const productosParaExportar = [...productos].sort((a, b) => {
      // Priorizar los que sí tienen stock
      if (a.qty > 0 && b.qty <= 0) return -1;
      if (a.qty <= 0 && b.qty > 0) return 1;
      return 0; // Respetar orden en caso de empate
    });
```
Luego el bucle `forEach` de Excel interactuará sobre `productosParaExportar` y no de corrido como en la actualidad.

## Open Questions

> [!IMPORTANT]
> - ¿Te gustaría que el botón para ver el "Historial de Precios" esté en la pantalla principal de "Inventario" al lado de los botones de Acción de cada renglón (Ajuste, Editar)? ¿O prefieres que esté dentro del mismo Modal de "Editar Producto"?

## Verification Plan

### Manual Verification
- Cargar la interfaz e interceptar creaciones de productos y variaciones de precio (Costo/Venta). El backend deberá alojarlos con integridad histórica. Validar que la tabla del historial las asocie al producto.
- En la pestaña "Conteo Físico", probar el escaneo simultáneo y comparar cómo la App corrige silenciosamente si hay variaciones faltantes en la BD. 
- Click en Exportar a Excel y validar visualmente `.xlsx` que la parte superior de la hoja sea los de status "OK/Bajo" y al final dejen a todos los que tienen Alerta Extrema de Status "Agotado / Sin stock".


---

## 📄 Archivo: `walkthrough.md`

# Resumen de Implementación: Historial, Conteo y Excel

Las tres funcionalidades solicitadas han sido desarrolladas e integradas satisfactoriamente en Inventario Pro.

## 1. Historial de Precios

Se ha implementado un sistema para monitorizar cada fluctuación en los costos y precios de venta de tus productos.

- **Backend:** Se creó la tabla `historial_precios` y se programó un trigger a nivel lógico dentro de la función `actualizar_producto` en `services.py`. Ahora, cada vez que edites un precio de compra o venta en cualquier producto, el sistema detectará el cambio automáticamente y creará un registro de estampa de tiempo con el *Antes vs Después*.
- **Frontend:** En la vista principal de Inventario, dentro de la columna acciones en cada variante de producto, encontrarás un nuevo botón azul (🕒). Al hacer clic en él se abrirá un Modal Limpio listando todas las fluctuaciones históricas en el tiempo.

## 2. Exportación Orgánica a Excel

La lógica de exportación ha sido mejorada para cubrir tu necesidad semántica:

- Ahora, cuando presiones el botón verde "⬇ Excel", el sistema internamente tomará toda la base de productos y la **ordenará dando absoluta prioridad a los ítems que tienen stock** (qty > 0). 
- Todo lo que tenga `(qty <= 0)` quedará empujado ordenadamente a las últimas filas del documento Excel, haciendo que las lecturas y cruces en hojas de cálculo externas sean mucho más simples en los primeros vistazos.

## 3. Modo 'Conteo Físico'

Se ha creado un módulo completamente nuevo y ciego para realizar auditorías físicas con escáner USB.

- **Accesibilidad:** Existe un nuevo botón en el Nav principal del sistema: `📦 Conteo Físico` (al lado de Órdenes de Compra).
- **Flujo de Audición:** Funciona idéntico que el Punto de Venta. Clickeas la caja de texto, disparas con la pistola el código de barras y la cantidad suma `+1` de manera silenciosa y ágil en un carrito lateral.
- **Cuadratura y Ajuste Automático:** El sistema te irá mostrando en el listado lo que dice el **Sistema (Sist:) vs Físico (Fís:)** y computará automáticamente si tienes una diferencia `+` (sobrante) o `-` (faltante).
- **Procesamiento Masivo:** Al hacer clic en "Evaluar y Aplicar Ajustes", el sistema leerá únicamente aquellos renglones que difirieron de la realidad y disparará peticiones masivas al Backend para que inserte en la tabla base un movimiento etiquetado como `"Ajuste por Conteo Físico"`, regularizando el inventario central con tan solo un clic.

> [!TIP]
> Recuerda reiniciar Docker o ejecutar nuevamente tu script de migración temporal en caso de que borres los volúmenes, puesto que la nueva tabla `historial_precios` se creará automáticamente la próxima vez que el Backend se inicie gracias al contexto *lifespan* de FastAPI.


---

## 📄 Archivo: `task.md`

# Lista de Tareas

## Backend
- `[x]` Actualizar `models.py` (Crear `HistorialPrecio`).
- `[x]` Actualizar `schemas.py` (Crear `HistorialPrecioOut`).
- `[x]` Actualizar `services.py` (Detectar cambios de precio, añadir función `get_historial_precios`).
- `[x]` Actualizar `main.py` (Añadir endpoint GET, asegurar creación de base de datos / migraciones locales).

## Frontend: Historial de Precios
- `[x]` Actualizar `index.html` (Modal `overlay-historial-precio`, Botón en tabla de inventario).
- `[x]` Actualizar `app.js` (Función `verHistorialPrecios()`, cargar modal con historial).

## Frontend: Exportación de Excel Mejorda
- `[x]` Modificar `exportExcel()` en `app.js` para ordenar primero productos con stock.

## Frontend: Conteo Físico
- `[x]` Actualizar `index.html` (Botón de nav, Div `page-conteo`, Estructura del carrito guiado para escaneo "Ciego").
- `[x]` Crear `conteo.js` (Manejo de estados lógicos para el nuevo módulo, tabla diferencial).
- `[x]` Enlazar estilos e inyección final en `index.html`.



### 28 de Junio de 2026 - Mejoras de UI y Backfill de Contabilidad
- Se reemplazó el checkbox de MSI en el formulario de Órdenes de Compra por un select unificado (Forma de Pago) activo para Insumos y Equipos.
- Se acortó el texto 'Seleccionar Insumo del Catálogo' a 'Catálogo de Insumos'.
- Se creó y ejecutó un script de backfill (ackfill_june.py) para generar los registros contables faltantes de las Órdenes de Compra confirmadas en el mes de junio.
- Se instaló la dependencia python-dateutil requerida por la lógica de MSI.

### 27 de Septiembre de 2026 - Correcciones críticas de UI (Historial de Precios, Ctrl+K y Conteo Físico)
- **Historial de Precios:** se corrigió el crash del botón 🕒 por ID inexistente (`hp-tbody` → `hp-body`) y la apertura del modal se unificó a `classList.add('active')` para que el botón Cerrar funcione (antes usaba `display:flex` directo, lo que lo dejaba atorado en pantalla). La tabla se amplió de 3 a 5 columnas (Costo Ant./Nuevo y Venta Ant./Nueva) para reflejar el antes/después que ya devuelve el backend.
- **Búsqueda Global (Ctrl+K):** se restauró en `index.html` el overlay `overlay-global-search` con `gs-input`, `gs-results` y footer de atajos, que faltaba aunque el JS y el CSS ya existían. Ctrl+K ya no lanza error y la búsqueda es funcional.
- **Conteo Físico:** se corrigió la llamada a la función inexistente `cargarProductos()` → `loadProductos()` en `conteo.js` (2 sitios); al aplicar ajustes ya no se interrumpe el flujo y el inventario se refresca correctamente.
- Versiones incrementadas: `app.js v1.1.3`, `conteo.js v1.0.1` (bust de caché en `index.html`).

### 27 de Septiembre de 2026 - Página de Auditoría (Actividad + Respaldos)
- **Contexto:** el módulo de Auditoría estaba a medias — el JS (`loadAuditLogs`, `loadAuditStats`, `renderAuditLogs`, `switchAuditTab`, `generarBackup`, `loadBackups`) y el CSS (`.audit-kpis`, `.action-badge`, `.backup-card`) ya existían completos, pero la página HTML nunca se creó: no había botón en el sidebar ni contenedor `#page-logs`, por lo que todo ese código era inalcanzable.
- **`index.html`:** se agregó la sección `⚙️ Administración` en el sidebar con el botón `📜 Auditoría` (`#nav-logs`, `data-role="admin"`) y se construyó la página `#page-logs` con: 5 KPIs (`ak-total`, `ak-logins`, `ak-acciones`, `ak-ediciones`, `ak-usuarios`), barra de filtros (usuario, acción agrupada por módulo con `<optgroup>`, rango de fechas y botón Limpiar), tabla de registros (`#log-body`) con estado vacío, paginación servidor (`#log-pagination`) y botón Exportar CSV.
- **Fusión de Respaldos:** la antigua página independiente `#page-backups` y su botón `nav-backups` se eliminaron; los respaldos ahora son la pestaña `💾 Respaldos` (`#audit-tab-backups`) dentro de Auditoría, reutilizando `btn-generar-backup`, `#backups-list` y `#backups-empty` (se eliminó así la duplicación de IDs).
- **`app.js`:** se quitó `'nav-backups'` del mapa `applyRoleUI`; `showPage('backups')` ahora redirige a la pestaña de respaldos de Auditoría (alias compatible con enlaces antiguos) y se eliminó la rama obsoleta del cargador; se agregó `window.applyLogFilters()` que resetea a la página 1 al cambiar cualquier filtro.
- Versión incrementada: `app.js v1.1.4` (bust de caché en `index.html`).
- **Verificado en navegador** (localhost:3000, rol admin): 365 eventos, 50 filas por página, paginación a página 2, filtro por `REGISTRAR_VENTA` y por fecha, estado vacío, reset de filtros, exportación CSV con toast, 7 tarjetas de respaldo y gating de rol (vendedor no ve el módulo). Consola sin errores.

### 27 de Septiembre de 2026 - Reactivación del Rate Limiter (slowapi)
- **Contexto:** el limitador estaba deshabilitado desde la incidencia del 2026-03-30 (el límite de 5 intentos/hora bloqueó al admin durante las pruebas de 2FA). El código seguía comentado en `main.py` con una nota de "reactivar con límites más permisivos".
- **Nuevos límites:** `10/minute;100/hour` por IP, **solo** en `/auth/login` y `/auth/2fa/verify`. Se eligió un esquema de doble ventana porque frena ráfagas de fuerza bruta sin castigar el uso legítimo (varias personas pueden corregir su contraseña sin quedar fuera una hora). No se usó `default_limits` ni `SlowAPIMiddleware`, por lo que ningún otro endpoint (polling de `/notificaciones`, POS, etc.) se ve afectado.
- **Key-func proxy-aware (`_client_ip`):** usa la IP del peer; solo si esta es una IP privada (contenedor/proxy interno tipo Traefik) confía en la primera entrada de `X-Forwarded-For`. Evita tanto el bypass por header falsificado como el bloqueo compartido cuando todo el tráfico llega con la IP del proxy.
- **Handler 429 en español:** `app.add_exception_handler(RateLimitExceeded, _rate_limit_handler)` devuelve `{"error": "Demasiados intentos..."}` sin el prefijo en inglés `Rate limit exceeded:`.
- **Kill-switch de emergencia:** `RATE_LIMIT_DISABLED=1` en el entorno desactiva el limiter al arrancar, sin editar código ni reconstruir imagen.
- **`frontend/app.js` (`v1.1.5`):** `doLogin` y la verificación 2FA ahora leen `e.detail || e.error`, de modo que el usuario ve el mensaje real del 429 en lugar del genérico "Credenciales incorrectas".
- **Verificado en vivo:** ráfaga de 11 logins fallidos → 10× 401 y luego 429 con mensaje limpio; tras reiniciar la ventana, login correcto → 200; 40 peticiones seguidas a `/health` → 40× 200 (sin límite global); login desde la UI del navegador → OK con rol admin y shell `app-layout` visible.

### 27 de Septiembre de 2026 - Precisión monetaria: `Float` → `Numeric(12,2)` (hallazgo #6)
- **Contexto:** las columnas de dinero estaban declaradas como `Float` (doble binario), lo que producía errores de centavos (p. ej. `10.55` se guardaba como `10.550000000000001`) y comparaciones/sumas poco confiables en reportes. Se migraron a `Numeric(12,2)` (decimal exacto; PostgreSQL redondea a 2 decimales al escribir).
- **`models.py` (13 columnas):** `productos.costo`, `productos.venta`, `productos.costo_menudeo`; `movimientos.precio`; `descuentos.valor`; `ordenes_compra.total_estimado`; `ordenes_compra_items.precio_proveedor` y `subtotal`; `historial_precios.costo_anterior`, `costo_nuevo`, `venta_anterior`, `venta_nuevo`; `contabilidad_transacciones.monto`.
- **Migración (brecha Alembic):** la tabla `alembic_version` está vacía y la única migración (`0f0cc4f0840a`) nunca se aplicó — un `alembic upgrade head` fallaría por columnas ya existentes. Por eso la conversión se implementó como **DDL idempotente en el `lifespan` de `main.py`**: un bloque `DO $$` recorre `information_schema.columns` y ejecuta `ALTER TABLE ... TYPE numeric(12,2) USING ...` **solo** si la columna sigue siendo `double precision` (seguro de re-ejecutar en cada arranque; no duplica columnas ni pierde datos). Cuando se haga el baseline real de Alembic, generar la migración equivalente.
- **Correcciones de mezcla `Decimal`/`float` (6 puntos):** con columnas `Numeric`, SQLAlchemy devuelve `Decimal`; sumar `float`+`Decimal` lanza `TypeError` y `json.dumps` no serializa `Decimal`:
  - `main.py` — logs de auditoría de venta y de descuento: `float(res.qty * res.precio)` y `float(res.valor)` (la columna JSON `detalles` se serializa con `json.dumps`).
  - `services.py` — acumuladores de `get_ventas_agrupadas` (`total_estimado`) y `get_alertas_inteligentes` (ingresos por producto) inicializados en `Decimal("0")`; logs de `procesar_devolucion_parcial` y `cancelar_venta_completa` usan `float(m.precio)`.
  - `services.py` — `actualizar_producto` compara precios normalizando con `_centavos()` (`Decimal` cuantizado a 2 decimales, `ROUND_HALF_UP`), evitando falsos registros en `historial_precios` por la escala de `Numeric`.
- **Comportamiento nuevo:** el dinero se redondea a 2 decimales al guardar; la API sigue devolviendo números JSON normales (Pydantic y `JSONResponse` convierten `Decimal`→`float`); las sumas internas de reportes, contabilidad y ventas agrupadas ahora son exactas al centavo.
- **Backup previo:** `backup_20260927_210831.sql` (generado con `POST /admin/backup`; el contenedor escribe en su `/app/backups`).
- **Verificación:** las 13 columnas quedaron `numeric` precision 12 scale 2, con defaults/nullability intactos y conteos de filas idénticos (productos 619, movimientos 446, OC 22, items 170, contabilidad 24); sumas consistentes (`oc_items.subtotal` = `ordenes_compra.total_estimado` = 22144.18). E2E con datos temporales (limpiados al terminar): venta con precio exacto → devolución parcial → cancelación completa con stock restaurado; descuento `12.34`; OC con subtotales 31.65/40.80; MSI 3 cuotas exactas de 21.10; caso no entero 100/3 → 3× 33.33 sin error de escritura. Sin errores en logs del backend.
- **Relacionado:** el redondeo de MSI en divisiones no exactas (100/3 → 3× 33.33 = 99.99) quedaba pendiente como hallazgo #7 y **se resolvió el mismo día** (ver entrada siguiente).

### 27 de Septiembre de 2026 - Redondeo MSI: cuotas que suman exacto (hallazgo #7)
- **Contexto:** al confirmar una OC a MSI, el backend dividía `total_estimado / meses_msi` y guardaba ese valor en cada cuota. Con columnas `Numeric(12,2)` cada cuota se redondea al centavo por separado, por lo que un total no divisible perdía centavos (100.00/3 → 3× 33.33 = 99.99).
- **Solución (`services.py`):** `cuotas_msi(total, meses)` reparte en cuotas de 2 decimales donde **la última absorbe la diferencia** (cuotas iguales + ajuste final), garantizando `suma(cuotas) == total` exacto: 100.00/3 → 33.33, 33.33, 33.34; 10.00/6 → 1.67×5 + 1.65. `registrar_egreso_orden(db, orden, ahora)` unifica la creación del pago único y de las N cuotas MSI (antes inline en el endpoint; ahora conforme a la directriz de routers delgados → lógica en `services.py`).
- **`main.py`:** el bloque inline de ~25 líneas en `POST /ordenes-compra/{id}/estado` se reduce a `await services.registrar_egreso_orden(db, orden)`. Los conceptos (`Pago OC <folio> (Mes i/n) - <tipo>` y `Pago OC <folio> - <tipo>`) y las fechas mensuales consecutivas se conservan idénticos.
- **`backfill_june.py`:** su copia de la fórmula se actualizó para usar `services.cuotas_msi` (script histórico ya ejecutado; no se re-ejecutó).
- **Datos existentes auditados:** sin descuadres — la única OC con MSI (12 cuotas de 485.25) dividía exacto; el resto son pagos únicos cuyo monto ya coincide con su total.
- **Verificación E2E (datos temporales limpiados):** 100.00/3 → 33.33/33.33/33.34 (suma 100.00); 10.00/6 → 1.67×5+1.65 (suma 10.00); 63.30/3 → 21.10×3 (regresión); pago único 123.45 → 1 fila exacta; fechas consecutivas m/m+1/m+2 y conceptos verificados en BD; sin errores en logs del backend.

### 27 de Septiembre de 2026 - Eliminación de bloques JS duplicados/sombreados (hallazgo #8)
- **Contexto:** los scripts frontend son clásicos (no módulos) y comparten el scope global: cuando una función se define dos veces, **la última asignación gana silenciosamente** y la primera queda muerta pero ejecutable en el archivo. La auditoría encontró 4 funciones sombreadas, 2 implementaciones muertas de PDF de ticket y un wrapper que duplicaba renders. Ningún síntoma visible grave, pero alto riesgo de "arreglar" la copia equivocada en el futuro.
- **`frontend/app.js` (3445 → 3318 líneas, `v1.1.6`):**
  - Eliminado el bloque v1 de notificaciones (`window.toggleNotifications`, `loadNotificaciones()`, `window.marcarLeida`, `window.limpiarNotificaciones`) — sombreado por el sistema v2 (mismo día, ~línea 3020). Se conservó `updateNotifBadge()` (vivo: lo llama `renderInventario`). El v2 queda como única implementación: `loadNotificaciones` → `renderNotificacionesList` (onclick `marcarUnaleida`) → `toggleNotifications` (clase `.active`).
  - Eliminado `window.onScannerEnter` v1 (solo SKU, con toast "SKU no encontrado"). El v2 conserva lo esencial y agrega el flujo de cupones: SKU conocido → carrito; desconocido → `aplicarDescuentoPOS(val)`. `onBuscarSKU` (usado por el `oninput`) intacto.
  - Eliminado el bloque de exportación no-op de 20 líneas (`window.showPage = showPage;` … `window.aplicarRopa = aplicarRopa;`): los 19 nombres ya estaban definidos en `window` (declaraciones o `window.x =`), así que no aportaba nada.
  - Eliminada la cadena muerta de ticket `descargarTicketListado` + `generarTicketPDF(h)` (~42 líneas): cero llamadores; todas las filas de Historial usan `descargarTicketMulti`, que normaliza las ventas simples inyectando `h.detalles = [{...}]`. Ahora hay **una sola** implementación de PDF de ticket (`generarTicketMulti`, formato [80,250], con logo y `safeBuild`).
  - Eliminado `window.notificacionesCheckInterval = null;` suelto antes de `loadNotificaciones` (el ciclo de vida real del intervalo está en las líneas 188-190).
  - `tzOptions` replicado ×4 (Historial/Movimientos/Reportes) → constante única `TZ_MX` (`America/Mexico_City`) junto a `mxn()`.
- **`frontend/oc.js` (854 → 839 líneas, `v1.0.3`):** eliminado el IIFE final que reasignaba `window.showPage` para "cargar órdenes al cambiar de pestaña". Era redundante — el `showPage` canónico de `app.js` ya invoca `renderOrdenesCompra` al entrar a la pestaña — y provocaba **doble render** (dos `GET /ordenes-compra`) en cada navegación a Órdenes de Compra.
- **`frontend/index.html`:** eliminada la segunda carga de `JsBarcode.all.min.js` (línea ~1380; queda la del `<head>`) y bump de caché `app.js?v=1.1.6`, `oc.js?v=1.0.3`.
- **Verificación en navegador (localhost:3000, rol admin):** una sola etiqueta `jsbarcode` y versiones nuevas cargadas; campana de notificaciones abre la lista v2 (73 ítems) y cierra; escaneo de SKU real (`PRD-002`) → ítem en carrito; código desconocido → toast "Código no encontrado" vía cupón sin tocar el carrito; botón "📄 Ticket" de Historial → "Ticket PDF generado" con `descargarTicketMulti`; navegación a Órdenes de Compra → exactamente **1** `GET /ordenes-compra` y listado correcto (sin doble render); `marcarLeida`/`limpiarNotificaciones`/`descargarTicketListado`/`generarTicketPDF` ausentes del ámbito global; consola del navegador limpia y logs del backend con 200.
- **Observaciones no corregidas (higiene del repo):** `frontend/temp_original.html` es un `index.html` viejo (549 líneas) sin referencias en código/docker, sin commitear — se recomienda borrarlo o moverlo a un directorio de respaldo; `logo.png` nunca existió en el repo (los PDFs se generan sin logo, `safeBuild(false)`), por eso hay un 404 inocuo en consola; `frontend/conteo.js` y `frontend/contabilidad.js` están **sin commitear** aunque `index.html` los carga (riesgo de perderlos).
- **Relacionado:** siguiente hallazgo pendiente de la auditoría — #9: `req()` en `app.js` no reacciona al 401 (token expirado): no hace logout ni avisa, dejando la UI "viva" sin sesión válida.

### 27 de Septiembre de 2026 - 401 en `req()`: logout con aviso (hallazgo #9)
- **Contexto:** cuando el JWT expiraba (8 h) o se invalidaba, `req()` detectaba el 401, llamaba a `doLogout()` y **retornaba `undefined` en silencio**: la UI quedaba "viva" sin sesión (llamadas posteriores devolvían `undefined` y rompían los flujos) y el usuario no sabía por qué. Además, el polling de notificaciones seguía pidiendo cada 15 s contra `/notificaciones` con token muerto.
- **`frontend/app.js` (`v1.1.7`, 4 cambios):**
  1. `req()` (rama 401): captura si había token activo, ejecuta `doLogout()` y, si la sesión estaba activa, escribe en `#login-error` el aviso «⏰ Tu sesión expiró. Inicia sesión de nuevo.»; luego **lanza** `Error('Sesión expirada')` con `err.status = 401` (antes retornaba `undefined`). Los llamadores que ya usan `try/catch → toast(e.message)` muestran «Sesión expirada» automáticamente.
  2. `doLogout()`: limpia `window.notificacionesCheckInterval` (`clearInterval` + `null`) para detener el polling con token muerto; el intervalo se vuelve a armar al hacer login (`showApp`).
  3. `doLogout()`: ya **no** oculta `#login-error`. Antes lo limpiaba, y como los dos `DOMContentLoaded` del arranque disparan varios 401 en paralelo, el último `doLogout()` (sin token capturado) borraba el aviso recién mostrado. Ahora el recuadro se limpia en cada intento de `doLogin`, así el aviso de expiración sobrevive al arranque.
  4. Guard en el `catch` de restauración de sesión (~línea 3310): si el error es 401, `return` inmediato — sin él, el fallback mostraba el shell de la app (`showApp`) con token inválido. Este bug latente quedó expuesto por el nuevo `throw` y se corrigió en el mismo cambio.
- **Verificación en navegador (localhost:3000):** (a) expiración a mitad de sesión → regreso al login con el aviso visible, token borrado, polling detenido, toast «Sesión expirada» del `catch` del llamador; (b) re-login con `admin` → entra normal y el recuadro se limpia; (c) arranque con token inválido → solo login (sin shell), aviso persistente (`errDisplay: "block"`), sin polling; (d) se confirmó que el código nuevo está cargado (`doLogout.toString()` contiene el comentario nuevo). Ruido residual esperado en consola: los 401 de red del arranque y el `Error: Sesión expirada` sin capturar de `renderVentasRecientes` (app.js:1678, llamada desde `showPage`), que no rompe el flujo de expiración.
- **Observación nueva detectada durante esta prueba (pendiente, hallazgo #10):** `GET /productos` y `GET /notificaciones` responden **200 sin token** (catálogo completo con costos y notificaciones), mientras el resto de endpoints sí exige JWT. Rutas en `backend/app/main.py` (~:155 y ~:778) sin dependencia de autenticación. Requiere cambio de backend + reinicio del contenedor.

### 27 de Septiembre de 2026 - Endpoints sin autenticación (hallazgo #10)
- **Contexto:** detectado con `curl` sin token durante la verificación de #9: `GET /productos` devolvía **200** con el catálogo completo (183 KB, incluye costos) y `GET /notificaciones` **200** (12.8 KB). El barrido de rutas reveló además que `PUT /notificaciones/{id}/leer`, `DELETE /notificaciones` y `GET /sku/preview` tampoco tenían ninguna dependencia de auth — las dos primeras son mutaciones, peor que una lectura.
- **`backend/app/main.py` (5 rutas):** se agregó `dependencies=[Depends(require_role("admin", "vendedor", "bodeguero"))]` a `GET /productos` y a las tres de `/notificaciones` (mismo trío de roles que ya usan `GET /productos/{id}`, `/movimientos` y `/dashboard/alertas-inteligentes`); `GET /sku/preview` quedó con `require_role("admin")` (no tiene llamadores en el repo; el alta de productos es solo admin). Público por diseño, sin cambios: `/health` (healthcheck), `/auth/login` y `/auth/2fa/verify` (segundo paso del login).
- **Despliegue:** `docker restart inventario_api` (el backend corre sin `--reload`; el código va montado por bind `./backend:/app`, sin rebuild).
- **Verificación (curl):** sin token → **401** en `/productos`, `/notificaciones` (GET/PUT/DELETE) y `/sku/preview`; `/health` sigue **200**. Con token admin → `/productos` **200** con payload idéntico (`183,551 bytes`), `/notificaciones` **200** (`12,816 bytes`), `/sku/preview` **200**.
- **Verificación (navegador, localhost:3000):** login normal; 619 productos cargados; campana abre el panel con 73 ítems; recarga con sesión válida restaura la app (dashboard, movimientos, reportes, alertas: todo 200); consola limpia y logs del backend sin errores.
- **Observación menor detectada (preexistente, no corregida):** `PUT /notificaciones/{id}/leer` con un id inexistente devuelve **500** (el servicio retorna `None` y FastAPI falla al validarlo contra `response_model`); el frontend nunca envía ids inválidos. Pendiente menor.

### 27 de Septiembre de 2026 - Cierre formal de la auditoría (10 hallazgos)
- **Resultado:** los 10 hallazgos de la auditoría de código quedaron corregidos y verificados uno a uno: **#1** Historial de Precios · **#2** overlay Búsqueda Global Ctrl+K · **#3** `cargarProductos`→`loadProductos` en `conteo.js` · **#4** página Auditoría · **#5** rate limiter reactivado (`10/minute;100/hour`, proxy-aware, kill-switch) · **#6** `Float`→`Numeric(12,2)` con migración Alembic · **#7** cuotas MSI que suman exacto · **#8** bloques JS duplicados/sombreados eliminados (+ rendimiento: doble render de OC) · **#9** `req()` reacciona al 401 con aviso y logout · **#10** `/productos`, `/notificaciones` y `/sku/preview` protegidos con JWT.
- **Reconciliación de `SECURITY_AUDIT.md` contra el repo real (verificada este día):** usuario root → ✅ resuelto (`USER appuser` en `Dockerfile`); secretos hardcodeados → ✅ resueltos (el compose usa `env_file: .env`; el commit histórico `ad9b1e7` aún contiene la URL con contraseña → rotar la credencial al publicar); modo desarrollo `--reload` → ✅ resuelto (command sin reload). El único pendiente de infraestructura es el mapeo `5432:5432` en `docker-compose.yml`, que se conserva a propósito para herramientas locales y quedó marcado como **acción obligatoria antes del despliegue en VPS** (secciones Hardening y SECURITY_AUDIT actualizadas; la afirmación previa de que la BD "ya no expone puertos" era incorrecta).
- **Pendientes menores transferidos (no bloquean el cierre):** JWT sin refresh/revocación (expiración fija de 8 h); escape XSS en renderizado del frontend (no existe `escapeHtml`); `PUT /notificaciones/{id}/leer` con id inexistente → 500 en vez de 404; código inalcanzable `services.py:500-502`; paginación en Python `services.py:961`; refs muertas `low-stock-alert`/`session-badge`; `Error: Sesión expirada` sin capturar en `renderVentasRecientes` (app.js:1678); higiene del repo (`temp_original.html`, `conteo.js`/`contabilidad.js` sin commitear, archivos basura, trabajo acumulado sin commit).
- **Estado:** auditoría **cerrada** el 2026-09-27. Lo que sigue es endurecimiento/despliegue de VPS (firewall, Traefik+SSL, retiro del mapeo 5432) y los pendientes menores listados.

### 27 de Septiembre de 2026 - Commit v5: consolidación del repositorio
- **`c990b03` — "v5: auditoría de seguridad cerrada (#1–#10) y consolidación del proyecto"** (35 archivos, +10,749/−861): todo el código de la auditoría y los módulos nuevos (`auth.py`, `dashboard.js`, `contabilidad.js`, `conteo.js`), la migración Alembic de contabilidad/OC, scripts de mantenimiento (`snapshot.py`, `check_users.py`, `migrate_v2.py`, `update_prices.py`, `migracion_compra_obligatoria.py`) y este documento.
- **`docker-compose.yml`:** elimina `DATABASE_URL` con credenciales en claro del servicio `api` (ahora se toman de `.env` vía `env_file`), corre sin `--reload`, fija `TZ=America/Mexico_City` y monta `./backups:/app/backups`.
- **Higiene:** `.gitignore` pasa a estar versionado (ignora `venv/`, `.venv/`, `backups/`, `*.zip`, `postgres_data/`, `.env`, `*.pyc`); `.env` y los `.pyc` de `backend/app/__pycache__` dejan de versionarse (los archivos siguen en disco); se descartó `ROADMAP.md` (borrador viejo, contenido ya cubierto por este documento).
- **Excluidos a propósito del commit (siguen sin versionar):** `backend/app/reset_admin_2fa.py`, `backend/backfill_june.py`, `backend/db_patch.py`, `backend/test_api.py` (contienen contraseñas/credenciales literales) y temporales (`all_products.json`, `git_diff_index.txt`, `tmp_logs.txt`, `frontend/temp_original.html`, `test_alertas.py`).
- **Pendiente de seguridad al publicar:** la historia de git ya publicada en GitHub (`origin`) contiene `.env` y las URLs con contraseña de commits anteriores → **rotar credenciales** (contraseña de la BD, `SECRET_KEY` y contraseña de admin) antes de desplegar el VPS. Pendiente aparte de higiene: `backend/.venv` (≈3000 archivos) sigue versionado por error histórico.

### 27 de Septiembre de 2026 - Higiene: `backend/.venv` fuera del repositorio
- **`git rm -r --cached backend/.venv`:** 3009 archivos (≈98% de todo lo versionado, 664,045 líneas) salen del índice; el entorno virtual sigue **intacto en disco** (`backend/.venv/Lib` con 52 paquetes) y ya no aparece como pendiente porque `.gitignore` lo cubre (`.venv/`). El repositorio queda en ~45 archivos reales.
- **Motivo:** el venv entró al repo por error histórico (plantillas de dependencias, `*.dist-info`, binarios) y ensuciaba todos los diffs; no es parte del código fuente — cada quien lo recrea con `pip install -r backend/requirements.txt`.

### 27 de Septiembre de 2026 - Plantilla `.env.example`
- **`.env.example` (nuevo, versionado):** plantilla con los **nombres** de las 5 variables que usa el proyecto (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DATABASE_URL`, `SECRET_KEY`) y valores de ejemplo, sin ningún secreto real. Incluye instrucciones para copiarlo (`cp .env.example .env`), la nota de que dentro de Docker el host es `db`/fuera es `localhost`, y cómo generar un `SECRET_KEY` nuevo (`python -c "import secrets; print(secrets.token_urlsafe(64))"`).
- **Motivo:** que cualquier persona (o IA) que clone el repositorio sepa exactamente qué variables configurar, sin depender de la historia de git (que aún contiene el `.env` viejo en commits publicados). El `.env` real sigue en disco e ignorado por `.gitignore`; `.env.example` **no** queda cubierto por esa regla (verificado con `git check-ignore`).

### 30 de Septiembre de 2026 - Búsqueda flexible en "Agregar producto" de Órdenes de Compra (`oc.js`)
- **Problema reportado:** en el modal de Orden de Compra, buscar «Playera Blanca Dama» no devolvía nada; la búsqueda exigía escribir el nombre exacto del producto (texto literal y contiguo).
- **Causa raíz (verificada contra la BD real, 619 productos):** `buscarProductoOC` comparaba `nombre + sku + categoria` contra el texto completo con `includes()`:
  - (a) el orden del catálogo es «Playera Dama Peso D0200 - Blanco Chica» (*Dama* antes de *Blanco*), distinto al orden en que busca la gente;
  - (b) los colores del catálogo están registrados en masculino («Blanco») y el usuario teclea «Blanca»;
  - (c) cualquier diferencia de orden, acento, plural o género rompía el match.
- **`frontend/oc.js` (referencia de caché `v1.0.4` en `frontend/index.html`):**
  1. Búsqueda por palabras (tokens): normalización a minúsculas y sin acentos (NFD), se descartan conectores (`de`, `la`, `con`…), y se exige que **todas** las palabras aparezcan (en cualquier orden) dentro de `nombre + sku + categoria`.
  2. Tolerancia morfológica por palabra: plural (`playeras`→`playera`) y género (`blanca`→`blanco`, `negra`→`negro`).
  3. `onScannerEnterOC`: si lo tecleado/escaneado no es un SKU exacto, ejecuta la búsqueda por texto; solo avisa «SKU no encontrado» y limpia cuando la búsqueda tampoco produce resultados. El escaneo de SKU exacto (código de barras) conserva su flujo intacto.
- **Verificación (banco Node con el `oc.js` real + export real de la BD):** «Playera Blanca Dama» → 8 resultados (antes 0) · «playera blanca» → 20 (tope de lista) · mayúsculas, orden libre («blanca dama playera»), plural («playeras blancas dama») y códigos de modelo («c0200», «D0200») correctos · texto inexistente → 0 · Enter con texto conserva resultados sin toast · SKU real agrega y limpia · SKU desconocido avisa y limpia. Nota: «sudadera negra grande» da 0 porque hoy **no existen** productos de la categoría Sudadera en el catálogo (0 filas), no es fallo del buscador.
- **Pendiente opcional (menor):** el resto de buscadores del frontend (`app.js`: inventario, Ctrl+K, etc.) siguen usando `includes()` literal; si se desea, se les puede aplicar el mismo criterio de tokens.

### 30 de Septiembre de 2026 - Menores de auditoría cerrados (notif 404, limpieza, paginación estable)
- **B1 · `PUT /notificaciones/{id}/leer` con id inexistente devolvía 500:** el servicio retornaba `None` y FastAPI fallaba al validar `response_model=NotificacionOut` (error de validación → 500). Ahora `main.py` verifica el resultado y lanza `HTTPException 404 "Notificación no encontrada"` (mismo patrón que el resto de routers). **Verificado en vivo:** sin token → 401 · id inexistente → 404 con detalle · id real (137) → 200.
- **B2 · Limpieza de código muerto:**
  - `backend/app/services.py`: eliminadas 3 líneas inalcanzables después del `return False` de `desactivar_totp_usuario`.
  - `frontend/app.js` (referencia `v1.1.8`): eliminado el bloque `#session-badge` (ese elemento no existe en ningún HTML) y la variable `nombreMostrado` (sin uso); eliminado `window.closeLowStockAlert` + `lowStockAlertDismissed` (no referenciados en ningún archivo). El resto del bloque de sesión (nombre, rol y avatar de la barra lateral, que sí existen en `index.html`) queda intacto.
  - `frontend/styles.css` (referencia `v2.0.1`): eliminadas las reglas huérfanas `.header-session` y `.session-badge` (ninguna usada en HTML/JS).
- **B3 · Paginación estable en `get_ventas_agrupadas`:** se agregó desempate `.order_by(fecha.desc(), id.desc())` para que el orden por folios sea determinista entre páginas. Nota de escala: con 446 movimientos (176 ventas) el agrupado en Python es instantáneo; se decidió **no** reescribir a paginación SQL (riesgo en código crítico de reportes sin beneficio real al volumen actual).
- **Verificación:** `node --check app.js` OK · `app.js?v=1.1.8` y `styles.css?v=2.0.1` servidos sin símbolos muertos · endpoints probados con token generado en el contenedor (401/404/200/200).

### 30 de Septiembre de 2026 - Búsqueda flexible en todos los buscadores del frontend + espejo en backend
- **Contexto:** el arreglo de `oc.js` (entrada anterior) quedó limitado al modal de Órdenes de Compra; el resto de buscadores seguía con `includes()` literal. Se generalizó el mismo criterio a **todos** los buscadores y se eliminó la lógica duplicada.
- **`frontend/app.js` (referencia `v1.1.9`):** nuevo bloque de utilidades compartidas antes de la sección de autenticación:
  - `BUSQUEDA_STOPWORDS` (conectores), `normalizarBusqueda()` (minúsculas + sin acentos vía NFD), `variantesBusqueda()` (plural y género por palabra: `playeras`→`playera`/`player`, `blanca`→`blanco`) y `coincideBusqueda(campos, query)` (todas las palabras deben aparecer en algún campo, en cualquier orden; consulta vacía o solo conectores → **no filtra**).
  - Cinco puntos de búsqueda migrados: Inventario (`renderInventario`; nombre+SKU+notas+proveedores), Venta (`onFiltrarCategoria`; categoría y SKU), Historial (`renderHistorial`), Búsqueda Global Ctrl+K (`renderGsResults`) y Descuentos (`renderDescuentos`).
- **`frontend/oc.js` (referencia `v1.0.5`):** eliminadas las funciones locales (`OC_STOPWORDS`, `ocNormalizarTexto`, `ocVariantesPalabra`); el buscador del modal ahora consume los helpers de `app.js` (el orden de carga app.js → oc.js lo garantiza). Se conserva su particularidad: consulta sin palabras útiles → «Sin resultados» (en el resto de pantallas, vacío = sin filtro).
- **`backend/app/services.py` (espejo para `/ventas-agrupadas`):** los mismos helpers en Python (`_BUSQUEDA_STOPWORDS`, `_normalizar_busqueda` con `unicodedata` categoría `Mn`, `_variantes_busqueda`, `_coincide_busqueda`) y el filtro literal de `get_ventas_agrupadas` reemplazado — el buscador de Gestión de Ventas (`#gv-search`; folio/canal/productos/SKU) ahora acepta tokens desordenados, acentos, plural y género.
- **Verificación:**
  - Banco Node (oc.js real + catálogo real de 619 productos): 11/11 casos del helper + mismas salidas del modal que la entrada anterior; `node --check` OK en ambos JS.
  - Backend (reinicio + token generado en el contenedor): «dama blanca playera» y «playeras blancas dama» → 15 grupos (antes 0) · «PLAYERA BLANCA DAMA» → 15 · «xyz123» → 0 · sin token → 401.
  - Navegador (localhost:3000; servidos `app.js?v=1.1.9` y `oc.js?v=1.0.5`): Inventario «playera blanca dama» → 8 productos en 2 grupos padre (literal antes: 0) · Ctrl+K «playeras blancas dama» → 8 · Venta «playeras dama» → 132 opciones y SKU «c0200 negro» → 6 · Descuentos «KP 20» → 1 fila (cupón `KP20`; literal antes: 0) · Historial «playera blanca dama» → 21 movimientos (literal antes: 0).
- **Nota:** «sudadera negra grande» sigue dando 0 porque no existen productos de esa categoría en el catálogo (mismo motivo documentado en la entrada de `oc.js`), no por el buscador.

### 30 de Septiembre de 2026 - Escape HTML centralizado en el frontend (XSS almacenado)
- **Problema (último punto del bloque D):** los campos de texto que captura el usuario (nombre de producto, SKU, notas internas, proveedores alternativos, conceptos de contabilidad, códigos de descuento, folios, etc.) se insertaban con `innerHTML` sin escapar; un producto guardado como `<img src=x onerror=...>` ejecutaba código en el navegador de cualquier usuario que abriera el inventario.
- **Diseño de la solución (dos funciones, decisión deliberada):** en `frontend/app.js` (referencia `v1.2.0`), junto a las utilidades de búsqueda:
  - `escapeHtml(s)` — para **texto visible y valores de atributos normales** (escapa `& < > " '`).
  - `escapeJsAttr(s)` — para **argumentos de cadena dentro de `onclick="fn('...')"`**: primero escapa para JS (`\`, comilla simple, saltos de línea) y luego para HTML. Es necesario porque el navegador **decodifica las entidades HTML antes** de que el handler de JS se parsee: si aquí se usara solo `escapeHtml`, un nombre con `'` rompería el handler.
  - `escapeHtml(null)` devuelve `''`, de modo que los respaldos `escapeHtml(x) || '—'` siguen funcionando.
- **Aplicación (barrido completo por módulo, reemplazando interpolaciones directas en `innerHTML`):**
  - `app.js` (`v1.2.0`): toast (el mensaje ahora se escapa dentro de la propia función), breadcrumb, filas padre/color/variante del inventario, carrito de venta, historial, reportes, ventas recientes y agrupadas, modal de devolución, búsqueda global Ctrl+K, auditoría, respaldos, usuarios, notificaciones, descuentos, subcategorías y campos de variante.
  - `oc.js` (`v1.0.6`): eliminada la función local `esc()` (solo escapaba comillas para JS, insuficiente); todos sus puntos ahora usan los helpers de `app.js` (el orden de carga lo garantiza).
  - `dashboard.js` (`v1.0.1`): tablas del modal de Alertas Inteligentes.
  - `conteo.js` (`v1.0.2`): tarjetas del conteo físico.
  - `contabilidad.js` (`v1.0.1`): transacciones y catálogo de insumos.
  - `index.html`: cache-busters actualizados a las referencias anteriores.
- **Verificación:**
  - `node --check` OK en los 5 archivos; grep de cierre confirmó que los únicos `onclick="${...}"` restantes son invocaciones con IDs numéricos o argumentos ya escapados.
  - Prueba de ejecución en navegador con **cargas maliciosas en memoria** (sin escribir en la BD): producto falso y descuento falso con payloads `<img onerror>`, `<svg onload>` etc. en nombre, SKU, categoría, proveedores, notas y códigos → **0 elementos inyectados** en inventario, Ctrl+K, modal de OC, descuentos, ventas y toast; el HTML serializado mostraba entidades (`&lt;img`) y el texto quedaba literal; `window.__xss` nunca se activó.
  - Prueba funcional: el botón real «Historial de Precios» de un producto normal (clic real) abrió su modal correctamente — confirma que las entidades en `onclick` se decodifican y ejecutan bien para datos normales.
  - Limpieza: datos falsos retirados del estado en memoria y pantallas re-renderizadas (619 productos, sin residuos); consola del navegador sin errores.

### 30 de Septiembre de 2026 - Preparación VPS (código): fin de credenciales incrustadas y Alembic confiable
- **Contexto:** el repositorio estuvo en GitHub con contraseñas reales en el historial (`.env` filtrado); además había credenciales incrustadas (hardcoded) en varios archivos que rompían el principio de configuración por entorno y hacían inservible el código en un servidor nuevo.
- **`backend/app/database.py`:** eliminado el respaldo con contraseña incrustada. Ahora, si `DATABASE_URL` no está definida, la aplicación falla de inmediato con un `RuntimeError` que indica copiar `.env.example` a `.env`. Sin credenciales silenciosas en el código.
- **`backend/app/services.py`:**
  - `seed_admin_if_empty` ya no crea el admin con contraseña fija: usa `ADMIN_INITIAL_PASSWORD` si existe; si no, genera una aleatoria (`secrets.token_urlsafe(16)`) y la imprime **una única vez** en los logs del arranque (con aviso de cambiarla). `USUARIO ADMIN CREADO AUTOMÁTICAMENTE`.
  - Los dos respaldos de contraseña en `crear_backup_db` y `restaurar_backup_db` (usados al parsear `DATABASE_URL` del contenedor) ya no caen en una contraseña incrustada: leen `POSTGRES_PASSWORD` del entorno y, si falta, registran un error claro y devuelven `None`/`False`.
- **Scripts operativos saneados (sin credenciales ni URLs incrustadas):**
  - `app/reset_admin_2fa.py` — requiere `ADMIN_RESET_PASSWORD` por entorno (`docker exec -e ADMIN_RESET_PASSWORD='...'`).
  - `test_api.py` — requiere `TEST_ADMIN_PASSWORD` por entorno.
  - `backfill_june.py` y `db_patch.py` — requieren `DATABASE_URL` por entorno (`SystemExit` con mensaje si falta).
- **`.env.example`:** documenta la nueva variable opcional `ADMIN_INITIAL_PASSWORD` (solo se usa la primera vez con BD vacía).
- **Alembic confiable (la migración fallaba en servidores nuevos):**
  - Causa raíz: el esquema siempre lo creó `create_all` del lifespan (main.py), no Alembic; la tabla `alembic_version` existía vacía (nunca sellada) y la migración `0f0cc4f0840a` asumía tablas ya creadas → en una BD nueva fallaba y en la de desarrollo habría chocado con `ALTER` de columnas existentes.
  - Solución: `0f0cc4f0840a` reescrita como **baseline idempotente**: `models.Base.metadata.create_all(bind)` como base + guardas con `sa.inspect()` antes de cada operación (columnas `tipo_compra`, `canal_compra`, `marca`, `pago_msi`, `meses_msi`; índice único `ix_usuarios_email`; FK `fk_movimientos_producto_id` con `ondelete='SET NULL'`). El id de revisión y `down_revision=None` no cambian.
  - **Verificación en BD nueva** (`alembic_test`): creó las 12 tablas, selló la revisión, la segunda ejecución fue un no-op (idempotente) y los objetos incrementales quedaron creados; BD de prueba eliminada.
  - **Verificación en BD de desarrollo:** respaldo previo (`backup_20260930_125036.sql`); 5 movimientos huérfanos (productos ya eliminados) normalizados a `producto_id = NULL` — misma semántica que `ondelete='SET NULL'`; `alembic upgrade head` selló `0f0cc4f0840a` y creó la FK y el índice único. Datos intactos: 619 productos, 446 movimientos, 12 tablas, `/health OK`.
- **Decisiones del usuario (2026-09-30):** rotación de credenciales **ejecutada** ese mismo día (ver entrada siguiente); el mapeo `5432:5432` se conserva por ahora con advertencia explícita en `docker-compose.yml` (retirarlo antes del VPS sigue siendo obligatorio); respaldos automáticos sin cambios (24 h / 7 copias); endurecimiento del VPS **solo documentado** (ver «Guía de endurecimiento para VPS»).

### 30 de Septiembre de 2026 - Rotación de credenciales ejecutada (contraseña de BD + `SECRET_KEY`)
- **Contexto:** la contraseña de PostgreSQL, la `SECRET_KEY` y la del admin quedaron publicadas en el historial de GitHub; el usuario aprobó rotarlas ahora desde la máquina local. Los valores nuevos nunca se imprimieron en pantalla (generados y escritos en el momento).
- **Qué se rotó:** contraseña del rol `inventario` en PostgreSQL (`ALTER ROLE ... PASSWORD`, 24 bytes hex = 48 caracteres seguros para URL/SQL) y, en `.env`, `POSTGRES_PASSWORD`, la contraseña dentro de `DATABASE_URL` y `SECRET_KEY` (32 bytes hex). Respaldo previo del `.env` guardado **fuera del repositorio** (`~/.qoder/tmp/env_pre_rotacion_*.bak`).
- **Orden a prueba de fallos:** pre-chequeo del formato del `.env` → `ALTER ROLE` (si falla, aborta antes de tocar el `.env`) → reescritura del `.env` respetando CRLF → verificación enmascarada («restos de valores antiguos: ninguno»).
- **Consecuencias esperadas:** todos los JWT emitidos quedaron invalidados (los usuarios deben iniciar sesión de nuevo); el contenedor `db` conserva la contraseña vieja en su entorno (inerte: PostgreSQL solo la usa al crear el volumen) y la siguiente recreación completa la purga. La contraseña del admin se restablece cuando el usuario quiera: `docker exec -e ADMIN_RESET_PASSWORD='<nueva-contraseña>' inventario_api python -m app.reset_admin_2fa`.
- **Verificación end-to-end (con la imagen reconstruida, ver entrada siguiente):** `/health` → 200; consulta desde el contenedor con la contraseña nueva → 619 productos, 446 movimientos, 1 usuario; respaldo de prueba creado por `pg_dump` con la contraseña nueva (`backup_20260930_134659.sql`) y limpieza de copias antiguas funcionando; `/productos` sin token → 401; frontend `:3000` → 200.
- **Prueba en navegador de la invalidación de sesiones:** se tomó un JWT auténtico emitido a las 12:42 (una hora **antes** de la rotación, aún vigente por fecha hasta las 20:42) y se cargó como sesión activa: al recargar, `GET /auth/me` respondió **401** (firma ya no coincide con la `SECRET_KEY` nueva), la app ejecutó el logout automático (hallazgo #9) y mostró «⏰ Tu sesión expiró. Inicia sesión de nuevo.»; el token quedó borrado de `localStorage`. Es la prueba directa de que **todas** las sesiones emitidas antes de la rotación quedaron invalidadas.

### 30 de Septiembre de 2026 - `requirements.txt` corrupto (python-dateutil) y build local con TLS interceptado
- **Síntoma:** al recrear el contenedor del backend para aplicar el `.env` rotado, entró en bucle de reinicio: `ModuleNotFoundError: No module named 'dateutil'` (`services.py` y `backfill_june.py` importan `dateutil.relativedelta`).
- **Causa raíz:** la última línea de `backend/requirements.txt` estaba codificada en **UTF-16LE** (`p\0y\0t\0h\0o\0n\0...\0\r\0\n\0`) — una edición histórica mezcló texto de 16 bits dentro del archivo UTF-8 y pip nunca interpretó esa línea, así que la imagen jamás instaló `python-dateutil`. Pasaba inadvertido porque el contenedor en marcha lo tenía instalado a mano (instalación que se pierde en cada recreación).
- **Corrección:** `requirements.txt` reescrito limpio (UTF-8/LF) con `python-dateutil==2.9.0.post0` explícito.
- **Segundo obstáculo — build local:** `docker compose build` fallaba en `pip install` con `CERTIFICATE_VERIFY_FAILED` hacia pypi.org (interceptación TLS del antivirus local — mismo origen que el problema de git). Solución en `backend/Dockerfile`: `ARG PIP_EXTRA=""` → **vacío por defecto (el VPS compila con TLS estricto)**; la máquina local compila con `--build-arg PIP_EXTRA="--trusted-host pypi.org --trusted-host files.pythonhosted.org"`.
- **Verificación:** imagen reconstruida; contenedor arriba y estable (sin bucle); resultados de la rotación al final de la entrada anterior. El respaldo programado del scheduler (24 h) corrió en el arranque y limpió copias antiguas, como estaba diseñado.
- **Pendiente de commit (cuando el usuario lo pida):** este `requirements.txt`, el `Dockerfile` con `PIP_EXTRA`, la advertencia del `5432` en `docker-compose.yml` y estas entradas de bitácora.

### 30 de Septiembre de 2026 - Passkeys (WebAuthn) como segundo factor de inicio de sesión
- **Contexto:** el usuario preguntó si el login puede quedar anclado a una llave pública/privada. Se decidió (elección del usuario) implementar **passkeys (WebAuthn/FIDO2) como segundo factor tras la contraseña**, **conviviendo** con el TOTP actual (no lo sustituye): el usuario elige en pantalla el método que tenga configurado. La llave privada vive en el dispositivo (Windows Hello, huella, llave USB) y **nunca sale de él**; el servidor guarda solo la llave pública.
- **Modelo y migración:** nueva tabla `webauthn_credentials` en `models.py` (usuario_id FK `ondelete=CASCADE`, `credential_id` único, `public_key`, `sign_count`, `transports`, `nombre`, creado, ultimo_uso). Migración Alembic `a3f8c2d91b47` (encadenada sobre `0f0cc4f0840a`), con la misma guarda idempotente `sa.inspect(bind).has_table` que el baseline.
- **Backend (`services.py`, sección WebAuthn):** `py_webauthn==3.0.1`; configuración por entorno `WEBAUTHN_RP_ID` (def. `localhost`), `WEBAUTHN_RP_NAME` (def. `Inventario Pro`), `WEBAUTHN_ORIGIN` (def. `http://localhost:3000`, admite lista) documentadas en `.env.example`. Retos de registro/login en memoria con TTL de 5 min (válido con el único worker de uvicorn del compose). `user_verification=required` (huella/PIN obligatorios), verificación de `sign_count` contra clonación (401 si retrocede) y actualización de `ultimo_uso`.
- **Endpoints (routers delgados en `main.py`):** gestión autenticada — `POST /auth/webauthn/register/options`, `POST /auth/webauthn/register/verify`, `GET /auth/webauthn/credenciales`, `DELETE /auth/webauthn/credenciales/{id}`; login — `POST /auth/webauthn/login/options` y `POST /auth/webauthn/login/verify` (públicos, exigen `temp_token` de 5 min con claim `2fa_pending`; rate limit `10/min;100/h`). `POST /auth/login` ahora devuelve además `metodos_2fa` (`["totp"]`, `["passkey"]` o ambos) para que el frontend pinte la pantalla de verificación correcta.
- **Frontend (`app.js` v1.3.0, `index.html`):** pantalla 2FA unificada que muestra botón passkey «🔑 Usar huella / PIN» y/o el bloque TOTP (con separador «— o —» si hay ambos), mensaje informativo si el navegador no soporta passkeys; helpers base64url↔ArrayBuffer; gestión desde la barra lateral con botón 🔑 «Passkey» (visible solo si el navegador puede usarlas) → modal para registrar este dispositivo (con nombre), listar y eliminar credenciales.
- **Operación:** `reset_admin_2fa.py` ahora también elimina las passkeys del usuario al resetear; `backend/test_webauthn_flow.py` (prueba de flujo completo, autoclimpiante): 30/30 verificaciones OK.
- **Verificación end-to-end en navegador (autenticador software inyectado):** registro de passkey desde la UI → aparece en la lista → eliminación → re-registro; login completo «contraseña → pantalla 2FA solo-passkey → JWT»; caso negativo (cancelar verificación) muestra error en español y no deja sesión; auditoría en BD: eventos WEBAUTHN_REGISTER / WEBAUTHN_DELETE / LOGIN_WEBAUTHN y `sign_count=1` (anti-clonación activa). Usuario de prueba creado en el contenedor y **eliminado al terminar** (0 residuos).
- **Limitación / VPS:** WebAuthn exige **contexto seguro** — funciona en `localhost` y en HTTPS, **no** en IP plana por LAN. Antes del despliegue definir `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME` y `WEBAUTHN_ORIGIN` en el `.env` del servidor (con el dominio real).
- **Pendiente de commit (cuando el usuario lo pida):** `models.py`, migración `a3f8c2d91b47`, `services.py`, `main.py`, `app.js`/`index.html`, `reset_admin_2fa.py`, `.env.example`, `test_webauthn_flow.py`, `requirements.txt` (py_webauthn) y esta entrada de bitácora.

### 30 de Septiembre de 2026 - Snapshot completo del proyecto + guía de migración al VPS

- **Contexto:** el usuario quiere llevarse todo al VPS y ya cuenta con `snapshot.py`; pidió crear el snapshot con el trabajo de hoy (passkeys y correcciones) y una secuencia copiar-y-pegar para restaurarlo en el servidor.
- **Snapshot creado:** `versiones_seguras/Inventario_Snapshot_20260930_152728.zip` (12.0 MB; 1.762 archivos) con el código completo, `.env` local, `backups/`, `base_de_datos_snapshot.sql` (269 KB) y la migración de passkeys `a3f8c2d91b47`. Los contenedores se detuvieron ~1 min durante el empaquetado y se levantaron de nuevo (verificado: `/health` 200; BD intacta con 619 productos / 446 movimientos y sello `a3f8c2d91b47`).
- **Detalle operativo:** en esta máquina (consola cp1252) `snapshot.py` falla con `UnicodeEncodeError` por los emojis de sus `print`; se ejecuta con `python -X utf8 snapshot.py`. El ZIP incluye `backend/.venv` (venv de Windows) — inútil en Linux; se documentó su borrado en el VPS.
- **Documentación:** nueva subsección «Variante rápida: migrar todo desde un snapshot» dentro de la Guía de endurecimiento (contenido del ZIP, edits obligatorios pre-arranque, orden seguro de restauración — `up db` → `pg_isready` → `psql` → `up --build` — y recambio del RP ID de las passkeys).

### 30 de Septiembre de 2026 - Conteo Físico: plantilla Excel (descarga e importación) — `conteo.js` v1.1.0

- **Contexto:** el usuario pidió contar el inventario con una plantilla externa: descargar un Excel con los productos organizados «como aparecen en el inventario», llenarlo a mano y reimportarlo para que la app muestre la tabla de diferencias. Tres decisiones acordadas antes de programar: (1) se incluyen **todas las tallas** de un color que tenga stock ≥ 1 (aunque alguna talla esté en 0, para no perderlas del conteo); (2) la plantilla es **ciega** — sin columna «Sistema» — para no sesgar el conteo; (3) celda vacía = producto omitido (sin ajuste); un `0` explícito = ajustar a cero.
- **Sin cambios de backend:** todo el flujo vive en el navegador con ExcelJS 4.3.0 (la misma librería del export de Excel).
- **`descargarPlantillaConteo()` (nuevo en `conteo.js` v1.1.0):** genera `Plantilla_Conteo_<fecha>.xlsx` al vuelo. Hoja «Conteo» con columnas Grupo/Color/Talla/SKU/Conteo, una fila separadora gris por bloque de color, validación de datos `≥ 0` en la columna Conteo y hoja «Instrucciones» con las reglas (vacío = omitir, 0 = ajustar a cero). Con los datos reales actuales: **12 grupos de color, 50 tallas**.
- **`importarConteoFisico()` (nuevo):** lee el `.xlsx` y aplica las reglas de negocio: vacío se omite; `0` es válido; números negativos, no enteros, SKUs desconocidos y duplicados se omiten **con aviso** (panel «⚠️ Avisos de importación», máx. 15). Si ya hay un conteo en curso pide confirmación para reemplazarlo (cancelar no cambia nada). Los productos importados alimentan el mismo flujo existente (tabla diferencial + «Evaluar y Aplicar Ajustes»).
- **UI (`index.html`):** tarjeta «📄 Conteo por Plantilla Excel» con botones «⬇️ Descargar plantilla» e «📤 Importar conteo», input de archivo oculto y panel de avisos; `conteo.js` → `v1.1.0` (bust de caché).
- **Verificación en banco de pruebas (Node + ExcelJS):** estructura de la plantilla (encabezados, 12 separadores, 50 filas de datos, celdas de conteo vacías y resaltadas, validación E2:E63, hoja Instrucciones) y parseo correcto de conteo válido + los 5 avisos (SKU desconocido, duplicado, «abc», «-2», cantidad sin SKU). Todo en verde.
- **Verificación en navegador con datos reales:** descarga real (blob de 9.926 bytes, idéntico al de referencia; validado en disco: 12 grupos / 50 tallas / validación / Instrucciones), importación real de un archivo lleno (5 productos, total 10, 4 diferencias, 5 avisos, toast «Importados 5 productos (4 con diferencias) · 5 aviso(s)»), reemplazo con confirmación (total 14, avisos limpios), caso negativo (archivo corrupto → toast de error y el conteo intacto) y cancelación del reemplazo (no cambia nada).
- **Nota de entorno de pruebas (solo automatización):** en la pestaña oculta del navegador automatizado, la *lectura* de `.xlsx` con ExcelJS se cuelga por el *throttling* de temporizadores de pestañas ocultas. No es un bug de la app (en una pestaña normal funciona); se resolvió en el banco de pruebas inyectando un shim de temporizadores antes de recargar el bundle de ExcelJS.
- **Pendiente de commit (cuando el usuario lo pida):** `frontend/conteo.js` (v1.1.0), `frontend/index.html` y esta entrada de bitácora.

### 30 de Septiembre de 2026 - `index.html` sin caché heurística (config nginx propia del frontend)

- **Contexto:** tras la mejora del conteo, el usuario no veía la tarjeta «Conteo por Plantilla Excel» aunque el servidor ya servía el HTML correcto: el navegador cacheaba `index.html` de forma heurística porque nginx **no enviaba `Cache-Control`** (solo `Last-Modified`/`ETag`). Tras Ctrl+Shift+R apareció. Para que los empleados del VPS reciban las actualizaciones sin recargas forzadas, el usuario aprobó añadir cabeceras no-cache al HTML.
- **Cambio:** nuevo archivo `nginx/frontend.conf` (fuera de `frontend/` para que no quede servido públicamente) montado en el servicio `frontend` de `docker-compose.yml` como `/etc/nginx/conf.d/default.conf:ro`, reemplazando el default de la imagen nginx (se conserva `listen [::]:80`, que el entrypoint de la imagen habría añadido). Incluye `location = /index.html` con `add_header Cache-Control "no-cache" always`; la petición a `/` hace redirect interno a `/index.html` y re-evalúa el *location matching*, por lo que la cabecera también aplica a la raíz. Los assets JS/CSS no cambian: siguen versionados con `?v=` (la URL cambia al actualizar), así que no necesitan cabeceras extra.
- **Verificación:** `docker compose up -d frontend` (recreó el contenedor con el nuevo montaje); `curl -I` → `Cache-Control: no-cache` en `/` y `/index.html`, con `Last-Modified`/`ETag` intactos (la revalidación sigue devolviendo 304 cuando no hay cambios); `styles.css` y `app.js` → 200 sin cambios; carga en navegador OK (título «Inventario Pro», `conteo.js?v=1.1.0` y las funciones de plantilla registradas).
- **Nota VPS:** el ZIP `Inventario_Snapshot_20260930_152728.zip` se creó **antes** de este cambio; antes de migrar hay que **regenerar el snapshot** o copiar aparte `nginx/frontend.conf` y el `docker-compose.yml` editado.
- **Pendiente de commit (cuando el usuario lo pida):** `nginx/frontend.conf` (nuevo), `docker-compose.yml` y esta entrada de bitácora.

### 30 de Septiembre de 2026 - Snapshot regenerado (conteo Excel + nginx sin caché) y `snapshot.py` robusto ante bloqueos de Office

- **Contexto:** el ZIP del mediodía (`…_152728`) quedó desactualizado tras el conteo por plantilla (`conteo.js` v1.1.0) y la config nginx sin caché; el usuario pidió regenerarlo para la futura migración al VPS. Los «pendientes de commit» de las dos entradas anteriores se cerraron en el commit `28c6147`, pusheado a GitHub.
- **Incidencia y arreglo:** el primer intento falló a mitad con `PermissionError` sobre `~$Plantilla_Conteo_2026-09-30.xlsx` (archivo de bloqueo temporal de Excel abierto, ilegible). Los contenedores se levantaron de inmediato y el ZIP parcial se borró. `snapshot.py` ahora **omite los archivos `~$*`** durante el empaquetado (nunca deben ir en un snapshot): ya no importa si hay un Excel abierto.
- **Snapshot creado:** `versiones_seguras/Inventario_Snapshot_20260930_184642.zip` (12,0 MB; 1.764 archivos). Verificado: incluye `nginx/frontend.conf`, `docker-compose.yml` con el montaje, `frontend/conteo.js` v1.1.0 e `index.html` con `conteo.js?v=1.1.0`; dump `base_de_datos_snapshot.sql` (269 KB, con passkeys); sin `versiones_seguras/` ni `~$` dentro. Contenedores arriba (`/health` 200, web 200), BD intacta: 619 productos / 446 movimientos / 1 passkey, sello `a3f8c2d91b47`.
- **Sustituye al del mediodía** como snapshot de referencia (referencia actualizada en la «Variante rápida» de la guía).
- **Pendiente de commit (cuando el usuario lo pida):** `snapshot.py` (omisión de `~$*`) y esta entrada de bitácora.

### 30 de Septiembre de 2026 - Playeras en devolución: piezas con foto obligatoria, columna «Devueltas» y apartado propio

- **Necesidad:** el usuario pidió "un espacio para las playeras en devolución". La clave del diseño salió de su propia operación: *«puedo tener dos playeras negras de la misma talla disponibles pero con diseños diferentes»* → cada pieza devuelta se registra con el **diseño fotografiado**, no solo con producto/color/talla.
- **Decisiones aprobadas por el usuario (antes de programar):** (1) origen de las piezas = **«Devueltas por clientes»**; (2) **sí cuentan en stock** al registrarse; (3) **descartar baja el stock** (opción recomendada); (4) permisos = **admin registra/edita/descarta, todos venden**; (5) **foto obligatoria** (eligió la variante más estricta: ninguna pieza se registra sin imagen).
- **Backend · modelo y migración:** nueva tabla `Devolucion` en `models.py` (`producto_id` FK `ON DELETE SET NULL`, `producto_nombre`, `color`, `talla`, `variante`, `diseno`, `imagen`, `qty`, `precio Numeric(12,2)`, `folio_origen`, `motivo`, `notas`, `estado` indexado `disponible|vendida|descartada`, `fecha_ingreso`, `fecha_salida`). Migración Alembic **`c4d9e7a12f63_add_devoluciones.py`** (`down_revision = a3f8c2d91b47`), aplicada en el contenedor: `alembic current` → `c4d9e7a12f63 (head)` — **nueva revisión de referencia para el VPS** (guía de endurecimiento actualizada).
- **Backend · servicios (`services.py`, routers delgados según directriz #3):** `crear_devolucion` (foto obligatoria; `ya_contada` evita sumar stock dos veces cuando la devolución parcial ya lo ajustó; sin ella suma `qty` y graba `Movimiento` de entrada con canal «Devolución registrada»), `editar_devolucion` (ajusta stock por la diferencia **solo** en estado `disponible`), `subir_imagen_devolucion` (reemplazo: borra el archivo anterior), `vender_devolucion` (folio `YYYYMMDD-DEV{id}-HHMMSS`, `Movimiento` de venta canal «Devolución», `fecha_salida`, estado `vendida`; re-vender → 400), `descartar_devolucion` (baja stock con mínimo 0, `Movimiento` de ajuste canal «Devolución descartada»; re-descartar → 400), `get_devoluciones` (filtros estado/producto + búsqueda flexible reutilizando `_coincide_busqueda`) y `get_devoluciones_resumen` (unidades disponibles por producto para la columna «Devueltas»). Auditoría: `CREAR_DEVOLUCION`, `EDITAR_DEVOLUCION`, `SUBIR_FOTO_DEVOLUCION`, `VENDER_DEVOLUCION`, `DESCARTAR_DEVOLUCION` (recurso `Devolucion`).
- **Backend · endpoints y roles (`main.py`):** `GET /devoluciones` y `GET /devoluciones/resumen` → admin/vendedor/bodeguero; `POST /devoluciones` (multipart, `foto` requerida), `PATCH /devoluciones/{id}`, `POST /devoluciones/{id}/imagen`, `POST /devoluciones/{id}/descartar` → **solo admin**; `GET /devoluciones/{id}/imagen` (`FileResponse`) → admin/vendedor/bodeguero; `POST /devoluciones/{id}/vender` → admin/vendedor. `POST /ventas/devolver` (admin) ahora crea las piezas devueltas y las devuelve en `{status, mensaje, devoluciones:[…]}`.
- **Almacenamiento y validación de imágenes:** carpeta `backend/uploads/devoluciones/` (misma ruta en host y contenedor vía el bind `./backend:/app`), nombre generado `dev_{id}_{uuid4hex[:12]}{ext}`. `validar_imagen_devolucion` exige extensión declarada en la lista blanca (`.jpg/.jpeg/.png/.webp`), contenido no vacío, ≤**8 MB** y **firma binaria real** (FFD8FF / 89504E47 / RIFF…WEBP) — no basta el `Content-Type`. Las fotos **no** las sirve nginx: solo el endpoint autenticado. Documentado como punto 7 de la capa de Hardening.
- **Frontend:**
  - **`frontend/devoluciones.js` v1.1.0 (nuevo):** apartado «↩️ Devoluciones» (`#nav-devoluciones` / `#page-devoluciones`) con filtros por estado, buscador, KPI de unidades disponibles, tarjetas con foto (objectURL cacheado), alta manual con buscador de productos, edición, modal de venta y descarte con confirmación. Botones condicionados por rol (`_devEsAdmin`, `_devPuedeVender`). `comprimirImagenDevolucion`: canvas ≤1000 px, relleno blanco, JPEG 0.82 → una foto de **3.5 MB quedó en 10.5 KB**.
  - **`frontend/app.js` v1.4.1:** columna «**Devueltas**» en la tabla de inventario (tooltip «Unidades en devolución disponibles para reventa») alimentada por `/devoluciones/resumen`; modal «Devolver» del Historial extendido con reparto **por diseño** (`dp-slot`: qty + foto por diseño, contador de unidades restantes, validación de que la suma no exceda lo devuelto y de que cada diseño tenga ≥1 unidad); `window.devResumenDisponibles` compartido con el módulo.
  - **`frontend/index.html` / `styles.css` v2.0.3:** markup del apartado, cabecera de la columna y estilos de tarjetas/slots; bust de caché `app.js?v=1.4.1`, `devoluciones.js?v=1.1.0`.
- **`.gitignore`:** agregado `backend/uploads/` (las fotos son datos de usuarios, no código). **Snapshot:** `snapshot.py` **sí** las empaqueta (su `os.walk` solo excluye `.git`, `__pycache__`, `venv`, `node_modules`, `versiones_seguras`, `~$*` y `.zip`/`.pyc`); el ZIP de referencia vigente es `…_232316` (regenerado tras el commit, ya con la migración `c4d9e7a12f63` y `devoluciones.js`; sin entradas `uploads/` porque todavía no hay fotos reales). En Linux además hay que dar escritura al `uid 999` del contenedor sobre `backend/uploads` y `backups` (paso añadido al post-arranque de la guía).
- **Verificación E2E en el contenedor (script temporal `backend/qa_devoluciones_e2e.py`, eliminado al terminar):** **40/40 PASS con impacto neto cero y autolimpieza**. Cubrió: alta con foto (201, `imagen="dev_3_….png"`, precio heredado 289.0, stock 6→8) · `GET` de la imagen (200, 70 bytes idénticos, `content-type image/png`) · resumen `{producto: 2}` y listado · `PATCH` de qty 2→1 y precio 123.45 (stock 8→7) · reemplazo de foto (un único archivo en disco, el anterior borrado, bytes == PNG nuevo) · venta de la segunda pieza (folio `20260930-DEV4-221035`, estado `vendida`, stock 7) y re-venta → 400 · descarte (estado `descartada`, stock 6 = neto 0) y re-descarte → 400 · firma binaria inválida → 400 «El archivo no es una imagen válida (JPG, PNG o WEBP).» · sin `foto` → 422 · `diseno="   "` → 400 «Describe el diseño de la pieza devuelta» · `PATCH` qty 0 sobre pieza vendida → 400 · **roles**: como vendedor, POST/PATCH/descartar/subir foto → 403 y GET listado/imagen → 200. Limpieza verificada contra baseline (fotos borradas, stock 6→6, 0 devoluciones, 5 movimientos, sin `AuditLog` residuales). Antes se había probado el flujo de piezas del modal en el DOM (reparto, validaciones y subida 1:1) en `localhost:3000`.
- **Nota de entorno de pruebas (solo automatización):** `httpx` se instaló **únicamente en el contenedor en marcha** (`docker exec -u 0 inventario_api pip install --no-cache-dir --trusted-host pypi.org --trusted-host files.pythonhosted.org httpx`; `-u 0` porque `appuser` no puede escribir en su home y los `--trusted-host` por la interceptación TLS de Avast). **`requirements.txt` no cambió**: un build fresco en el VPS queda igual. La prueba usó `httpx.ASGITransport` dentro de un único `asyncio.run` (no `TestClient`, que corre la app en otro event loop y el pool de asyncpg está ligado al loop) y lectura por columnas (`select(Producto.qty)`) para evitar `MissingGreenlet`.
- **Commiteado:** `97c1d59` — *feat: playeras en devolución con foto obligatoria (devoluciones.js v1.1.0)* (12 archivos, +1.712/−41): `.gitignore`, `backend/app/{models,schemas,services,main}.py`, `backend/alembic/versions/c4d9e7a12f63_add_devoluciones.py` (nuevo), `frontend/{app.js,index.html,styles.css}`, `frontend/devoluciones.js` (nuevo), `snapshot.py` (cambio previo: omisión de `~$*`) y esta entrada de bitácora.

### 30 de Septiembre de 2026 - Snapshot regenerado tras el commit de devoluciones (nueva referencia para el VPS)

- **Motivo:** el ZIP de referencia `…_184642` era anterior al módulo de devoluciones (0 entradas con `devoluciones`); había que regenerarlo para que la migración al VPS lleve la tabla, la migración y el apartado nuevo.
- **Snapshot creado:** `versiones_seguras/Inventario_Snapshot_20260930_232316.zip` (11,5 MB; **1.766 archivos**) con `python -X utf8 snapshot.py`. Verificado por inspección del ZIP: contiene las **3 migraciones** (`0f0cc4f0840a`, `a3f8c2d91b47`, `c4d9e7a12f63_add_devoluciones.py`), `frontend/devoluciones.js`, `nginx/frontend.conf` y el dump `base_de_datos_snapshot.sql` (270,6 KB); sin entradas `.git/`, `versiones_seguras/` ni `~$`. `uploads/` vacío = correcto: todavía no hay fotos reales (el E2E se autolimpió).
- **Estado tras el reinicio de contenedores que hace el script:** `/health` → 200, web → 200, `alembic current` → `c4d9e7a12f63 (head)`, BD: **619 productos / 461 movimientos / 0 devoluciones / 1 passkey**. Los 461 movimientos (frente a los 446 de la entrada anterior) son actividad normal del día; el E2E quedó con impacto neto cero.
- **Esta referencia sustituye a `…_184642`** (actualizada en la «Variante rápida» de la guía de endurecimiento).

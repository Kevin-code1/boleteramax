# BoletaMax

BoletaMax es una plataforma de venta y validación de boletos para eventos. Integra catálogo, búsqueda asistida por IA, selección de asientos, cotizaciones firmadas por el servidor, cuentas de compradores, persistencia de órdenes y boletos con QR.

## Funcionalidades

- Catálogo de eventos con filtros y búsqueda en lenguaje natural mediante `/api/ai-search`.
- Inventario de asientos consultado desde la fuente configurada y validado nuevamente al comprar.
- Compras para invitados o usuarios registrados con correo verificado.
- Una orden por compra, con comprador, importes en centavos, `order_items`, boletos y registro de pago.
- Escritura atómica en PostgreSQL para evitar órdenes o boletos parciales.
- Boletos con QR estático, QR dinámico y flujo de validación para staff.
- Respaldo JSON y herramientas de migración y comparación con PostgreSQL.

## Requisitos

- Node.js 18 o posterior.
- PostgreSQL 14 o posterior para los modos basados en base de datos.
- Una clave de OpenAI para habilitar la búsqueda asistida por IA.

## Instalación

1. Instala las dependencias:

   ```powershell
   npm install
   ```

2. Crea el archivo de entorno a partir del ejemplo:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Configura al menos `DATABASE_URL` y `OPENAI_API_KEY` en `.env`.

4. Crea la base de datos y aplica las migraciones:

   ```powershell
   createdb boletamax
   npm run db:migrate
   npm run db:verify
   ```

5. Inicia la aplicación:

   ```powershell
   npm start
   ```

La interfaz queda disponible en [http://localhost:3000](http://localhost:3000).

Para desarrollo con reinicio automático:

```powershell
npm run dev
```

## Configuración

Las variables disponibles están documentadas en `.env.example`. Las principales son:

- `DATABASE_URL`: conexión a PostgreSQL.
- `OPENAI_API_KEY`: credencial para la búsqueda asistida por IA.
- `TICKETS_STORAGE`: fuente de lectura (`postgres-primary`, `postgres`, `dual-read` o `json`).
- `TICKETS_WRITE_MODE`: estrategia de escritura (`postgres-primary`, `dual-write` o `json`).
- `CHECKOUT_SIGNING_SECRET`: secreto para firmar cotizaciones.
- `TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET_KEY`: protección de checkout con Cloudflare Turnstile.
- `ADMIN_API_KEY`: autenticación del personal de validación.
- `PUBLIC_BASE_URL` y `APP_BASE_URL`: URLs públicas para boletos y verificación de correo.
- `SMTP_*`: entrega de correos de verificación.

Los valores predeterminados usan PostgreSQL como fuente principal y conservan una copia JSON:

```env
TICKETS_STORAGE=postgres-primary
TICKETS_WRITE_MODE=postgres-primary
```

Para operar temporalmente solo con JSON:

```env
TICKETS_STORAGE=json
TICKETS_WRITE_MODE=json
```

## Base de datos y migración

```powershell
npm run db:migrate
npm run db:verify
npm run db:compare-json -- --limit=50
```

Para importar el respaldo histórico de boletos:

```powershell
npm run tickets:migrate:dry-run
npm run tickets:migrate
npm run tickets:db:count
```

El migrador crea un respaldo antes de escribir y evita mostrar tokens privados completos.

## Pruebas

```powershell
npm test
```

La suite cubre inventario, precios, persistencia de compras, modos de almacenamiento, cuentas, verificación de correo, QR dinámico y validación de acceso.

## Estructura

- `src/domain`: reglas de negocio y validaciones.
- `src/application`: casos de uso.
- `src/ports`: contratos de servicios externos.
- `src/adapters`: HTTP, persistencia, catálogo, correo, QR y búsqueda.
- `db`: acceso a PostgreSQL, repositorios y modos de almacenamiento.
- `js`: módulos del frontend.
- `tests`: pruebas unitarias y flujos de integración.

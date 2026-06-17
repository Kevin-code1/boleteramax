# BoletaMax

Frontend premium de boletera con búsqueda asistida por IA en lenguaje natural.

## Requisitos

- Node.js 18+
- PostgreSQL 14+ para la infraestructura de base de datos
- Una API key de OpenAI

## Configuración

1. Instala dependencias:
   `npm install`
2. Crea tu archivo de entorno:
   `copy .env.example .env`
3. Agrega tu `OPENAI_API_KEY` en `.env`
4. Configura PostgreSQL en `.env`:
   `DATABASE_URL=postgres://postgres:postgres@localhost:5432/boletamax`

## Base de datos PostgreSQL

Fase 1 agrega infraestructura PostgreSQL empresarial sin cambiar el flujo actual de boletos en JSON.

1. Crea una base local llamada `boletamax`:
   `createdb boletamax`
2. Ejecuta migraciones:
   `npm run db:migrate`
3. Verifica conexion:
   `npm run db:verify`

Si `db:verify` termina sin fallas, PostgreSQL conecta correctamente y la integridad base esta en buen estado.

## Migracion paralela de boletos

Fase 2 permite copiar `data/tickets.json` hacia PostgreSQL sin cambiar todavia el funcionamiento de la app. El backend sigue usando JSON hasta una fase posterior.

- Simular migracion sin escribir datos:
  `npm run tickets:migrate:dry-run`
- Ejecutar migracion real con backup previo:
  `npm run tickets:migrate`
- Verificar conteos entre JSON y PostgreSQL:
  `npm run tickets:db:count`

El migrador no imprime tokens privados completos y usa hashes para guardar tokens sensibles en PostgreSQL.

## Storage de tickets

BoletaMax usa PostgreSQL como fuente principal de lectura por defecto y conserva JSON como respaldo temporal.

- Modo principal por defecto:
  `TICKETS_STORAGE=postgres-primary`
- Rollback temporal a JSON:
  `TICKETS_STORAGE=json`
- Leer tickets desde PostgreSQL:
  `TICKETS_STORAGE=postgres`
- Leer primero PostgreSQL y caer a JSON si falta el ticket:
  `TICKETS_STORAGE=dual-read`
- Leer estrictamente desde PostgreSQL:
  `TICKETS_STORAGE=postgres-primary`

Este flag solo afecta lectura en `GET /api/tickets`, `GET /api/tickets/:ticketId` y `GET /api/tickets/:ticketId/dynamic-qr`. La escritura de compras se controla con `TICKETS_WRITE_MODE`.

## Escritura de compras

BoletaMax guarda compras primero en PostgreSQL por defecto. Despues de confirmar PostgreSQL, escribe una copia temporal en `data/tickets.json`.

- Modo principal por defecto:
  `TICKETS_WRITE_MODE=postgres-primary`
- Rollback temporal a JSON:
  `TICKETS_WRITE_MODE=json`
- Guardar primero en JSON y luego intentar PostgreSQL:
  `TICKETS_WRITE_MODE=dual-write`
- Guardar primero en PostgreSQL y luego copia temporal en JSON:
  `TICKETS_WRITE_MODE=postgres-primary`

Si PostgreSQL falla en `dual-write`, la compra sigue existiendo en JSON y el servidor registra solo un warning seguro.
Si PostgreSQL falla en `postgres-primary`, la compra no emite boletos.

Ejecutar pruebas:
`npm test`

## Verificacion fuerte antes de retirar JSON

Auditar integridad interna de PostgreSQL:
`npm run db:verify`

Comparar `data/tickets.json` contra PostgreSQL:
`npm run db:compare-json`

Limitar la muestra de diferencias:
`npm run db:compare-json -- --limit=20`

Activar PostgreSQL como principal:
```env
TICKETS_STORAGE=postgres-primary
TICKETS_WRITE_MODE=postgres-primary
```

Volver temporalmente a JSON:
```powershell
$env:TICKETS_STORAGE="json"
$env:TICKETS_WRITE_MODE="json"
npm start
```

Rollback en `.env`:
```env
TICKETS_STORAGE=json
TICKETS_WRITE_MODE=json
```

Modo intermedio de observacion:
```powershell
$env:TICKETS_STORAGE="dual-read"
$env:TICKETS_WRITE_MODE="dual-write"
npm start
```

Checklist antes de produccion:
- `npm run db:migrate` sin migraciones pendientes.
- `npm run db:verify` sin errores.
- `npm run db:compare-json -- --limit=50` con 0 faltantes, 0 extras y 0 diferencias publicas.
- `npm test` con el e2e postgres-primary aprobado cuando `DATABASE_URL` este configurado.
- `DATABASE_URL` configurado en el entorno real.
- `ADMIN_API_KEY` configurada en produccion.
- Defaults sin variables explicitas resuelven a `TICKETS_STORAGE=postgres-primary` y `TICKETS_WRITE_MODE=postgres-primary`.
- Si falta `DATABASE_URL` en modo principal, el servidor debe fallar antes de iniciar sin imprimir secretos.
- Rollback a `TICKETS_STORAGE=json` y `TICKETS_WRITE_MODE=json` probado antes del cambio.

## Ejecutar

- Desarrollo:
  `npm run dev`
- Producción/local:
  `npm start`

Abre [http://localhost:3000](http://localhost:3000).

## Qué hace la búsqueda IA

- Interpreta texto natural en `/api/ai-search`
- Convierte la consulta en filtros estructurados
- Busca sobre `data/events.json`
- Reutiliza `openTicketModal(...)`, `bm_event` y `bm_cart` sin cambiar el flujo de compra existente

## Flujo intacto

- `checkout.html` no se modifica
- El flujo de compra sigue guardando en `sessionStorage`
- Al elegir un resultado de búsqueda se sigue abriendo el modal actual de compra

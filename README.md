# Calendario del Depa 🌴

Calendario compartido de reservas para el depa en South Padre Island.
Sin login: cualquiera con el link puede reservar días, y se sincroniza en vivo
entre todos. Construido con React + Vite y Supabase.

## Funcionalidad

- 📅 Vista mensual, navegable hasta diciembre 2029.
- ✍️ Reservas con nombre libre (sin cuenta), seleccionando un rango de días.
- 🚫 Sin choques: no se permiten reservas que se traslapen (garantizado en la base de datos).
- 🔄 Sincronización en vivo entre todos los que abran el link (Supabase Realtime).

## Configuración local

1. Instala dependencias:
   ```bash
   npm install
   ```
2. Crea un archivo `.env` (puedes copiar `.env.example`) con tus credenciales de Supabase:
   ```
   VITE_SUPABASE_URL=https://tu-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=tu-publishable-o-anon-key
   ```
3. En tu proyecto de Supabase, corre el script `supabase/schema.sql` en el SQL Editor
   para crear la tabla `reservations` con el constraint anti-traslapes.
4. Arranca el servidor de desarrollo:
   ```bash
   npm run dev
   ```

## Despliegue en Vercel

Es una app Vite estándar; Vercel la detecta automáticamente
(build: `npm run build`, output: `dist`). En la configuración del proyecto en Vercel,
agrega las mismas variables de entorno:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

> Las variables `VITE_` se exponen al navegador. Es seguro porque la publishable/anon
> key está protegida por las políticas RLS de Supabase.

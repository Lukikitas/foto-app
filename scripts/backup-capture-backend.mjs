import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const env = await readFile(path.join(root, '.env'), 'utf8');
const ref = env.match(/^VITE_SUPABASE_URL\s*=\s*['"]?https:\/\/([a-z0-9]+)\.supabase\.co/m)?.[1];
if (!ref) throw new Error('No se pudo identificar el proyecto configurado.');
const folder = path.join(root, 'output', 'capture-backend-20261029.local');
await mkdir(folder, { recursive: true });
const target = path.join(folder, 'before.json.gz');
if (await access(target).then(() => true, () => false)) throw new Error('El respaldo previo ya existe; no se reemplazó.');
const query = path.join(folder, 'backup-query.sql');
await writeFile(query, `select jsonb_build_object(
  'at',now(), 'photos',(select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from public.photos p),
  'register_function',pg_get_functiondef(to_regprocedure('public.register_photo_capture(uuid,text,text,text,text,text,timestamptz)')),
  'capture_column_exists',exists(select 1 from information_schema.columns where table_schema='public' and table_name='photos' and column_name='capture_id')
) as backup;`);
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const cli = path.join(process.env.APPDATA, 'npm', 'supabase.cmd');
const command = `& ${quote(cli)} db query --linked --project-ref ${ref} --file ${quote(query)} --output json`;
const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024, timeout: 90_000 });
if (result.status !== 0) throw new Error('Falló el respaldo remoto. No se modificó la base.');
const payload = JSON.parse(result.stdout);
const backup = payload.rows?.[0]?.backup;
if (!Array.isArray(backup?.photos)) throw new Error('No se pudo verificar el respaldo recibido.');
await writeFile(target, gzipSync(JSON.stringify(backup)), { flag: 'wx' });
console.log(`Respaldo local verificado: ${backup.photos.length} registros, columna de captura previa: ${backup.capture_column_exists}. Incluye metadatos; los archivos de evidencia permanecen en Storage.`);

import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const env = Object.fromEntries((await readFile(path.join(root, '.env'), 'utf8')).split(/\r?\n/)
  .map(line => line.match(/^\s*(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY)\s*=\s*(.*?)\s*$/)).filter(Boolean)
  .map(([, key, value]) => [key, value.replace(/^(['"])(.*)\1$/, '$2')]));
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk');
await access(sdk);
if (!env.VITE_SUPABASE_URL?.startsWith('https://') || !env.VITE_SUPABASE_ANON_KEY) throw new Error('Falta la configuración pública de Supabase.');
await writeFile(path.join(root, 'android-camera', 'local.properties'),
  `sdk.dir=${sdk.replaceAll('\\', '/').replace(':', '\\:')}\nSUPABASE_URL=${env.VITE_SUPABASE_URL}\nSUPABASE_ANON_KEY=${env.VITE_SUPABASE_ANON_KEY}\n`);
console.log('Configuración Android local lista. Solo incluye URL y clave pública; no se imprimieron valores.');

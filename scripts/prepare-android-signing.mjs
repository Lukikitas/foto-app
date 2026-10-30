import { access, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const folder = path.resolve(import.meta.dirname, '../android-camera');
const properties = path.join(folder, 'signing.properties');
if (await access(properties).then(() => true, () => false)) {
  console.log('Se conserva la identidad de firma existente.');
} else {
  const keystore = path.join(folder, 'pilot-signing.local');
  if (await access(keystore).then(() => true, () => false)) throw new Error('Existe un keystore sin configuración. No se reemplazó; recuperar sus datos de firma.');
  const password = randomBytes(32).toString('base64url');
  const result = spawnSync('keytool', ['-genkeypair', '-alias', 'foto-capture', '-keyalg', 'RSA', '-keysize', '3072',
    '-validity', '10000', '-keystore', keystore, '-storetype', 'PKCS12', '-storepass:env', 'FOTO_SIGNING_PASSWORD',
    '-keypass:env', 'FOTO_SIGNING_PASSWORD', '-dname', 'CN=Delivery Star Capture Pilot'],
  { env: { ...process.env, FOTO_SIGNING_PASSWORD: password }, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('No se pudo preparar la firma local. Verificá keytool en el JDK.');
  await writeFile(properties, `storeFile=pilot-signing.local\nkeyAlias=foto-capture\nstorePassword=${password}\n`, { mode: 0o600, flag: 'wx' });
  console.log('Identidad de firma preparada en archivos privados ignorados por Git. Conservar juntos signing.properties y pilot-signing.local para futuras actualizaciones.');
}

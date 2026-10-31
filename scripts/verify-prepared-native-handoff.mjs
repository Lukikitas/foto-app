import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { JSDOM } from 'jsdom';
import { nativeCameraLinks, NATIVE_CAMERA_PACKAGE } from '../src/lib/nativeCamera.js';

// Offline preparation check. Public availability is a separate release gate,
// verified by verify-android-pilot.mjs before the eventual Pages deployment.
const manifest = JSON.parse(await readFile('public/manual/piloto-android/update.json', 'utf8'));
const defaultFolder = 'output/native-handoff-20261030.local';
const filename = `Delivery-Star-Fotos-${manifest.versionName}.apk`;
const apkPath = process.argv[2] || `${defaultFolder}/${filename}`;
const folder = dirname(apkPath);
assert.equal(basename(apkPath), filename);
const bytes = await readFile(apkPath);
const hash = createHash('sha256').update(bytes).digest('hex');
assert.equal(hash, manifest.sha256, 'The staged update manifest must match the signed APK');
assert.equal((await readFile(`${apkPath}.sha256`, 'utf8')).trim(), `${hash}  ${filename}`);
const version = manifest.versionName.replace(/-pilot$/, '');
assert.equal(manifest.downloadUrl, `https://github.com/Lukikitas/foto-app/releases/download/android-capture-pilot-v${version}/${filename}`);
const page = new JSDOM(await readFile('public/manual/piloto-android/index.html', 'utf8')).window.document;
assert.equal(page.querySelector('a.download')?.href, manifest.downloadUrl);
assert.equal(page.querySelector('code')?.textContent, hash);
const links = nativeCameraLinks('https://delivery.star-app.com.ar');
const gradle = await readFile('android-camera/app/build.gradle.kts', 'utf8');
if (gradle.includes('buildConfigField("boolean", "CAPTURE_TEMPORARILY_CLOSED", "true")')) {
  assert.equal(page.querySelector('.open-camera'), null, 'The closed app must not offer an entry point');
  assert.equal(page.querySelectorAll('a').length, 1, 'Only updating is available during closure');
} else {
  assert.equal(page.querySelector('.open-camera')?.href, links.open);
}
assert.equal(Number(gradle.match(/versionCode = (\d+)/)?.[1]), manifest.versionCode);
assert.equal(gradle.match(/versionName = "([^"]+)"/)?.[1], manifest.versionName);
assert.ok(gradle.includes(`applicationId = "${NATIVE_CAMERA_PACKAGE}"`));
const xml = new JSDOM(await readFile('android-camera/app/src/main/AndroidManifest.xml', 'utf8'), { contentType: 'text/xml' }).window.document;
const android = 'http://schemas.android.com/apk/res/android';
const activity = [...xml.querySelectorAll('activity')].find(node => node.getAttributeNS(android, 'name') === '.MainActivity');
assert.equal(activity?.getAttributeNS(android, 'launchMode'), 'singleTask');
const filter = [...activity.querySelectorAll('intent-filter')].find(node => node.querySelector('data')?.getAttributeNS(android, 'scheme') === 'deliverystar');
assert.equal(filter?.querySelector('data')?.getAttributeNS(android, 'host'), 'capture');
assert.ok([...filter.querySelectorAll('category')].some(node => node.getAttributeNS(android, 'name') === 'android.intent.category.BROWSABLE'));
const report = { at: new Date().toISOString(), scope: 'local preparation only; no publication or deployment', versionCode: manifest.versionCode, versionName: manifest.versionName, apkPath, bytes: bytes.length, sha256: hash, downloadUrl: manifest.downloadUrl };
await writeFile(`${folder}/preparation-verification.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const pagePath = 'public/manual/piloto-android/index.html';
const pageUrl = 'https://delivery.star-app.com.ar/manual/piloto-android/';
const localHtml = await readFile(pagePath, 'utf8');
const document = new JSDOM(localHtml).window.document;
const downloadUrl = document.querySelector('a.download')?.href;
assert.ok(downloadUrl?.startsWith('https://github.com/Lukikitas/foto-app/releases/download/'));
const expectedHash = document.querySelector('code')?.textContent.trim();
assert.match(expectedHash, /^[a-f0-9]{64}$/);
const manifest = JSON.parse(await readFile('public/manual/piloto-android/update.json', 'utf8'));
assert.ok(Number.isSafeInteger(manifest.versionCode) && manifest.versionCode > 0);
assert.equal(manifest.downloadUrl, downloadUrl);
assert.equal(manifest.sha256, expectedHash);
assert.ok(downloadUrl.endsWith(`/Delivery-Star-Fotos-${manifest.versionName}.apk`));
const path = new URL(downloadUrl).pathname.split('/');
const tag = path[5];
const filename = path[6];
const jsonResponse = await fetch(`https://api.github.com/repos/Lukikitas/foto-app/releases/tags/${encodeURIComponent(tag)}`, {
  headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30_000),
});
assert.equal(jsonResponse.status, 200, 'The pilot release must be readable without authentication');
const release = await jsonResponse.json();
assert.equal(release.draft, false);
assert.equal(release.prerelease, true);
const asset = release.assets.find(item => item.name === filename);
assert.ok(asset, 'The signed APK must be attached');
assert.equal(asset.browser_download_url, downloadUrl);
assert.equal(asset.digest, `sha256:${expectedHash}`);

const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(120_000) });
assert.equal(response.status, 200, 'The APK must download without a GitHub account');
const hash = createHash('sha256');
let bytes = 0;
for await (const chunk of response.body) { bytes += chunk.length; hash.update(chunk); }
assert.equal(bytes, asset.size);
assert.equal(hash.digest('hex'), expectedHash);

let pageVerified = false;
if (process.argv.includes('--live')) {
  const pageResponse = await fetch(pageUrl, { signal: AbortSignal.timeout(30_000) });
  assert.equal(pageResponse.status, 200);
  const liveDocument = new JSDOM(await pageResponse.text()).window.document;
  assert.equal(liveDocument.querySelector('a.download')?.href, downloadUrl);
  assert.equal(liveDocument.querySelector('code')?.textContent.trim(), expectedHash);
  assert.ok(liveDocument.body.textContent.includes('Compartir diagnóstico'));
  const manifestResponse = await fetch(new URL('update.json', pageUrl), {
    headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30_000),
  });
  assert.equal(manifestResponse.status, 200);
  assert.deepEqual(await manifestResponse.json(), manifest, 'The update banner must offer the same signed APK as the page');
  pageVerified = true;
}
const report = { at: new Date().toISOString(), pageUrl, pageVerified, downloadUrl,
  authenticated: false, prerelease: true, versionCode: manifest.versionCode, bytes, sha256: expectedHash };
const folder = 'output/android-camera-20261029.local';
await mkdir(folder, { recursive: true });
await writeFile(`${folder}/public-pilot-verification.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));

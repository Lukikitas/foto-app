import { readFile, writeFile } from 'node:fs/promises';
import { ImageMagick, initializeImageMagickx64, MagickFormat, MagickColor, MagickColors, Drawables, PathMoveToAbs, PathLineToAbs } from '@imagemagick/magick-wasm';
await initializeImageMagickx64(await readFile(new URL('../node_modules/@imagemagick/magick-wasm/dist/x64/magick.wasm', import.meta.url)));
const svg = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8');
const coords = svg.match(/d="M([^"Z]+)Z"/)[1].trim().split(/\s+/).map(Number);
const points = Array.from({ length: coords.length / 2 }, (_, i) => [coords[i * 2], coords[i * 2 + 1]]);
for (const [name, size, format] of [['pwa-512.png', 512, MagickFormat.Png], ['pwa-maskable-512.png', 512, MagickFormat.Png], ['pwa-192.png', 192, MagickFormat.Png], ['apple-touch-icon.png', 180, MagickFormat.Png], ['favicon.ico', 48, MagickFormat.Ico]]) {
  const bytes = ImageMagick.read(name.includes('maskable') ? new MagickColor('#fffaf5') : MagickColors.Transparent, 1024, 1024, image => {
    new Drawables().fillColor(new MagickColor('#fffaf5')).roundRectangle(0, 0, 1024, 1024, 200, 200)
      .fillColor(new MagickColor('#e4002b')).path([...points.map(([x, y], i) => i ? new PathLineToAbs(x * 2, y * 2) : new PathMoveToAbs(x * 2, y * 2)), new PathLineToAbs(points[0][0] * 2, points[0][1] * 2)]).draw(image);
    image.resize(size, size);
    return image.write(format, output => Buffer.from(output));
  });
  await writeFile(new URL('../public/' + name, import.meta.url), bytes);
}
console.log('Generated red star icons from public/favicon.svg.');

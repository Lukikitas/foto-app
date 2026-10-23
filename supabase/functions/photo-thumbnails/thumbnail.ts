import { ImageMagick, initializeImageMagick, MagickFormat } from 'npm:@imagemagick/magick-wasm@0.0.45';
const ready = Deno.readFile(new URL('./assets/magick.wasm', import.meta.url)).then(initializeImageMagick);
export async function renderThumbnail(original: Uint8Array): Promise<Uint8Array> {
  if (original.length>10*1024*1024) throw new Error('La imagen excede el límite de procesamiento de miniaturas.');
  await ready;
  return ImageMagick.read(original, image => {
    image.autoOrient();
    const scale = Math.min(1,480/Math.max(image.width,image.height));
    image.resize(Math.max(1,Math.round(image.width*scale)),Math.max(1,Math.round(image.height*scale)));
    image.quality = 75;
    image.strip();
    return image.write(MagickFormat.Jpeg, bytes => Uint8Array.from(bytes));
  });
}

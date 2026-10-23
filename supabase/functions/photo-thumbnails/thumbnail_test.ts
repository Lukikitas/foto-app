import { renderThumbnail } from './thumbnail.ts';
import { ImageMagick, MagickFormat } from 'npm:@imagemagick/magick-wasm@0.0.45';
Deno.test('real WASM codec creates a bounded JPEG and preserves original bytes', async () => {
  const input=await Deno.readFile(new URL('../../../public/pwa-512.png',import.meta.url));
  const before=input.slice();
  const result=await renderThumbnail(input);
  const dimensions=ImageMagick.read(result,image=>({width:image.width,height:image.height,format:image.format}));
  if(dimensions.width!==480 || dimensions.height!==480 || dimensions.format!==MagickFormat.Jpeg)throw new Error('Incorrect thumbnail dimensions or format');
  if(input.some((byte,index)=>byte!==before[index]))throw new Error('Original changed');
});

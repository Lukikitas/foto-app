import { mkdir, copyFile } from 'node:fs/promises';
const target=new URL('../supabase/functions/photo-thumbnails/assets/',import.meta.url);
await mkdir(target,{recursive:true});
await copyFile(new URL(import.meta.resolve('@imagemagick/magick-wasm/magick.wasm')),new URL('magick.wasm',target));
await copyFile(new URL('../LICENSE',import.meta.resolve('@imagemagick/magick-wasm')),new URL('LICENSE',target));
await copyFile(new URL('../NOTICE',import.meta.resolve('@imagemagick/magick-wasm')),new URL('NOTICE',target));
console.log('Prepared pinned ImageMagick WASM and license for thumbnail deployment.');

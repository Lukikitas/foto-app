export const OCR_MAX_SIDE = 2000;
export const TICKET_TARGET_SIDE = 1800;

export function buildRecognitionPasses({
  enhancedFull,
  regionCrops = [],
  extraBands = [],
  PSM,
  thorough = true,
}) {
  const firstSources = [enhancedFull, regionCrops[0]].filter(Boolean);
  const extraSources = [...regionCrops.slice(1), ...extraBands].filter(Boolean);

  const lightPasses = [
    {
      sources: firstSources,
      rotations: [0],
      psms: [PSM.SINGLE_BLOCK],
      variants: ['plain', 'binary'],
    },
    {
      sources: firstSources,
      rotations: [0],
      psms: [PSM.AUTO],
      variants: ['plain'],
    },
  ];

  if (!thorough) return lightPasses.filter((pass) => pass.sources.length);

  return [
    ...lightPasses,
    {
      sources: extraSources,
      rotations: [0],
      psms: [PSM.AUTO, PSM.SPARSE_TEXT],
      variants: ['plain'],
    },
    {
      sources: firstSources,
      rotations: [180],
      psms: [PSM.SINGLE_BLOCK, PSM.AUTO],
      variants: ['plain', 'invert'],
    },
    {
      sources: firstSources,
      rotations: [90, 270],
      psms: [PSM.AUTO],
      variants: ['plain'],
    },
  ].filter((pass) => pass.sources.length && pass.psms.length);
}

export function countRecognitionJobs(passes) {
  return passes.reduce((total, pass) => {
    let sourceCount = 0;
    if (pass.variants.includes('plain')) sourceCount += pass.sources.length;
    if (pass.variants.includes('binary')) sourceCount += pass.sources.length;
    if (pass.variants.includes('invert')) sourceCount += pass.sources.length;
    return total + sourceCount * pass.rotations.length * pass.psms.length;
  }, 0);
}

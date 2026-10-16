// Per-request registry of responsive image variants (PRD §76). The web data layer registers the
// `image_variants` map returned by the API; <Artwork> turns it into a WebP srcset automatically,
// so every theme gets modern-format images without changing its markup.
export type ImageVariants = Record<string, string>;

// URL → variants is public, tenant-independent data, so a bounded process-wide map is safe and survives
// memoised data calls shared between generateMetadata and the page render.
const store = new Map<string, ImageVariants>();
const MAX = 20000;
const registry = () => store;

export function registerImageVariants(map?: Record<string, ImageVariants> | null) {
  if (!map) return;
  const r = registry();
  for (const [k, v] of Object.entries(map)) {
    if (r.size >= MAX && !r.has(k)) r.delete(r.keys().next().value as string);
    r.set(k, v);
  }
}

const WIDTHS: [string, number][] = [['thumbnail', 150], ['small', 300], ['medium', 600], ['large', 1400]];

/** srcset string for an original image URL, or undefined when no processed variants exist. */
export function variantSrcSet(url?: string | null): string | undefined {
  if (!url) return undefined;
  let v: ImageVariants | undefined;
  try {
    v = registry().get(url);
  } catch {
    return undefined;
  }
  if (!v) return undefined;
  const parts = WIDTHS.filter(([k]) => v![k]).map(([k, w]) => `${v![k]} ${w}w`);
  return parts.length ? parts.join(', ') : undefined;
}

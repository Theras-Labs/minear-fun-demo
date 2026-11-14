// Seeded PRNG and integer hash. Bundle play-inUT-NSi.js lines 32801-32822.

/** Deterministic PRNG: returns a function that yields floats in [0, 1). */
export function seededRandom(seed: number): () => number { // Q_ (32801)
  let t = seed >>> 0;
  return () => {
    t = (t + 1831565813) >>> 0;
    let e = t;
    e = Math.imul(e ^ (e >>> 15), e | 1);
    e ^= e + Math.imul(e ^ (e >>> 7), e | 61);
    return ((e ^ (e >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash of three ints and a seed. Returns a uint32. */
export function hash3(x: number, y: number, z: number, seed = 0): number { // $_ (32813)
  let i = seed ^ 2654435769;
  i = Math.imul(i ^ x, 2246822507);
  i = Math.imul(i ^ (i >>> 13) ^ y, 3266489909);
  i = Math.imul(i ^ (i >>> 16) ^ z, 668265263);
  i ^= i >>> 15;
  return i >>> 0;
}

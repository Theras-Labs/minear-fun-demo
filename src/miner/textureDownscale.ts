// Port of play-inUT-NSi.js 45545-45594: touch-mode texture downscale for loaded models.
import * as THREE from 'three';
import { IS_TOUCH } from '../game/device';

const downscaled = new WeakMap<object, HTMLCanvasElement>(); // MT (45545)

/** In touch mode, redraws every texture of the object into a canvas capped at maxSize px. */
export function downscaleTextures(object: THREE.Object3D, maxSize = 1024): void { // NT (45546)
  if (!IS_TOUCH) return;
  object.traverse((node) => {
    const material = (node as THREE.Mesh).material;
    if (material)
      for (const mat of Array.isArray(material) ? material : [material])
        for (const value of Object.values(mat))
          if ((value as THREE.Texture | null)?.isTexture) downscaleTexture(value as THREE.Texture, maxSize);
  });
}

/** Copies one texture into a capped canvas (shared per source); shrinks the kept canvas to 64 px after upload. */
export function downscaleTexture(texture: THREE.Texture, maxSize: number): void { // PT (45555)
  let canvas = downscaled.get(texture.source);
  if (!canvas) {
    const image = texture.image as unknown;
    if (
      !(
        (typeof ImageBitmap < 'u' && image instanceof ImageBitmap) ||
        image instanceof HTMLImageElement ||
        image instanceof HTMLCanvasElement
      ) ||
      !image.width ||
      !image.height
    )
      return;
    const k = Math.min(1, maxSize / Math.max(image.width, image.height));
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * k));
    canvas.height = Math.max(1, Math.round(image.height * k));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (typeof ImageBitmap < 'u' && image instanceof ImageBitmap) image.close();
    downscaled.set(texture.source, canvas);
    texture.image = canvas;
    texture.needsUpdate = true;
  }
  const kept = canvas;
  texture.onUpdate = () => {
    texture.onUpdate = null;
    const k = 64 / Math.max(kept.width, kept.height);
    if (k >= 1) return;
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.round(kept.width * k));
    small.height = Math.max(1, Math.round(kept.height * k));
    small.getContext('2d')?.drawImage(kept, 0, 0, small.width, small.height);
    kept.width = small.width;
    kept.height = small.height;
    kept.getContext('2d')?.drawImage(small, 0, 0);
  };
}

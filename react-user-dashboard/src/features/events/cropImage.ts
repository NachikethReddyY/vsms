import type { Area } from 'react-easy-crop';

const MAX_ARTWORK_LENGTH = 175_000;

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The selected image could not be read.'));
    image.src = source;
  });
}

export async function createCroppedArtwork(source: string, crop: Area) {
  const image = await loadImage(source);
  const sizes = [800, 720, 640, 560, 480];
  const qualities = [0.78, 0.66, 0.54, 0.42];

  for (const size of sizes) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image cropping is not available in this browser.');
    context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, size, size);

    for (const quality of qualities) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length <= MAX_ARTWORK_LENGTH) return dataUrl;
    }
  }

  throw new Error('This image is too detailed to save. Try a smaller image.');
}
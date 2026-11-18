export function extractFaceDescriptorFromVideo(video: HTMLVideoElement): number[] | null {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    return null;
  }

  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  // Capture center-face region of interest
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const cropW = Math.round(vw * 0.48);
  const cropH = Math.round(vh * 0.62);
  const sx = Math.round((vw - cropW) / 2);
  const sy = Math.round((vh - cropH) * 0.42);

  ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, size, size);
  const imgData = ctx.getImageData(0, 0, size, size).data;

  const raw: number[] = [];
  let sum = 0;
  for (let i = 0; i < imgData.length; i += 4) {
    const lum = 0.299 * imgData[i] + 0.587 * imgData[i + 1] + 0.114 * imgData[i + 2];
    raw.push(lum);
    sum += lum;
  }

  const mean = sum / raw.length;
  let sqSum = 0;
  const centered = raw.map((v) => {
    const d = v - mean;
    sqSum += d * d;
    return d;
  });

  const norm = Math.sqrt(sqSum);
  // Reject pitch-black or completely flat frames
  if (mean < 12 || norm < 25) {
    return null;
  }

  return centered.map((v) => Number((v / norm).toFixed(4)));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const va = Number(a[i]) || 0;
    const vb = Number(b[i]) || 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function captureVideoSnapshotFile(
  video: HTMLVideoElement,
  filenamePrefix: string
): Promise<File | null> {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 240;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.82)
  );
  if (!blob) return null;
  return new File([blob], `${filenamePrefix}-${Date.now()}.jpg`, { type: 'image/jpeg' });
}

export type StudyImageCapture =
  { kind: "pdf"; blob: Blob } | { kind: "epub"; blob: Blob; figure: number; description: string };

export type StudyImageCrop = { left: number; top: number; right: number; bottom: number };
export const fullStudyImage: StudyImageCrop = { left: 0, top: 0, right: 100, bottom: 100 };

export function studyCropPixels(crop: StudyImageCrop, width: number, height: number) {
  const x = Math.floor((crop.left * width) / 100);
  const y = Math.floor((crop.top * height) / 100);
  return {
    x,
    y,
    width: Math.ceil((crop.right * width) / 100) - x,
    height: Math.ceil((crop.bottom * height) / 100) - y,
  };
}

export function studyCardImage(image: HTMLImageElement, crop: StudyImageCrop) {
  if (!image.naturalWidth || !image.naturalHeight) return;
  const area = studyCropPixels(crop, image.naturalWidth, image.naturalHeight);
  if (area.width < 1 || area.height < 1) return;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return;
  const scale = Math.min(1, 2000 / Math.max(area.width, area.height));
  canvas.width = Math.max(1, Math.round(area.width * scale));
  canvas.height = Math.max(1, Math.round(area.height * scale));
  context.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const data = canvas.toDataURL("image/webp", 0.9);
  const size = data.length - data.indexOf(",") - 1;
  return data.startsWith("data:image/") && size <= Math.floor((2 * 1024 * 1024 * 4) / 3)
    ? data
    : undefined;
}

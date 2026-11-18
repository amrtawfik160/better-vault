import { fromBase64 } from "@/lib/base64";
import { studyImageCropSchema, type StudyImageContext, type StudyImageCrop, type StudyVisualOrigin } from "./records";

export type StudyImageCapture = { crop?: StudyImageCrop } & (
  { kind: "pdf"; blob: Blob } | { kind: "epub"; blob: Blob; figure: number; description: string }
);

export const fullStudyImage: StudyImageCrop = { left: 0, top: 0, right: 100, bottom: 100 };

export function isCroppedStudyImage({ left, top, right, bottom }: StudyImageCrop) {
  return left > 0 || top > 0 || right < 100 || bottom < 100;
}

export function studyImageCropKey({ left, top, right, bottom }: StudyImageCrop) {
  return [left, top, right, bottom].join(",");
}

export function readStudyImageCrop(value: string | null) {
  if (!value || !/^\d{1,3}(,\d{1,3}){3}$/.test(value)) return;
  const [left, top, right, bottom] = value.split(",").map(Number);
  const crop = studyImageCropSchema.safeParse({ left, top, right, bottom }).data;
  return crop && isCroppedStudyImage(crop) ? crop : undefined;
}

export function studyImageAnchor(capture: StudyImageCapture): StudyVisualOrigin {
  const crop = capture.crop && isCroppedStudyImage(capture.crop) ? capture.crop : undefined;
  return capture.kind === "pdf"
    ? { kind: "pdf", top: (crop?.top ?? 0) * 100, ...(crop && { crop }) }
    : { kind: "epub", figure: capture.figure, ...(crop && { crop }) };
}

export function studyImageId(bookId: string, section: number, anchor: StudyVisualOrigin) {
  const position = anchor.kind === "pdf" ? anchor.top : anchor.figure;
  const id = `study-image:${encodeURIComponent(bookId)}:${section}:${anchor.kind}:${position}`;
  return anchor.crop ? `${id}:${studyImageCropKey(anchor.crop)}` : id;
}

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
export type StudyImageSnapshot = {
  context: StudyImageContext;
  file: { mime: string; data: Uint8Array };
};

export function studyImageFile(dataUrl: string): StudyImageSnapshot["file"] {
  const [header, encoded] = dataUrl.split(",", 2);
  return { mime: header.slice(5, -7), data: fromBase64(encoded) };
}

export async function captureStudyImage(
  capture: StudyImageCapture,
): Promise<StudyImageSnapshot | undefined> {
  const url = URL.createObjectURL(capture.blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const snapshot = studyCardImage(image, capture.crop ?? fullStudyImage);
    if (!snapshot) return;
    return {
      context: {
        anchor: studyImageAnchor(capture),
        description: capture.kind === "epub" ? capture.description.slice(0, 500) : undefined,
      },
      file: studyImageFile(snapshot),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

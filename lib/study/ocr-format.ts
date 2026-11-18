import { z } from "zod";

export const maxOcrPixels = 4_000_000;
export const maxOcrSide = 2800;
export const maxOcrBytes = 17 * 1024 * 1024;
export const maxOcrText = 40_000;
export const ocrLanguage = z.string().regex(/^[a-z]{3}(?:_[a-z]+)*$/);
export const ocrLanguages = z.array(ocrLanguage).min(1).max(2);
export const ocrText = z.string().min(1).max(maxOcrText);

export function isOcrPng(bytes: Uint8Array) {
  if (bytes.byteLength < 33 || bytes.byteLength > maxOcrBytes) return false;
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = header.getUint32(16);
  const height = header.getUint32(20);
  return header.getUint32(0) === 0x89504e47 && header.getUint32(4) === 0x0d0a1a0a &&
    header.getUint32(8) === 13 && header.getUint32(12) === 0x49484452 &&
    width > 0 && height > 0 && width <= maxOcrSide && height <= maxOcrSide &&
    width * height <= maxOcrPixels;
}

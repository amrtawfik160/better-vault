export const voiceSampleRate = 16_000;
export const maxVoiceSeconds = 90;
export const maxVoiceBytes = 44 + maxVoiceSeconds * voiceSampleRate * 2;

export function encodeVoiceWav(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  view.setUint32(0, 0x52494646); // RIFF
  view.setUint32(4, buffer.byteLength - 8, true);
  view.setUint32(8, 0x57415645); // WAVE
  view.setUint32(12, 0x666d7420); // fmt
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, voiceSampleRate, true);
  view.setUint32(28, voiceSampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461); // data
  view.setUint32(40, samples.length * 2, true);
  for (const [index, sample] of samples.entries()) {
    view.setInt16(44 + index * 2, Math.max(-32768, Math.min(32767, sample * 32768)), true);
  }
  return buffer;
}

export function isVoiceWav(bytes: Uint8Array): boolean {
  if (bytes.byteLength <= 44 || bytes.byteLength > maxVoiceBytes || bytes.byteLength % 2) {
    return false;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return (
    view.getUint32(0) === 0x52494646 &&
    view.getUint32(4, true) === bytes.byteLength - 8 &&
    view.getUint32(8) === 0x57415645 &&
    view.getUint32(12) === 0x666d7420 &&
    view.getUint32(16, true) === 16 &&
    view.getUint16(20, true) === 1 &&
    view.getUint16(22, true) === 1 &&
    view.getUint32(24, true) === voiceSampleRate &&
    view.getUint32(28, true) === voiceSampleRate * 2 &&
    view.getUint16(32, true) === 2 &&
    view.getUint16(34, true) === 16 &&
    view.getUint32(36) === 0x64617461 &&
    view.getUint32(40, true) === bytes.byteLength - 44
  );
}

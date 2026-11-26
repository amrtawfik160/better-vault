const onsetMs = 160;
const pauseMs = 1_200;

export function studyVoiceActivity() {
  let lastFrame: number | undefined;
  let activity = 0;
  let silence = 0;
  let speaking = false;
  let noise = 0;

  return (level: number, time: number, muted: boolean): "speech" | "pause" | undefined => {
    const elapsed = Math.min(75, time - (lastFrame ?? time));
    lastFrame = time;
    if (muted) return;
    if (speaking) {
      silence = level >= Math.max(0.01, noise * 2) ? 0 : silence + elapsed;
      if (silence >= pauseMs) return "pause";
    } else if (level >= Math.max(0.018, noise * 3)) {
      activity += elapsed;
      if (activity >= onsetMs) {
        speaking = true;
        return "speech";
      }
    } else {
      noise = noise * 0.94 + level * 0.06;
      activity = Math.max(0, activity - elapsed / 2);
    }
  };
}

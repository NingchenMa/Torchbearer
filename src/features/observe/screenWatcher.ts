"use client";
// Screen watcher for the floating Torchbearer: the user shares any screen, window or tab;
// every FRAME_MS we grab a frame and report whether it changed (cheap 32x18 thumbnail diff),
// so only changed screens go to the LLM and "no change for a while" can mean "paused".

const FRAME_MS = 500; // two screenshots per second; only changed ones go to the LLM, one call at a time

export interface Frame {
  dataUrl: string;
  changed: boolean;
  at: number;
}

export class ScreenWatcher {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private prevThumb: Uint8ClampedArray | null = null;
  paused = false;
  lastChange = 0;

  /** Must be called from a click (the browser asks the user what to share). */
  async start(onFrame: (f: Frame) => void, onEnded: () => void) {
    // Suggest the whole screen so the bot sees any browser tab or app the user works in.
    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 5, displaySurface: "monitor" },
      audio: false,
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
      monitorTypeSurfaces: "include",
    } as DisplayMediaStreamOptions);
    this.video = document.createElement("video");
    this.video.srcObject = this.stream;
    this.video.muted = true;
    await this.video.play();
    this.stream.getVideoTracks()[0].addEventListener("ended", () => {
      this.stop();
      onEnded();
    });
    this.lastChange = Date.now();
    this.timer = setInterval(() => {
      if (this.paused) return;
      const thumb = this.thumbnail();
      if (!thumb) return;
      const changed = !this.prevThumb || diff(this.prevThumb, thumb) > 3;
      if (changed) {
        this.prevThumb = thumb;
        this.lastChange = Date.now();
      }
      const dataUrl = this.grab(1024);
      if (dataUrl) onFrame({ dataUrl, changed, at: Date.now() });
    }, FRAME_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video = null;
    this.prevThumb = null;
  }

  get active() {
    return this.stream !== null;
  }

  /** Current screen as a JPEG data URL (also used for step screenshots). */
  grab(width: number): string | null {
    const v = this.video;
    if (!v || !v.videoWidth) return null;
    const c = document.createElement("canvas");
    c.width = width;
    c.height = Math.round((v.videoHeight / v.videoWidth) * width);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.6);
  }

  private thumbnail(): Uint8ClampedArray | null {
    const v = this.video;
    if (!v || !v.videoWidth) return null;
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 18;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(v, 0, 0, 32, 18);
    return ctx.getImageData(0, 0, 32, 18).data;
  }
}

function diff(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let d = 0;
  for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]);
  return d / (a.length / 4);
}

/** Why screen sharing didn't start, in words the user can act on. */
export function shareErrorText(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  const msg = e instanceof Error ? e.message : "";
  if (name === "InvalidStateError" || /gesture|activation/i.test(msg))
    return "Chrome only starts screen recording from the main Torchbearer page. Press ● Start recording there.";
  if (name === "NotAllowedError") return "Screen sharing was cancelled or blocked. Press ● Start recording again and choose Entire screen.";
  return msg || "Screen sharing didn't start. Press ● Start recording again.";
}

/** A failed screen read, in words for the user. The next frame retries, so busy/slow only needs a calm note. */
export function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : "";
  if (/took longer|high demand|overloaded|\b(429|500|503)\b/i.test(m)) return "The AI is slow right now. Still watching, trying again.";
  return "Couldn't read the screen. Trying again.";
}

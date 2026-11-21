import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { stat, unlink } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";

let missingLogged = false;

/**
 * Makes a JPEG thumbnail (a frame at ~1 s, at most 720 px wide) next to the video with ffmpeg.
 * Returns its absolute path, or null when ffmpeg isn't installed / the video can't be read (the upload
 * still succeeds; the app may send its own "thumbnail"). Install ffmpeg on the server to enable this.
 */
export async function makeVideoThumbnail(videoPath: string, durationSec: number): Promise<string | null> {
  const out = path.join(path.dirname(videoPath), `${randomUUID()}.jpg`);
  const at = durationSec >= 2 ? "1" : "0";
  const args = ["-hide_banner", "-loglevel", "error", "-ss", at, "-i", videoPath, "-frames:v", "1", "-vf", "scale='min(720,iw)':-2", "-q:v", "4", "-y", out];
  const ok = await new Promise<boolean>((resolve) => {
    execFile(env.FFMPEG_PATH, args, { timeout: 20_000, windowsHide: true }, (err) => {
      if (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          if (!missingLogged) console.warn("[video] ffmpeg not found: video thumbnails are off (install ffmpeg or set FFMPEG_PATH)");
          missingLogged = true;
        } else console.error("[video] thumbnail failed", (err as Error).message.split("\n")[0]);
        return resolve(false);
      }
      resolve(true);
    });
  });
  if (!ok) {
    await unlink(out).catch(() => undefined);
    return null;
  }
  const s = await stat(out).catch(() => null);
  if (!s?.size) {
    await unlink(out).catch(() => undefined);
    return null;
  }
  return out;
}

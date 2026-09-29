// services/videoRenderService.js
//
// v2: adds crossfade transitions between photos (via ffmpeg's xfade filter)
// instead of a hard concat cut, fixes zoompan framerate judder, and bumps
// encode quality.
//
// v3: width/height are now parameters (default to the old 720x1280
// portrait constants) so output resolution can match whatever the caller
// detected/chose — see videoController.js + utils/orientationDetector.js.

import fs from "fs/promises";
import path from "path";
import os from "os";
import { runFfmpeg, ffprobeDuration } from "../utils/mediaUtils.js";
import { buildPhotoCanvas, VIDEO_WIDTH, VIDEO_HEIGHT } from "./photoCanvasService.js";

const VIDEO_FPS = 30;
const ZOOM_AMOUNT = 0.08;
const TRANSITION_DURATION = 0.5;
const TRANSITION_STYLE = "fade";

function makeWorkDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "real-estate-video-"));
}

function buildZoomExpression(totalFrames) {
  const framesMinusOne = Math.max(totalFrames - 1, 1);
  const t = `(on/${framesMinusOne})`;
  const hump = `((1-cos(2*PI*${t}))/2)`;
  return `1+(${ZOOM_AMOUNT}*${hump})`;
}

// Embeds a JPEG as the video's attached-picture stream (same mechanism
// used for mp3/mp4 cover art). `-c copy` on the video/audio streams means
// this is a fast remux, not a re-encode.
export async function embedThumbnail(videoPath, thumbnailPath, outputPath) {
  await runFfmpeg([
    "-y",
    "-i", videoPath,
    "-i", thumbnailPath,
    "-map", "0",
    "-map", "1",
    "-c", "copy",
    "-c:v:1", "mjpeg",
    "-disposition:v:1", "attached_pic",
    outputPath,
  ]);
  return outputPath;
}

export async function renderZoomClip(
  photoCanvasPath,
  outputPath,
  renderDuration,
  index,
  width = VIDEO_WIDTH,
  height = VIDEO_HEIGHT
) {
  const totalFrames = Math.max(2, Math.round(renderDuration * VIDEO_FPS));
  const zoomExpr = buildZoomExpression(totalFrames);

  const filter =
    `scale=${width * 10}:${height * 10}:flags=lanczos,` +
    `zoompan=z='${zoomExpr}':` +
    `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
    `d=${totalFrames}:s=${width}x${height}:fps=${VIDEO_FPS}`;

  await runFfmpeg([
    "-y",
    "-framerate", String(VIDEO_FPS),
    "-loop", "1",
    "-i", photoCanvasPath,
    "-vf", filter,
    "-t", renderDuration.toFixed(3),
    "-r", String(VIDEO_FPS),
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    outputPath,
  ]);

  return outputPath;
}

async function crossfadeConcatenate(clipPaths, renderDurations, transitionDuration, outputPath) {
  const args = ["-y"];
  clipPaths.forEach((clipPath) => {
    args.push("-i", clipPath);
  });

  const filterParts = [];
  let runningLabel = "0:v";
  let cumulativeDuration = renderDurations[0];

  for (let i = 1; i < clipPaths.length; i += 1) {
    const outLabel = i === clipPaths.length - 1 ? "vout" : `x${i}`;
    const offset = cumulativeDuration - i * transitionDuration;

    filterParts.push(
      `[${runningLabel}][${i}:v]xfade=transition=${TRANSITION_STYLE}:` +
        `duration=${transitionDuration.toFixed(3)}:offset=${offset.toFixed(3)}[${outLabel}]`
    );

    runningLabel = outLabel;
    cumulativeDuration += renderDurations[i];
  }

  args.push(
    "-filter_complex", filterParts.join(";"),
    "-map", `[${runningLabel}]`,
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    outputPath
  );

  await runFfmpeg(args);
  return outputPath;
}

async function muxVideoWithAudio(videoPath, audioPath, outputPath, { trimToAudio = false } = {}) {
  const args = [
    "-y",
    "-i", videoPath,
    "-i", audioPath,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
  ];

  if (trimToAudio) {
    const audioDuration = await ffprobeDuration(audioPath);
    args.push("-t", audioDuration.toFixed(3));
  } else {
    args.push("-shortest");
  }

  args.push("-movflags", "+faststart", outputPath);

  await runFfmpeg(args);
  return outputPath;
}

export async function assembleFinalVideo({
  photoPaths,
  durations,
  audioPath,
  finalOutputPath,
  trimToAudio = false,
  videoWidth = VIDEO_WIDTH,
  videoHeight = VIDEO_HEIGHT,
}) {
  if (photoPaths.length !== durations.length) {
    throw new Error("Photo count and duration count must match");
  }

  const workDir = await makeWorkDir();

  try {
    const shortestDuration = Math.min(...durations);
    const transitionDuration = photoPaths.length > 1
      ? Math.min(TRANSITION_DURATION, shortestDuration * 0.3)
      : 0;

    const clipPaths = [];
    const renderDurations = [];

    for (let index = 0; index < photoPaths.length; index += 1) {
      const isLast = index === photoPaths.length - 1;
      const renderDuration = Math.max(durations[index], 0.5) + (isLast ? 0 : transitionDuration);

      const canvasPath = path.join(workDir, `canvas_${index}.png`);
      const clipPath = path.join(workDir, `clip_${index}.mp4`);

      await buildPhotoCanvas(photoPaths[index], canvasPath, videoWidth, videoHeight);
      await renderZoomClip(canvasPath, clipPath, renderDuration, index, videoWidth, videoHeight);

      clipPaths.push(clipPath);
      renderDurations.push(renderDuration);
    }

    const silentVideoPath = path.join(workDir, "silent_video.mp4");

    if (clipPaths.length === 1) {
      await fs.copyFile(clipPaths[0], silentVideoPath);
    } else {
      await crossfadeConcatenate(clipPaths, renderDurations, transitionDuration, silentVideoPath);
    }

    await muxVideoWithAudio(silentVideoPath, audioPath, finalOutputPath, { trimToAudio });

    return finalOutputPath;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export { VIDEO_FPS, ZOOM_AMOUNT, TRANSITION_DURATION };
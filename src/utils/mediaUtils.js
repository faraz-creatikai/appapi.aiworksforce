// utils/mediaUtils.js
//
// Node has no bundled ffmpeg the way the Python app used imageio_ffmpeg, so
// we pull it in via ffmpeg-static / ffprobe-static (same idea: a portable
// binary, no system install required).
//
// npm i ffmpeg-static ffprobe-static

import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const FFMPEG_BIN = ffmpegPath;
const FFPROBE_BIN = ffprobeStatic.path;

function runCommand(bin, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} exited with code ${code}\n${stderr.slice(-1500)}`));
    });
  });
}

export async function runFfmpeg(args) {
  const { stderr } = await runCommand(FFMPEG_BIN, args);
  return stderr;
}

export async function ffprobeDuration(filePath) {
  const args = [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ];

  const { stdout } = await runCommand(FFPROBE_BIN, args);
  const value = parseFloat(stdout.trim());

  if (Number.isNaN(value)) {
    throw new Error(`Could not read duration of ${filePath}`);
  }

  return value;
}

// Direct port of the Python get_atempo_filter helper. ffmpeg's atempo filter
// only accepts factors between 0.5 and 2.0, so anything outside that range
// gets chained across multiple atempo stages.
export function getAtempoFilter(speedFactorInput) {
  let speedFactor = Math.max(Number(speedFactorInput) || 1, 0.01);
  const filters = [];

  while (speedFactor > 2.0) {
    filters.push("atempo=2.0");
    speedFactor /= 2.0;
  }
  while (speedFactor < 0.5) {
    filters.push("atempo=0.5");
    speedFactor /= 0.5;
  }

  filters.push(`atempo=${speedFactor.toFixed(6)}`);
  return filters.join(",");
}

export { FFMPEG_BIN, FFPROBE_BIN };
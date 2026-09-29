// services/photoCanvasService.js
import sharp from "sharp";

const DEFAULT_WIDTH = 720;
const DEFAULT_HEIGHT = 1280;
const SAFETY_MARGIN = 0.96;
const MIN_FILL_RATIO = 0.88; // photo must cover at least this % of the box on its shorter axis
const BACKDROP_BLUR = 40;

function computeForegroundSize(photoW, photoH, boxW, boxH, minFill) {
  const scaleContain = Math.min(boxW / photoW, boxH / photoH); // zero-crop fit
  const scaleCover = Math.max(boxW / photoW, boxH / photoH);   // full-cover fit (upper bound)

  const fillW = (photoW * scaleContain) / boxW;
  const fillH = (photoH * scaleContain) / boxH;

  let scale = scaleContain;
  if (Math.min(fillW, fillH) < minFill) {
    const neededScale =
      fillW < fillH ? (minFill * boxW) / photoW : (minFill * boxH) / photoH;
    scale = Math.min(neededScale, scaleCover); // never crop more than "cover" would
  }

  return { width: Math.round(photoW * scale), height: Math.round(photoH * scale) };
}

export async function buildPhotoCanvas(inputPath, outputPath, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) {
  const boxWidth = Math.max(1, Math.round(width * SAFETY_MARGIN));
  const boxHeight = Math.max(1, Math.round(height * SAFETY_MARGIN));

  const baseMeta = await sharp(inputPath).rotate().metadata();
  const { width: fgWidth, height: fgHeight } = computeForegroundSize(
    baseMeta.width, baseMeta.height, boxWidth, boxHeight, MIN_FILL_RATIO
  );

  // fgWidth/fgHeight preserve the original aspect ratio (uniform scale), so
  // resizing to them directly doesn't distort anything.
  let foregroundBuffer = await sharp(inputPath).rotate().resize(fgWidth, fgHeight).toBuffer();

  // If the guaranteed-fill scale pushed us past the box, crop back down to it
  // (centered) — this is the "capped crop" that guarantees MIN_FILL_RATIO
  // without ever going further than a full cover fit would.
  if (fgWidth > boxWidth || fgHeight > boxHeight) {
    const cropW = Math.min(fgWidth, boxWidth);
    const cropH = Math.min(fgHeight, boxHeight);
    foregroundBuffer = await sharp(foregroundBuffer)
      .extract({
        left: Math.round((fgWidth - cropW) / 2),
        top: Math.round((fgHeight - cropH) / 2),
        width: cropW,
        height: cropH,
      })
      .toBuffer();
  }

  const fgMeta = await sharp(foregroundBuffer).metadata();

  const backdropBuffer = await sharp(inputPath)
    .rotate()
    .resize({ width, height, fit: "cover", position: "attention" })
    .blur(BACKDROP_BLUR)
    .modulate({ brightness: 0.55 })
    .toBuffer();

  await sharp(backdropBuffer)
    .composite([
      {
        input: foregroundBuffer,
        left: Math.round((width - fgMeta.width) / 2),
        top: Math.round((height - fgMeta.height) / 2),
      },
    ])
    .png()
    .toFile(outputPath);

  return outputPath;
}

export { DEFAULT_WIDTH as VIDEO_WIDTH, DEFAULT_HEIGHT as VIDEO_HEIGHT };
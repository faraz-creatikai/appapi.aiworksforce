// utils/thumbnailService.js
//
// Templated thumbnail: rounded-corner tiles, soft drop shadows, thin
// border strokes, and a blurred/darkened backdrop (first photo) showing
// through the outer margin and inter-tile gaps — the "frosted glass" look
// used in Canva/Instagram-style collage templates.
//
// width/height are parameters so the thumbnail matches whatever aspect
// ratio the video was rendered at (portrait/square/landscape).

import sharp from "sharp";

const DEFAULT_THUMB_WIDTH = 720;
const DEFAULT_THUMB_HEIGHT = 1280;

const OUTER_MARGIN = 34;
const GAP = 12;
const TILE_RADIUS = 22;
const SHADOW_BLUR = 14;
const SHADOW_OPACITY = 0.38;
const SHADOW_OFFSET_Y = 8;
const BORDER_OPACITY = 0.28;

async function buildBackdrop(firstPhotoPath, width, height) {
  return sharp(firstPhotoPath)
    .rotate()
    .resize({ width, height, fit: "cover", position: "attention" })
    .blur(36)
    .modulate({ brightness: 0.5, saturation: 1.05 })
    .tint({ r: 10, g: 14, b: 26 })
    .toBuffer();
}


async function clampToCanvas(buffer, left, top, canvasWidth, canvasHeight) {
  const meta = await sharp(buffer).metadata();
  const bw = meta.width;
  const bh = meta.height;

  const cropLeft = Math.max(0, -left);
  const cropTop = Math.max(0, -top);
  const cropRight = Math.max(0, left + bw - canvasWidth);
  const cropBottom = Math.max(0, top + bh - canvasHeight);

  const newWidth = bw - cropLeft - cropRight;
  const newHeight = bh - cropTop - cropBottom;

  if (newWidth <= 0 || newHeight <= 0) return null;

  const extracted =
    cropLeft || cropTop || cropRight || cropBottom
      ? await sharp(buffer)
          .extract({ left: cropLeft, top: cropTop, width: newWidth, height: newHeight })
          .toBuffer()
      : buffer;

  return {
    input: extracted,          // ✅ fixed
    left: Math.max(0, left),
    top: Math.max(0, top),
  };
}

async function coverBuffer(inputPath, width, height) {
  return sharp(inputPath)
    .rotate()
    .resize({
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      fit: "cover",
      position: "attention",
    })
    .toBuffer();
}

async function roundTileWithBorder(rawBuffer, width, height, radius) {
  const w = Math.round(width);
  const h = Math.round(height);

  const maskSvg = Buffer.from(
    `<svg width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${h}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`
  );
  const borderSvg = Buffer.from(
    `<svg width="${w}" height="${h}">
       <rect x="0.75" y="0.75" width="${w - 1.5}" height="${h - 1.5}" rx="${radius}" ry="${radius}"
             fill="none" stroke="rgba(255,255,255,${BORDER_OPACITY})" stroke-width="1.5"/>
     </svg>`
  );

  return sharp(rawBuffer)
    .resize(w, h)
    .ensureAlpha()
    .composite([
      { input: maskSvg, blend: "dest-in" },
      { input: borderSvg, blend: "over" },
    ])
    .png()
    .toBuffer();
}

async function makeShadowLayer(width, height, radius) {
  const w = Math.round(width);
  const h = Math.round(height);
  const pad = SHADOW_BLUR * 3;

  const svg = `<svg width="${w + pad * 2}" height="${h + pad * 2}">
      <rect x="${pad}" y="${pad}" width="${w}" height="${h}" rx="${radius}" ry="${radius}"
            fill="rgba(0,0,0,${SHADOW_OPACITY})"/>
    </svg>`;

  const buffer = await sharp(Buffer.from(svg)).blur(SHADOW_BLUR).png().toBuffer();
  return { buffer, pad };
}

async function placeTile(composites, photoPath, left, top, w, h, canvasWidth, canvasHeight) {
  const [rounded, shadow] = await Promise.all([
    coverBuffer(photoPath, w, h).then((buf) => roundTileWithBorder(buf, w, h, TILE_RADIUS)),
    makeShadowLayer(w, h, TILE_RADIUS),
  ]);

  const shadowPlacement = await clampToCanvas(
    shadow.buffer,
    left - shadow.pad,
    top - shadow.pad + SHADOW_OFFSET_Y,
    canvasWidth,
    canvasHeight
  );
  if (shadowPlacement) composites.push(shadowPlacement);

  const tilePlacement = await clampToCanvas(rounded, left, top, canvasWidth, canvasHeight);
  if (tilePlacement) composites.push(tilePlacement);
}

export async function buildDynamicThumbnail(
  photoPaths,
  outputPath,
  width = DEFAULT_THUMB_WIDTH,
  height = DEFAULT_THUMB_HEIGHT
) {
  const photos = photoPaths.slice(0, 4);
  const n = photos.length;

  if (n === 0) {
    throw new Error("At least one photo is required to build a thumbnail");
  }

  const backdrop = await buildBackdrop(photos[0], width, height);
  const composites = [];

  const gridLeft = OUTER_MARGIN;
  const gridTop = OUTER_MARGIN;
  const gridWidth = width - OUTER_MARGIN * 2;
  const gridHeight = height - OUTER_MARGIN * 2;

  if (n === 1) {
    await placeTile(composites, photos[0], gridLeft, gridTop, gridWidth, gridHeight,width, height);
  } else if (n === 2) {
    const leftW = Math.floor((gridWidth - GAP) / 2);
    const rightW = gridWidth - leftW - GAP;
    await placeTile(composites, photos[0], gridLeft, gridTop, leftW, gridHeight,width, height);
    await placeTile(composites, photos[1], gridLeft + leftW + GAP, gridTop, rightW, gridHeight,width, height);
  } else if (n === 3) {
    const leftW = Math.floor(gridWidth * 0.6);
    const rightW = gridWidth - leftW - GAP;
    const rightTopH = Math.floor((gridHeight - GAP) / 2);
    const rightBottomH = gridHeight - rightTopH - GAP;

    await placeTile(composites, photos[0], gridLeft, gridTop, leftW, gridHeight,width, height);
    await placeTile(composites, photos[1], gridLeft + leftW + GAP, gridTop, rightW, rightTopH,width, height);
    await placeTile(
      composites,
      photos[2],
      gridLeft + leftW + GAP,
      gridTop + rightTopH + GAP,
      rightW,
      rightBottomH,
      width, height
    );
  } else {
    const colW = Math.floor((gridWidth - GAP) / 2);
    const rowH = Math.floor((gridHeight - GAP) / 2);
    const cellW = [colW, gridWidth - colW - GAP];
    const cellH = [rowH, gridHeight - rowH - GAP];
    const positions = [
      { left: gridLeft, top: gridTop },
      { left: gridLeft + colW + GAP, top: gridTop },
      { left: gridLeft, top: gridTop + rowH + GAP },
      { left: gridLeft + colW + GAP, top: gridTop + rowH + GAP },
    ];

    for (let i = 0; i < 4; i += 1) {
      const w = cellW[i % 2];
      const h = cellH[i < 2 ? 0 : 1];
      await placeTile(composites, photos[i], positions[i].left, positions[i].top, w, h,width, height,);
    }
  }

  await sharp(backdrop)
    .composite(composites)
    .jpeg({ quality: 92 })
    .toFile(outputPath);

  return outputPath;
}



export { DEFAULT_THUMB_WIDTH as THUMB_WIDTH, DEFAULT_THUMB_HEIGHT as THUMB_HEIGHT };
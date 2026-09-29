// utils/orientationDetector.js
//
// Looks at the actual pixel dimensions of the uploaded photos and picks
// the aspect ratio that fits them best — the same way a human editor would
// eyeball "these are all landscape shots, so shoot for 16:9" — instead of
// asking the user to choose. Majority orientation wins; a tie, or a mostly
// square set, falls back to 'square', since that crops the least out of
// any individual photo regardless of its own orientation.

import sharp from "sharp";

const LANDSCAPE_THRESHOLD = 1.15; // width/height above this = landscape
const PORTRAIT_THRESHOLD = 0.87; // width/height below this = portrait

export async function detectAspectRatio(photoPaths) {
  let portraitCount = 0;
  let landscapeCount = 0;
  let squareCount = 0;

  for (const photoPath of photoPaths) {
    try {
      const meta = await sharp(photoPath).metadata();
      const width = meta.width || 1;
      const height = meta.height || 1;
      const ratio = width / height;

      if (ratio > LANDSCAPE_THRESHOLD) landscapeCount += 1;
      else if (ratio < PORTRAIT_THRESHOLD) portraitCount += 1;
      else squareCount += 1;
    } catch {
      // unreadable photo — just skip it, doesn't get a vote
    }
  }

  if (landscapeCount > portraitCount && landscapeCount > squareCount) return "landscape";
  if (portraitCount > landscapeCount && portraitCount > squareCount) return "portrait";
  if (portraitCount === 0 && landscapeCount === 0) return "square"; // all square photos
  return "square"; // tie or mixed bag — safest universal fallback
}
// utils/videoDimensions.js
//
// Single source of truth for output resolution. Add more presets here if
// you ever need them — everything downstream (canvas prep, ffmpeg render,
// thumbnail) just asks this for {width, height}.

export const ASPECT_RATIOS = {
  portrait: { width: 720, height: 1280, cssRatio: "9 / 16", label: "Portrait" },
  square: { width: 1080, height: 1080, cssRatio: "1 / 1", label: "Square" },
  landscape: { width: 1280, height: 720, cssRatio: "16 / 9", label: "Landscape" },
};

export function resolveDimensions(aspectRatio) {
  return ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS.portrait;
}
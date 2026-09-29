// utils/labelUtils.js
//
// Direct ports of clean_area_name / prepare_photo_labels /
// prepare_custom_voiceovers from the Streamlit app.

export function cleanAreaName(name) {
  let value = String(name || "").trim().toLowerCase();
  value = value.replace(/\.(jpg|jpeg|png|webp)$/i, "");
  value = value.replace(/_/g, " ").replace(/-/g, " ");
  value = value.replace(/\s+/g, " ").trim();
  return value || "flat interior";
}

// Turns the multi-line "photo sequence" textarea into exactly `totalPhotos`
// labels, padding with a generic fallback if the user entered fewer lines
// than photos (same behaviour as the Python version).
export function prepareLabels(sequenceText, totalPhotos) {
  const labels = String(sequenceText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(cleanAreaName);

  while (labels.length < totalPhotos) {
    labels.push(`flat interior ${labels.length + 1}`);
  }

  return labels.slice(0, totalPhotos);
}

// Multipart/form-data fields always arrive as plain strings, even for
// array-shaped data like an ordered list of photo filenames or script lines.
// The frontend should JSON.stringify() arrays before sending them; this
// safely unwraps that (and falls back to newline-splitting, and to treating
// an already-parsed array as-is, so it tolerates either shape).
export function parseArrayField(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // not JSON - fall through to newline splitting
  }

  return String(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

// Validates a manually-edited or AI-generated script: exactly one non-empty
// line per photo. Throws with a message the frontend can show directly.
export function prepareVoiceoverLines(scriptText, totalPhotos) {
  const lines = String(scriptText || "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (lines.length !== totalPhotos) {
    throw new Error(
      `Enter exactly ${totalPhotos} voiceover lines because there are ${totalPhotos} photos. ` +
        `Currently there are ${lines.length} lines.`
    );
  }

  return lines;
}
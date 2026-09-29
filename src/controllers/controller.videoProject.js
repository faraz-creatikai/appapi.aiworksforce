// controllers/videoController.js
//
// No database, no cloud storage. Photos and the uploaded voiceover land on
// disk via your existing multer.js (diskStorage -> "uploads/"), and the
// rendered video is written into the same folder and served the same way.
// The client (Next.js) is the source of truth for wizard state between
// steps (photo order, edited script, chosen mode) - each endpoint here is a
// self-contained transformation, not a persisted "project".
//
// TODO: point this at your existing error class if the path differs.
import ApiError from "../utils/ApiError.js";

import path from "path";
import fs from "fs/promises";
import os from "os";

import { prepareLabels, prepareVoiceoverLines, parseArrayField } from "../utils/labelUtils.js";
import { createSyncedNarration, safeTrimSilence, splitDurationsByWordWeight } from "../jobs/ttsService.js";
import { assembleFinalVideo, embedThumbnail } from "../jobs/videoRenderService.js";
import { ffprobeDuration } from "../utils/mediaUtils.js";
import { VideoScriptGenerationAgent } from "../ai/agent.js";
import { buildDynamicThumbnail } from "../jobs/thumbnailService.js";
import { resolveDimensions } from "../utils/videoDimentions.js";
import { detectAspectRatio } from "../utils/orientationDetector.js";

const PREFERRED_PHOTO_DURATION = 5.5; // matches the Streamlit app's PHOTO_DURATION
const UPLOAD_DIR = path.join(process.cwd(), "uploads"); // same folder your multer.js writes to

function uploadedFileUrl(req, fileName) {
  return `${req.protocol}://${req.get("host")}/uploads/${fileName}`;
}

// Step 1: upload photos. Just wraps multer's disk-stored files into a clean
// response - `upload.array("photos")` from your multer.js already did the
// actual saving before this handler runs.
export const uploadPhotos = async (req, res, next) => {
  try {
    const files = req.files || [];

    if (!files.length) {
      return next(new ApiError(400, "Upload at least one photo"));
    }

    const photos = files.map((file) => ({
  fileName: file.filename,
  originalName: file.originalname,
  url: uploadedFileUrl(req, file.filename), // was: uploadedFileUrl(file.filename)
}));

    res.status(201).json({ photos });
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};

// Step 3: generate the voice script with the AI agent.
// body: { propertyDetails, sequenceText, totalPhotos, mode }
// `sequenceText` is the same multi-line "one area per photo" textarea from
// the original app; `totalPhotos` is however many photos the client is
// currently holding (from the uploadPhotos response), so short sequences
// get padded the same way the Python app did.
export const generateVideoScript = async (req, res, next) => {
  try {
    const { propertyDetails, sequenceText, totalPhotos, mode = "hinglish" } = req.body;

    if (!propertyDetails || !propertyDetails.trim()) {
      return next(new ApiError(400, "Property description is required"));
    }
    if (!totalPhotos || Number(totalPhotos) <= 0) {
      return next(new ApiError(400, "totalPhotos is required"));
    }

    const labels = prepareLabels(sequenceText, Number(totalPhotos));
    const { voiceovers, metadata } = await VideoScriptGenerationAgent(labels, propertyDetails, mode);

    res.status(200).json({ voiceovers, labels, metadata });
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};



// Step 5: render the final video, either with AI narration (gTTS synced to
// each photo) or a single uploaded voice recording.
//
// Always send this as multipart/form-data (even for ai_voice, where no file
// is attached) so the shape is consistent on both client and server:
//   fields: mode, voiceoverMethod, photoFileNames (JSON array string),
//           scriptContent (JSON array string)
//   file (only for voiceoverMethod = "uploaded_voice"): uploadedVoiceover
//
// `photoFileNames` must be the multer `filename`s returned by uploadPhotos,
// listed in the exact order the client wants them to appear in the video -
// reordering is entirely a client-side concern now, there's no separate
// reorder endpoint.

export const renderVideo = async (req, res, next) => {
  try {
    const { mode = "hinglish", voiceoverMethod = "ai_voice", aiVoice = "female_1" } = req.body;
    const photoFileNames = parseArrayField(req.body.photoFileNames);
    const scriptContent = parseArrayField(req.body.scriptContent);
    const uploadedVoiceover = req.file; // multer disk storage -> req.file.path already on disk

    if (!photoFileNames.length) {
      return next(new ApiError(400, "photoFileNames is required"));
    }

    const lines = prepareVoiceoverLines(scriptContent.join("\n"), photoFileNames.length);
    const photoPaths = photoFileNames.map((fileName) => path.join(UPLOAD_DIR, fileName));

    await Promise.all(
      photoPaths.map(async (photoPath) => {
        try {
          await fs.access(photoPath);
        } catch {
          throw new Error(`Uploaded photo not found on server: ${path.basename(photoPath)}`);
        }
      })
    );

    // 👇 Auto-detect best-fit output format from the photos themselves.
    const detectedAspectRatio = await detectAspectRatio(photoPaths);
    const { width: videoWidth, height: videoHeight } = resolveDimensions(detectedAspectRatio);

    const finalFileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}-final.mp4`;
    const finalVideoPath = path.join(UPLOAD_DIR, finalFileName);

    if (voiceoverMethod === "uploaded_voice") {
      if (!uploadedVoiceover) {
        return next(new ApiError(400, "Upload your recorded voiceover before rendering"));
      }

      if (!lines || lines.join("").trim() === "") {
        return next(new ApiError(400, "Script content is required to calculate photo timings for custom audio."));
      }

      const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "uploaded-voice-"));

      try {
        const trimmedAudioPath = path.join(workDir, "trimmed_voice.wav");

        await safeTrimSilence(uploadedVoiceover.path, trimmedAudioPath);

        const totalAudioDuration = await ffprobeDuration(trimmedAudioPath);
        const durations = splitDurationsByWordWeight(lines, totalAudioDuration);

        await assembleFinalVideo({
          photoPaths,
          durations,
          audioPath: trimmedAudioPath,
          finalOutputPath: finalVideoPath,
          trimToAudio: true,
          videoWidth,
          videoHeight,
        });
      } finally {
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
      }
    } else {
      const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-voice-"));

      try {
        const { combinedAudioPath, segmentDurations } = await createSyncedNarration({
          voiceoverLines: lines,
          preferredDuration: PREFERRED_PHOTO_DURATION,
          workDir,
          lang: mode === "english" ? "en" : "hi",
          voiceId: aiVoice,
        });

        await assembleFinalVideo({
          photoPaths,
          durations: segmentDurations,
          audioPath: combinedAudioPath,
          finalOutputPath: finalVideoPath,
          trimToAudio: false,
          videoWidth,
          videoHeight,
        });
      } finally {
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
      }
    }

    // ── Build & attach thumbnail (first up to 4 photos, in the client's order) ──
    const thumbFileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}-thumb.jpg`;
    const thumbPath = path.join(UPLOAD_DIR, thumbFileName);
    await buildDynamicThumbnail(photoPaths, thumbPath, videoWidth, videoHeight);

    const videoWithThumbPath = path.join(UPLOAD_DIR, `${finalFileName}.withthumb.mp4`);
    await embedThumbnail(finalVideoPath, thumbPath, videoWithThumbPath);
    await fs.rm(finalVideoPath).catch(() => {});
    await fs.rename(videoWithThumbPath, finalVideoPath);

    res.status(200).json({
      videoUrl: uploadedFileUrl(req, finalFileName),
      thumbnailUrl: uploadedFileUrl(req, thumbFileName),
      fileName: finalFileName,
      aspectRatio: detectedAspectRatio, // 'portrait' | 'square' | 'landscape' — informational for the client
    });
  } catch (error) {
    next(new ApiError(400, error.message));
  }
};
import multer from "multer";
import path from "path";
import fs from "fs";

const uploadDir = "uploads/";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpg|jpeg|png|webp/;
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.test(ext)) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

// 👇 NEW: separate instance for Template uploads (whatsapp image/video/document
// + mail image). Reuses the same disk storage/filename logic above, so nothing
// about where files land or how they're named changes — only which extensions
// are accepted, and only on the routes that opt into this instance.
const templateUpload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // raised for video/document templates
  fileFilter: (req, file, cb) => {
    const allowed = /jpg|jpeg|png|webp|gif|mp4|mov|webm|pdf|doc|docx|xls|xlsx/;
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.test(ext)) cb(null, true);
    else
      cb(
        new Error(
          "Unsupported file type. Allowed: images (jpg/jpeg/png/webp/gif), video (mp4/mov/webm), or documents (pdf/doc/docx/xls/xlsx)."
        )
      );
  },
});

// 👇 UPDATED: now also accepts .webm (MediaRecorder's default output in
// Chrome/Firefox for live voice recording), and falls back to checking the
// mimetype in case the extension is missing/generic (some browsers/mobile
// webviews don't always set a clean filename on recorded blobs).
const voiceUpload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExt = /mp3|wav|m4a|aac|ogg|webm/;
    const allowedMime = /audio\/(mpeg|wav|x-wav|wave|mp4|aac|ogg|webm)/;
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedExt.test(ext) || allowedMime.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported file type. Allowed audio: mp3, wav, m4a, aac, ogg, webm."));
    }
  },
});

// 👇 NEW: separate instance for Brand Assets (favicon .ico, svg logos, plus standard images)
const brandUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max for logos/icons
  fileFilter: (req, file, cb) => {
    const allowed = /jpg|jpeg|png|webp|ico|svg/;
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.test(ext)) cb(null, true);
    else cb(new Error("Only image files (.jpg, .png, .webp, .ico, .svg) are allowed for branding"));
  },
});

export default upload;
export { templateUpload, voiceUpload, brandUpload };
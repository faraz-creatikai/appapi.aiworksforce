import multer from "multer";
import fs from "fs";
import path from "path";

// 🧩 Ensure uploads/excel folder exists
const uploadPath = path.join(process.cwd(), "uploads", "excel");
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });

// ⚙️ Storage setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

// 🧠 File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
    "application/vnd.ms-excel", // .xls
    "text/csv", // .csv
  ];
  if (allowedTypes.includes(file.mimetype)) cb(null, true);
  else cb(new Error("Only .xlsx, .xls, or .csv files are allowed"));
};

// ✅ Export middleware
export const uploadExcel = multer({ storage, fileFilter });

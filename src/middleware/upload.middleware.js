import multer from "multer";

/*
  Image uploads (admin only). The browser's claimed MIME type is only a
  first filter — real validation is the file signature (magic bytes), done
  after upload by assertRealImage(). SVG is refused: it can carry script.
*/
const ALLOWED_MIME = /^image\/(jpeg|png|gif|webp|avif|heic|heif)$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 10, fields: 5 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.test(file.mimetype)) cb(null, true);
    else cb(Object.assign(new Error("Only JPEG, PNG, GIF, WebP, AVIF or HEIC images are allowed"), { statusCode: 400 }));
  },
});

const startsWith = (buf, bytes, offset = 0) => bytes.every((b, i) => buf[offset + i] === b);

// True when the bytes really are one of the allowed image formats.
export const isRealImage = (buf) => {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return false;
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return true; // JPEG
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return true; // PNG
  if (buf.toString("ascii", 0, 6) === "GIF87a" || buf.toString("ascii", 0, 6) === "GIF89a") return true;
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return true;
  if (buf.toString("ascii", 4, 8) === "ftyp" && /^(avif|avis|heic|heix|hevc|mif1|msf1)/.test(buf.toString("ascii", 8, 12))) return true;
  return false;
};

// Cloudinary sub-folder: a short slug only (no paths, no traversal).
export const safeFolder = (value) => {
  const folder = String(value || "misc").toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(folder) ? folder : "misc";
};

export default upload;

import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const uploadDir = path.resolve(process.cwd(), 'uploads');

try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
} catch (err) {
  console.error('Failed to create upload directory:', err);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Random, unguessable names; the extension is lower-cased and already checked against ALLOWED below
    cb(null, `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${path.extname(file.originalname || '').toLowerCase()}`);
  }
});

/**
 * Files people may attach. Anything a browser would run when opened (HTML, SVG, JavaScript, XML) is
 * refused, because uploads are served from the API's own address.
 */
export const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.bmp',
  '.pdf', '.txt', '.csv', '.rtf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp',
  '.zip', '.mp4', '.mov', '.webm', '.mp3', '.m4a', '.wav', '.ogg', '.log', '.json',
]);

export const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 1 }, // 20 MB, one file per request
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) return cb(new Error(`Files of type ${ext || '(none)'} can't be attached. Use an image, PDF, document, spreadsheet, ZIP, audio or video file.`));
    cb(null, true);
  },
});

/** Images, PDFs, audio and video open in the browser; everything else downloads. */
const INLINE = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.pdf', '.mp4', '.mov', '.webm', '.mp3', '.m4a', '.wav', '.ogg']);
export function uploadHeaders(res: { setHeader: (k: string, v: string) => void }, filePath: string) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Even if something unexpected were opened directly, it can't run scripts or reach the API
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (!INLINE.has(path.extname(filePath).toLowerCase())) res.setHeader('Content-Disposition', 'attachment');
}
export { uploadDir };

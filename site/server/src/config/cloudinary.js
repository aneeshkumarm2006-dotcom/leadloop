const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Cloudinary storage for profile avatars.
 * Uploads go directly to Cloudinary with face-crop 200x200 webp.
 * See Macan_TechStack.md Section 8.5.
 */
const avatarStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'macan/avatars',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [
      {
        width: 200,
        height: 200,
        crop: 'fill',
        gravity: 'face',
        format: 'webp',
      },
    ],
  },
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Resolve the correct Cloudinary resource_type from a multer file object.
// Images → 'image', Videos → 'video', everything else (PDFs, docs…) → 'raw'
// so non-image files are served with the correct Content-Type and are not
// misidentified as images by Cloudinary.
const resolveResourceType = (file) => {
  const mime = (file.mimetype || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'raw';
};

/**
 * Cloudinary storage for task update attachments (images, PDFs, docs).
 * resource_type is derived from the actual MIME type so PDFs land under
 * /raw/upload/ and are served as application/pdf, not image/jpeg.
 */
const updateAttachmentStorage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => {
    const nameWithoutExt = (file.originalname || 'file')
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_');
    return {
      folder: 'macan/updates',
      resource_type: resolveResourceType(file),
      public_id: `${Date.now()}-${nameWithoutExt}`,
    };
  },
});

const updateUpload = multer({
  storage: updateAttachmentStorage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB per file
});

/**
 * Cloudinary storage for task-level attachments (Files tab).
 * Same resource_type logic as updateAttachmentStorage.
 */
const taskAttachmentStorage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => {
    const nameWithoutExt = (file.originalname || 'file')
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_');
    return {
      folder: 'macan/tasks',
      resource_type: resolveResourceType(file),
      public_id: `${Date.now()}-${nameWithoutExt}`,
    };
  },
});

const taskAttachmentUpload = multer({
  storage: taskAttachmentStorage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB per file
});

/**
 * Cloudinary storage for email attachments (F8 — compose modal). Lands under
 * macan/emails/ with resource_type derived from the MIME type.
 */
const emailAttachmentStorage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => {
    const nameWithoutExt = (file.originalname || 'file')
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_');
    return {
      folder: 'macan/emails',
      resource_type: resolveResourceType(file),
      public_id: `${Date.now()}-${nameWithoutExt}`,
    };
  },
});

const emailAttachmentUpload = multer({
  storage: emailAttachmentStorage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB per file
});

/**
 * Cloudinary storage for WhatsApp media (F11 — compose modal). WhatsApp sends
 * media by public URL, so an attachment is uploaded here first and its
 * Cloudinary URL passed to Twilio as `MediaUrl`. Lands under macan/whatsapp/
 * with resource_type derived from the MIME type.
 */
const whatsappMediaStorage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => {
    const nameWithoutExt = (file.originalname || 'file')
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_');
    return {
      folder: 'macan/whatsapp',
      resource_type: resolveResourceType(file),
      public_id: `${Date.now()}-${nameWithoutExt}`,
    };
  },
});

const whatsappMediaUpload = multer({
  storage: whatsappMediaStorage,
  limits: { fileSize: 16 * 1024 * 1024 }, // 16MB — WhatsApp media ceiling
});

module.exports = {
  cloudinary,
  avatarUpload,
  updateUpload,
  taskAttachmentUpload,
  emailAttachmentUpload,
  whatsappMediaUpload,
};

export const UPLOAD_FILE_BYTES = 10 * 1024 * 1024;
export const UPLOAD_REQUEST_BYTES = 11 * 1024 * 1024;
export const UPLOAD_EXPIRY_MS = 24 * 60 * 60 * 1000;
export const UPLOAD_EDGE = 1600;
export const UPLOAD_ACCEPT = {
  "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"], "image/gif": [".gif"], "application/pdf": [".pdf"],
};
export const UPLOAD_ERRORS = {
  invalid: "Choose one PNG, JPEG, WebP, GIF or PDF file.",
  size: "The file must be 10 MiB or smaller.",
  body: "The upload request must be 11 MiB or smaller.",
  duplicate: "This file cannot be attached here. Retry in the original conversation or upload a new screenshot.",
  expired: "This attachment has expired. Please upload a new screenshot.",
  busy: "Please wait for the current message or upload to finish.",
  failed: "The attachment could not be uploaded. Please try again.",
  limited: "Please wait before uploading another file.",
} as const;
export type UploadErrorCode = keyof typeof UPLOAD_ERRORS;
export interface UploadedAttachment { uploadId: string; conversationId: string; filename: string; mimeType: string; sizeBytes: number }
// Never persist a guest's filename: it can contain names, PNRs or credentials.
export function attachmentName(mime: string) { return mime === "application/pdf" ? "attachment.pdf" : "attachment.webp"; }

const mountSuffix = /\n\n\[Attached file: \/mnt\/session\/uploads\/[a-z0-9]+\.(?:webp|pdf)\]$/;
export function attachmentDisplayText(text: string) {
  return text.replace(mountSuffix, "").replace(/\b(?:\d[ -]?){13,19}\b/g, "[redacted]");
}
export function publicAttachment(value: unknown) {
  if (!value || typeof value !== "object" || !("mimeType" in value)) return undefined;
  const mime = value.mimeType;
  if (mime !== "application/pdf" && mime !== "image/webp") return undefined;
  return { filename: attachmentName(mime), mimeType: mime };
}

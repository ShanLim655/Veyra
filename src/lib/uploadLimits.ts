export const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;
export const MAX_UPLOAD_SIZE_LABEL = "25 MB";

export function exceedsMaxUploadSize(file: Pick<File, "size"> | Blob): boolean {
  return file.size > MAX_UPLOAD_SIZE_BYTES;
}

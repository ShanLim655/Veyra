export function normalizeChatUploadType(bucket, contentType) {
  const value = typeof contentType === 'string'
    ? contentType.split(';', 1)[0].trim().toLowerCase()
    : '';
  if (bucket === 'chat-images' && value === 'image/svg+xml') return null;
  if (bucket === 'chat-images' && (value.startsWith('image/') || value.startsWith('audio/'))) return value;
  if (bucket === 'chat-videos' && value.startsWith('video/')) return value;
  if (bucket === 'chat-voice' && value.startsWith('audio/')) return value;
  return 'application/octet-stream';
}

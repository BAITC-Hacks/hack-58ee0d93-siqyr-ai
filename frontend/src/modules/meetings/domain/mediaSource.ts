export const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const supportedExtension = /\.(mp3|m4a|mp4|wav|webm|ogg|opus|aac|mov)$/i;

/** Formats and size the server accepts; without them the browser-only defaults apply. */
export interface SourceLimits {
  extensions: readonly string[];
  maxBytes: number;
}

export function mediaSourceError(file: { name: string; type: string; size: number }, limits?: SourceLimits): string | null {
  const extension = /\.[^.]+$/.exec(file.name)?.[0].toLowerCase() ?? '';
  // The server checks the extension first, so with its list the browser MIME type cannot vouch for the file.
  const supported = limits ? limits.extensions.includes(extension)
    : file.type.startsWith('audio/') || file.type.startsWith('video/') || supportedExtension.test(file.name);
  if (!supported) {
    const names = limits ? limits.extensions.map((item) => item.slice(1).toUpperCase()).join(', ') : 'MP3, M4A, MP4, WAV, WebM, OGG, AAC или MOV';
    return `Выберите аудио- или видеофайл: ${names}.`;
  }
  if (file.size === 0) return 'Файл пуст. Выберите другую запись.';
  const maxBytes = limits?.maxBytes ?? MAX_SOURCE_BYTES;
  if (file.size > maxBytes) return `Файл превышает ${Math.round(maxBytes / 1024 / 1024)} МБ. Выберите запись меньшего размера.`;
  return null;
}

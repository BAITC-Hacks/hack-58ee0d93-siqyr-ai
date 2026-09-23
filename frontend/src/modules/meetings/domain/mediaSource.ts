export const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const supportedExtension = /\.(mp3|m4a|mp4|wav|webm|ogg|opus|aac|mov)$/i;

export function mediaSourceError(file: { name: string; type: string; size: number }): string | null {
  if (!(file.type.startsWith('audio/') || file.type.startsWith('video/') || supportedExtension.test(file.name))) {
    return 'Выберите аудио- или видеофайл: MP3, M4A, MP4, WAV, WebM, OGG, AAC или MOV.';
  }
  if (file.size === 0) return 'Файл пуст. Выберите другую запись.';
  if (file.size > MAX_SOURCE_BYTES) return 'Файл превышает 100 МБ. Выберите запись меньшего размера.';
  return null;
}

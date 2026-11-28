export const audioLimits: Readonly<{ fileBytes: number; waveBytes: number; textChars: number }>;
type Request = { baseUrl: string; model: string; signal?: AbortSignal };
export function transcribeAudio(options: Request & { file: File }): Promise<string>;
export function synthesizeSpeech(options: Request & { input: string; voice: string }): Promise<Blob>;

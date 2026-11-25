export interface SaveFilePickerHandle {
  name?: string
  createWritable(): Promise<{write(blob: Blob): Promise<void>; close(): Promise<void>; abort?(): Promise<void>}>
}
type FileType = {description: string; accept: Record<string, string[]>}
type PickerHost = {showSaveFilePicker?(options: {suggestedName: string; types: FileType[]}): Promise<SaveFilePickerHandle>}
export function openSaveFilePickerHandle(suggestedName: string, options: FileType, host?: PickerHost): Promise<SaveFilePickerHandle | '' | null>
export function writeBlobToFileHandle(handle: SaveFilePickerHandle, blob: Blob): Promise<boolean>
export function saveBlobWithPicker(blob: Blob, suggestedName: string, options: FileType, host?: PickerHost): Promise<string | null>
export function downloadBlob(blob: Blob, filename: string, doc?: Document): void
export function importWithFallback<T>(options: {
  primary?: () => T | Promise<T>
  fallback: () => T | Promise<T>
  accepts(result: T): boolean
  recover?(error: unknown): boolean
}): Promise<T>

export interface PageCapture {sourceUrl: string; html: string; title: string}
export interface StagedPageCapture {requestUrl: string; sourceUrl: string; title: string; byteSize: number}
export function readCopiedPage(clipboard?: Pick<Clipboard, 'read'>): Promise<{html: string; text: string}>
export function createPageCaptureStore(options: {maxBytes: number; parameterPrefix?: string}): {
  stage(url: string, html: string, text?: string): StagedPageCapture
  consume(url: string): PageCapture | null
}

export type RecordExportFormat = 'csv' | 'json' | 'markdown'
type Cell = string | number | boolean | null
export interface RecordExportData {
  name: string
  columns: readonly {name: string}[]
  rows: readonly {cells: readonly Cell[]}[]
  orientation?: 'rows' | 'columns'
}
export const recordFormats: Readonly<Record<RecordExportFormat, Readonly<{label: string; extension: string; mime: string}>>>
export function serializeRecordView(data: RecordExportData, format: RecordExportFormat): string
export function downloadRecordView(doc: Document, data: RecordExportData, format: RecordExportFormat): void

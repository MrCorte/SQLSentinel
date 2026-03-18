/**
 * Escapes a single CSV cell value following RFC 4180:
 *  - always wraps the value in double-quotes
 *  - doubles any internal double-quote characters ("" escaping)
 *
 * Examples:
 *   escapeCsvValue('hello')         → '"hello"'
 *   escapeCsvValue('a,b')           → '"a,b"'
 *   escapeCsvValue('say "hi"')      → '"say ""hi"""'
 *   escapeCsvValue('line\nbreak')   → '"line\nbreak"'
 */
export function escapeCsvValue(v: string): string {
  return `"${String(v).replace(/"/g, '""')}"`
}

/**
 * Builds a complete CSV content string from headers + rows.
 *
 * - Prepends UTF-8 BOM (\\uFEFF) for seamless Excel / Italian locale import.
 * - Uses \\r\\n as the RFC 4180 line separator.
 * - Every cell is passed through escapeCsvValue.
 */
export function buildCsvContent(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvValue).join(','))
  return '\uFEFF' + lines.join('\r\n')
}

export class ImportError extends Error {
  code: string
  status: number
  constructor(code: string, status: number, message = code) {
    super(message); this.name = 'ImportError'; this.code = code; this.status = status
  }
}
export function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ImportError(`invalid_${field}`, 400)
  return value
}

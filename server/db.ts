import { Pool } from 'pg'

const isConfigured = Boolean(process.env.PGHOST && process.env.PGDATABASE && process.env.PGUSER)

export const pool = isConfigured
  ? new Pool({
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT ?? 5432),
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: true } : undefined,
      max: 1,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: 'gestao-rpa',
    })
  : null

export function quoteIdentifier(identifier: string) {
  if (!identifier || identifier.includes('\0')) throw new Error('Identificador SQL inválido')
  return `"${identifier.replaceAll('"', '""')}"`
}

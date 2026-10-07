import session from 'express-session'
import type { Pool } from 'pg'

export class PostgresSessionStore extends session.Store {
  constructor(private readonly pool: Pool) {
    super()
  }

  get(sid: string, callback: (err?: unknown, session?: session.SessionData | null) => void) {
    this.pool.query<{ sessao: session.SessionData; expira_em: Date }>(
      'SELECT sessao, expira_em FROM gestao_rpa.sessoes WHERE sid = $1 AND expira_em > NOW()',
      [sid],
    ).then(({ rows }) => callback(null, rows[0]?.sessao ?? null), callback)
  }

  set(sid: string, value: session.SessionData, callback?: (err?: unknown) => void) {
    const expiry = value.cookie?.expires ? new Date(value.cookie.expires) : new Date(Date.now() + 86_400_000)
    this.pool.query(
      `INSERT INTO gestao_rpa.sessoes (sid, sessao, expira_em) VALUES ($1, $2, $3)
       ON CONFLICT (sid) DO UPDATE SET sessao = EXCLUDED.sessao, expira_em = EXCLUDED.expira_em`,
      [sid, JSON.stringify(value), expiry],
    ).then(() => callback?.(), callback)
  }

  destroy(sid: string, callback?: (err?: unknown) => void) {
    this.pool.query('DELETE FROM gestao_rpa.sessoes WHERE sid = $1', [sid]).then(() => callback?.(), callback)
  }
}

import bcrypt from 'bcryptjs'
import type { Request, Response, NextFunction } from 'express'
import type { Pool } from 'pg'

export type User = { id: string; login: string; nome: string; perfil: 'visualizacao' | 'aprovador' }

declare module 'express-session' {
  interface SessionData { user?: User }
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.session.user) return res.status(401).json({ error: 'Autenticação necessária' })
  next()
}

export function requireApprover(req: Request, res: Response, next: NextFunction) {
  if (req.session.user?.perfil !== 'aprovador') return res.status(403).json({ error: 'Acesso permitido apenas a aprovadores' })
  next()
}

export async function ensureBootstrapApprover(pool: Pool) {
  const login = process.env.ADMIN_LOGIN
  const password = process.env.ADMIN_PASSWORD
  if (!login || !password || password === 'change-this-before-first-run') return
  const existing = await pool.query('SELECT id FROM gestao_rpa.usuarios WHERE perfil = $1 AND ativo = TRUE LIMIT 1', ['aprovador'])
  if (existing.rowCount) return
  const passwordHash = await bcrypt.hash(password, 12)
  await pool.query(
    `INSERT INTO gestao_rpa.usuarios (login, nome, senha_hash, perfil)
     VALUES ($1, $2, $3, 'aprovador') ON CONFLICT (login) DO NOTHING`,
    [login, process.env.ADMIN_NAME ?? 'Administrador inicial', passwordHash],
  )
}

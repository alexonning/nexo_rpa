import 'dotenv/config'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import express from 'express'
import session from 'express-session'
import helmet from 'helmet'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { pool } from './db.js'
import { ensureBootstrapApprover, requireApprover, requireUser } from './auth.js'
import { PostgresSessionStore } from './session-store.js'
import { listColumnMetadata, listRoutineStatuses, listRoutines } from './routine-service.js'
import { createRequestGroup, decideRequestGroup } from './request-service.js'

const app = express()
const port = Number(process.env.PORT ?? 3000)
const clientOrigin = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
app.use(cors({ origin: clientOrigin, credentials: true }))
app.use(express.json({ limit: '1mb' }))
if (pool) {
  app.use(session({
    name: 'gestao_rpa_sid',
    secret: process.env.SESSION_SECRET ?? 'development-only-change-this-secret',
    resave: false,
    saveUninitialized: false,
    store: new PostgresSessionStore(pool),
    cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 },
  }))
}

app.get('/api/health', async (_req, res) => {
  if (!pool) return res.status(503).json({ status: 'database_not_configured' })
  try {
    const { rows } = await pool.query('SELECT current_database() AS database, current_user AS username')
    res.json({ status: 'ok', database: rows[0].database, username: rows[0].username, maxConnections: 1 })
  } catch (error) {
    res.status(503).json({ status: 'database_unavailable', detail: error instanceof Error ? error.message : 'unknown' })
  }
})

app.post('/api/auth/login', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Banco não configurado' })
  const parsed = z.object({ login: z.string().min(1), password: z.string().min(1) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Informe login e senha' })
  const { rows } = await pool.query(
    'SELECT id, login, nome, perfil, senha_hash FROM gestao_rpa.usuarios WHERE login = $1 AND ativo = TRUE',
    [parsed.data.login],
  )
  const user = rows[0]
  if (!user || !(await bcrypt.compare(parsed.data.password, user.senha_hash))) return res.status(401).json({ error: 'Login ou senha inválidos' })
  req.session.user = { id: String(user.id), login: user.login, nome: user.nome, perfil: user.perfil }
  res.json({ user: req.session.user })
})

app.get('/api/auth/setup-status', async (_req, res) => {
  if (!pool) return res.status(503).json({ required: false })
  const { rows } = await pool.query('SELECT NOT EXISTS (SELECT 1 FROM gestao_rpa.usuarios) AS required')
  res.json({ required: rows[0].required })
})

app.post('/api/auth/setup', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Banco não configurado' })
  const remoteAddress = req.socket.remoteAddress ?? ''
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress)) return res.status(403).json({ error: 'Configuração inicial somente local' })
  const parsed = z.object({ login: z.string().min(3).max(80), nome: z.string().min(1).max(160), password: z.string().min(12) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Informe login, nome e senha com ao menos 12 caracteres' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(837261904)')
    const existing = await client.query('SELECT id FROM gestao_rpa.usuarios LIMIT 1')
    if (existing.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'A configuração inicial já foi concluída' }) }
    const hash = await bcrypt.hash(parsed.data.password, 12)
    const { rows } = await client.query(`
      INSERT INTO gestao_rpa.usuarios (login, nome, senha_hash, perfil)
      VALUES ($1, $2, $3, 'aprovador')
      RETURNING id, login, nome, perfil
    `, [parsed.data.login, parsed.data.nome, hash])
    await client.query('COMMIT')
    req.session.user = { id: String(rows[0].id), login: rows[0].login, nome: rows[0].nome, perfil: rows[0].perfil }
    res.status(201).json({ user: req.session.user })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
})

app.get('/api/auth/me', (req, res) => res.json({ user: req.session?.user ?? null }))
app.post('/api/auth/logout', requireUser, (req, res) => req.session.destroy(() => res.status(204).end()))

app.get('/api/routines/statuses', requireUser, async (_req, res) => {
  if (!pool) return res.status(503).json({ error: 'Banco não configurado' })
  res.json(await listRoutineStatuses(pool))
})

app.get('/api/routines', requireUser, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Banco não configurado' })
  const page = Math.max(1, Number(req.query.page) || 1)
  const sort = String(req.query.sort ?? 'executar_apos')
  if (!['id_situacao', 'executar_apos'].includes(sort)) return res.status(400).json({ error: 'Ordenação inválida' })
  const readList = (value: unknown, provided: boolean) => {
    if (!provided) return undefined
    const raw = (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === 'string')
    if (raw.length === 1 && raw[0] === '__none__') return []
    return raw
  }
  const statuses = readList(req.query.status, req.query.status !== undefined)
  const automations = readList(req.query.automation, req.query.automation !== undefined)
  if ((statuses?.length ?? 0) > 20 || (automations?.length ?? 0) > 100) return res.status(400).json({ error: 'Muitos filtros selecionados' })
  const availableStatuses = await listRoutineStatuses(pool)
  const allowedStatuses = new Set(availableStatuses.map((item) => item.descricao))
  if (statuses?.some((status) => !allowedStatuses.has(status))) return res.status(400).json({ error: 'Filtro de status inválido' })
  if (automations?.length) {
    const { rows } = await pool.query<{ projeto_nome: string }>(
      'SELECT DISTINCT projeto_nome FROM sustentacao.automacao_new WHERE projeto_nome = ANY($1::text[])',
      [automations],
    )
    if (rows.length !== new Set(automations).size) return res.status(400).json({ error: 'Filtro de automação inválido' })
  }
  const result = await listRoutines(pool, {
    page,
    search: String(req.query.search ?? ''),
    statuses,
    automations,
    orderBy: sort as 'id_situacao' | 'executar_apos',
    direction: req.query.direction === 'asc' ? 'asc' : 'desc',
  })
  res.json(result)
})

app.get('/api/entities/:entity', requireUser, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Banco não configurado' })
  const entities: Record<string, { schema: string; table: string }> = {
    automations: { schema: 'sustentacao', table: 'automacao_new' },
    robots: { schema: 'sustentacao', table: 'robo_new' },
  }
  const target = entities[String(req.params.entity)]
  if (!target) return res.status(404).json({ error: 'Cadastro não encontrado' })
  const columns = await listColumnMetadata(pool, target.schema, target.table)
  const page = Math.max(1, Number(req.query.page) || 1)
  const search = String(req.query.search ?? '').trim()
  const { quoteIdentifier } = await import('./db.js')
  const table = `${quoteIdentifier(target.schema)}.${quoteIdentifier(target.table)}`
  const values: unknown[] = []
  const where = search ? `WHERE to_jsonb(item)::text ILIKE $1` : ''
  if (search) values.push(`%${search}%`)
  const count = await pool.query(`SELECT COUNT(*)::integer AS total FROM ${table} AS item ${where}`, values)
  const pageValues = [...values, 10, (page - 1) * 10]
  const { rows } = await pool.query(
    `SELECT to_jsonb(item) AS data FROM ${table} AS item ${where}
     ORDER BY item.id LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
    pageValues,
  )
  res.json({ items: rows.map((row) => row.data), columns, page, pageSize: 10, total: count.rows[0].total })
})

app.get('/api/automation-projects', requireUser, async (_req, res) => {
  if (!pool) return res.status(503).json({ error: 'Banco não configurado' })
  const { rows } = await pool.query(`
    SELECT DISTINCT projeto_nome FROM sustentacao.automacao_new
    WHERE projeto_nome IS NOT NULL ORDER BY projeto_nome
  `)
  res.json(rows.map((row) => row.projeto_nome))
})

app.get('/api/dashboard', requireUser, async (_req, res) => {
  if (!pool) return res.status(503).json({ error: 'Banco não configurado' })
  const { rows: metrics } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM sustentacao.automacao_new WHERE id_situacao IN (4, 5)) AS automacoes_ativas,
      (SELECT COALESCE(SUM(rotinas), 0) FROM sustentacao.tarefa_new WHERE executar_apos::date = CURRENT_DATE) AS rotinas_hoje
  `)
  const sources = await (await import('./routine-service.js')).getRoutineSources(pool)
  const errorCounts: string[] = []
  for (const source of sources) {
    const { quoteIdentifier } = await import('./db.js')
    const table = `${quoteIdentifier(source.schema_name)}.${quoteIdentifier(source.table_name)}`
    const { rows } = await pool.query(`
      SELECT COUNT(DISTINCT r.id)::text AS count
      FROM ${table} r
      WHERE r.id_situacao = 3 AND EXISTS (
        SELECT 1 FROM gestao_rpa.solicitacoes s
        WHERE s.tipo_alvo = 'rotina' AND s.schema_origem = $1 AND s.tabela_origem = $2
          AND s.chave_registro->>'id' = r.id::text
      )
    `, [source.schema_name, source.table_name])
    errorCounts.push(rows[0].count)
  }
  res.json({ ...metrics[0], erros_com_solicitacao: errorCounts.reduce((sum, value) => sum + Number(value), 0) })
})

app.get('/api/requests', requireUser, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Banco não configurado' })
  const page = Math.max(1, Number(req.query.page) || 1)
  const status = String(req.query.status ?? '')
  const isApprover = req.session.user?.perfil === 'aprovador'
  const values: unknown[] = []
  const clauses: string[] = []
  if (!isApprover) {
    values.push(req.session.user!.id)
    clauses.push(`s.solicitante_id = $${values.length}`)
  }
  if (status && status !== 'Todos') {
    if (!['Pendente', 'Aprovado', 'Recusado'].includes(status)) return res.status(400).json({ error: 'Filtro de estado inválido' })
    values.push(status)
    clauses.push(`s.estado = $${values.length}`)
  } else if (isApprover && !status) {
    values.push('Pendente')
    clauses.push(`s.estado = $${values.length}`)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const count = await pool.query(`SELECT COUNT(*)::integer AS total FROM (SELECT s.grupo_id FROM gestao_rpa.solicitacoes s ${where} GROUP BY s.grupo_id) grouped`, values)
  const pageValues = [...values, 10, (page - 1) * 10]
  const { rows } = await pool.query(`
    SELECT s.grupo_id, MIN(s.criado_em) AS criado_em, MIN(s.estado) AS estado,
           MIN(u.nome) AS solicitante, MIN(a.projeto_nome) AS automacao,
           COUNT(*)::integer AS quantidade,
           jsonb_agg(jsonb_build_object(
             'id', s.id, 'tipo', s.tipo_alvo, 'automacao_id', s.automacao_id,
             'automacao', a.projeto_nome,
             'rotina_id', s.rotina_id, 'schema', s.schema_origem, 'tabela', s.tabela_origem,
             'chave_registro', s.chave_registro,
             'valores_anteriores', s.valores_anteriores, 'valores_propostos', s.valores_propostos
           ) ORDER BY s.id) AS itens
    FROM gestao_rpa.solicitacoes s
    JOIN gestao_rpa.usuarios u ON u.id = s.solicitante_id
    LEFT JOIN sustentacao.automacao_new a ON a.id::text = s.automacao_id
    ${where}
    GROUP BY s.grupo_id
    ORDER BY MIN(s.criado_em) DESC
    LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}
  `, pageValues)
  res.json({ items: rows, page, pageSize: 10, total: count.rows[0].total })
})

app.post('/api/requests', requireUser, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Banco não configurado' })
  const payload = z.object({ items: z.array(z.object({
    type: z.enum(['rotina', 'automacao', 'robo']),
    schema: z.string().optional(), table: z.string().optional(),
    id: z.union([z.string(), z.number()]),
    changes: z.record(z.string(), z.unknown()),
    automationId: z.union([z.string(), z.number()]).optional(),
    routineId: z.union([z.string(), z.number()]).optional(),
  })).min(1).max(100) }).safeParse(req.body)
  if (!payload.success) return res.status(400).json({ error: 'Solicitação inválida' })
  try {
    res.status(201).json(await createRequestGroup(pool, req.session.user!.id, payload.data.items))
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Não foi possível criar solicitação' })
  }
})

app.post('/api/requests/:groupId/decision', requireUser, requireApprover, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Banco não configurado' })
  const parsed = z.object({ decision: z.enum(['Aprovado', 'Recusado']), note: z.string().max(1000).optional() }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Decisão inválida' })
  try {
    res.json(await decideRequestGroup(pool, String(req.params.groupId), req.session.user!.id, parsed.data.decision, parsed.data.note))
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : 'Não foi possível decidir a solicitação' })
  }
})

app.get('/api/users', requireUser, requireApprover, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Banco não configurado' })
  const page = Math.max(1, Number(req.query.page) || 1)
  const [count, users] = await Promise.all([
    pool.query('SELECT COUNT(*)::integer AS total FROM gestao_rpa.usuarios'),
    pool.query('SELECT id, login, nome, perfil, ativo, criado_em FROM gestao_rpa.usuarios ORDER BY nome LIMIT 10 OFFSET $1', [(page - 1) * 10]),
  ])
  res.json({ items: users.rows, page, pageSize: 10, total: count.rows[0].total })
})

app.post('/api/users', requireUser, requireApprover, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Banco não configurado' })
  const parsed = z.object({ login: z.string().min(3).max(80), nome: z.string().min(1).max(160), password: z.string().min(12), perfil: z.enum(['visualizacao', 'aprovador']) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Dados inválidos; a senha deve ter ao menos 12 caracteres' })
  const hash = await bcrypt.hash(parsed.data.password, 12)
  try {
    const { rows } = await pool.query('INSERT INTO gestao_rpa.usuarios (login, nome, senha_hash, perfil) VALUES ($1, $2, $3, $4) RETURNING id, login, nome, perfil, ativo, criado_em', [parsed.data.login, parsed.data.nome, hash, parsed.data.perfil])
    res.status(201).json(rows[0])
  } catch {
    res.status(409).json({ error: 'Login já cadastrado' })
  }
})

app.patch('/api/users/:id', requireUser, requireApprover, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Banco não configurado' })
  const parsed = z.object({ nome: z.string().min(1).max(160).optional(), perfil: z.enum(['visualizacao', 'aprovador']).optional(), ativo: z.boolean().optional(), password: z.string().min(12).optional() }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Dados de usuário inválidos' })
  if (req.params.id === req.session.user!.id && (parsed.data.perfil || parsed.data.ativo === false)) return res.status(400).json({ error: 'Não é permitido remover seu próprio acesso de aprovador' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query('SELECT perfil, ativo FROM gestao_rpa.usuarios WHERE id = $1 FOR UPDATE', [req.params.id])
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Usuário não encontrado' }) }
    if (rows[0].perfil === 'aprovador' && rows[0].ativo && (parsed.data.perfil === 'visualizacao' || parsed.data.ativo === false)) {
      const active = await client.query("SELECT COUNT(*)::integer AS count FROM gestao_rpa.usuarios WHERE perfil = 'aprovador' AND ativo = TRUE")
      if (active.rows[0].count <= 1) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Não é possível remover o último aprovador ativo' }) }
    }
    const passwordHash = parsed.data.password ? await bcrypt.hash(parsed.data.password, 12) : null
    const updated = await client.query(`
      UPDATE gestao_rpa.usuarios SET
        nome = COALESCE($2, nome), perfil = COALESCE($3, perfil), ativo = COALESCE($4, ativo),
        senha_hash = COALESCE($5, senha_hash), atualizado_em = NOW()
      WHERE id = $1 RETURNING id, login, nome, perfil, ativo, criado_em
    `, [req.params.id, parsed.data.nome ?? null, parsed.data.perfil ?? null, parsed.data.ativo ?? null, passwordHash])
    await client.query('COMMIT')
    res.json(updated.rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
})

app.patch('/api/settings', requireUser, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Banco não configurado' })
  const parsed = z.object({ nome: z.string().min(1).max(160).optional(), currentPassword: z.string().optional(), newPassword: z.string().min(12).optional() }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Configuração inválida' })
  if (parsed.data.newPassword && !parsed.data.currentPassword) return res.status(400).json({ error: 'Informe a senha atual' })
  const { rows } = await pool.query('SELECT senha_hash FROM gestao_rpa.usuarios WHERE id = $1 AND ativo = TRUE', [req.session.user!.id])
  if (parsed.data.newPassword && !(await bcrypt.compare(parsed.data.currentPassword!, rows[0].senha_hash))) return res.status(403).json({ error: 'Senha atual incorreta' })
  const newHash = parsed.data.newPassword ? await bcrypt.hash(parsed.data.newPassword, 12) : null
  const updated = await pool.query('UPDATE gestao_rpa.usuarios SET nome = COALESCE($2, nome), senha_hash = COALESCE($3, senha_hash), atualizado_em = NOW() WHERE id = $1 RETURNING id, login, nome, perfil', [req.session.user!.id, parsed.data.nome ?? null, newHash])
  req.session.user = { ...req.session.user!, nome: updated.rows[0].nome }
  res.json(req.session.user)
})

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('API error:', error instanceof Error ? error.message : error)
  res.status(500).json({ error: 'Erro interno da API' })
})

async function start() {
  if (pool) {
    try {
      const migrations = (await readdir(resolve('server/migrations'))).filter((file) => file.endsWith('.sql')).sort()
      for (const file of migrations) {
        const migration = await readFile(resolve('server/migrations', file), 'utf8')
        await pool.query(migration)
      }
      await ensureBootstrapApprover(pool)
      console.info('PostgreSQL conectado; pool limitado a uma conexão.')
    } catch (error) {
      console.error('PostgreSQL indisponível ou migração falhou:', error instanceof Error ? error.message : error)
    }
  } else {
    console.warn('Banco não configurado; API iniciará sem dados do AGIS.')
  }
  app.listen(port, () => console.info(`API disponível em http://localhost:${port}`))
}

void start()

import 'dotenv/config'
import pg from 'pg'
import { decideRequestGroup } from '../dist/server/request-service.js'

const groupPrefix = process.argv[2]
if (!groupPrefix || !/^[a-f0-9-]{8,36}$/i.test(groupPrefix)) throw new Error('Informe um prefixo válido de UUID')

const pool = new pg.Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  max: 1,
})

try {
  const { rows } = await pool.query(`
    SELECT s.grupo_id, u.id AS approver_id
    FROM gestao_rpa.solicitacoes s
    JOIN gestao_rpa.usuarios u ON u.perfil = 'aprovador' AND u.ativo = TRUE
    WHERE s.grupo_id::text LIKE $1 || '%'
    LIMIT 1
  `, [groupPrefix])
  if (!rows.length) throw new Error('Solicitação não encontrada ou não há aprovador ativo')
  const result = await decideRequestGroup(pool, rows[0].grupo_id, String(rows[0].approver_id), 'Aprovado', undefined, true)
  const after = await pool.query('SELECT estado FROM gestao_rpa.solicitacoes WHERE grupo_id = $1 ORDER BY id', [rows[0].grupo_id])
  console.log(JSON.stringify({ dryRun: result.dryRun, validatedItems: result.count, persistedStates: after.rows.map((row) => row.estado) }))
} finally {
  await pool.end()
}

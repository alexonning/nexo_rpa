import 'dotenv/config'
import pg from 'pg'

const shortId = process.argv[2]
if (!shortId || !/^[a-f0-9-]{8,36}$/i.test(shortId)) throw new Error('Informe um prefixo válido de UUID')

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
    SELECT s.grupo_id, s.tipo_alvo, s.schema_origem, s.tabela_origem,
           s.chave_registro, s.rotina_id, s.valores_anteriores, s.valores_propostos,
           a.projeto_nome AS automacao
    FROM gestao_rpa.solicitacoes s
    LEFT JOIN sustentacao.automacao_new a ON a.id::text = s.automacao_id
    WHERE s.grupo_id::text LIKE $1 || '%'
    ORDER BY s.id
  `, [shortId])
  console.log(JSON.stringify({
    found: rows.length > 0,
    group: rows[0]?.grupo_id,
    items: rows.map((row) => ({
      type: row.tipo_alvo,
      relation: `${row.schema_origem}.${row.tabela_origem}`,
      recordKey: row.chave_registro,
      routineId: row.rotina_id,
      automation: row.automacao,
      changedFields: Object.keys(row.valores_propostos ?? {}),
      snapshotFields: Object.keys(row.valores_anteriores ?? {}),
    })),
  }))
} finally {
  await pool.end()
}

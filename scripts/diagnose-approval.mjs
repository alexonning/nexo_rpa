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
const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`

try {
  const { rows: requests } = await pool.query(`
    SELECT grupo_id, id, estado, tipo_alvo, schema_origem, tabela_origem, chave_registro,
           valores_anteriores, valores_propostos
    FROM gestao_rpa.solicitacoes
    WHERE grupo_id::text LIKE $1 || '%'
    ORDER BY id
  `, [shortId])
  if (!requests.length) {
    console.log(JSON.stringify({ found: false }))
  } else {
    const items = []
    for (const request of requests) {
      const relation = `${quoteIdentifier(request.schema_origem)}.${quoteIdentifier(request.tabela_origem)}`
      const { rows } = await pool.query(`SELECT to_jsonb(source_row) AS data FROM ${relation} AS source_row WHERE id = $1`, [request.chave_registro.id])
      const current = rows[0]?.data
      const fields = Object.keys(request.valores_anteriores ?? {}).map((field) => ({
        field,
        snapshotMatches: current ? JSON.stringify(current[field] ?? null) === JSON.stringify(request.valores_anteriores[field] ?? null) : false,
      }))
      items.push({
        requestId: request.id,
        state: request.estado,
        relation: `${request.schema_origem}.${request.tabela_origem}`,
        recordId: request.chave_registro.id,
        sourceRecordExists: Boolean(current),
        fields,
      })
    }
    console.log(JSON.stringify({ found: true, groupId: requests[0].grupo_id, items }))
  }
} finally {
  await pool.end()
}

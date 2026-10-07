import 'dotenv/config'
import assert from 'node:assert/strict'
import pg from 'pg'
import { listRoutines, listRoutineStatuses } from '../server/routine-service.ts'

const pool = new pg.Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  max: 1,
})

try {
  const result = await listRoutines(pool, { page: 1, orderBy: 'executar_apos', direction: 'desc' })
  const columnMetadata = result.items[0]?.column_metadata ?? []
  for (const column of ['primeira_tentativa', 'inicio', 'fim', 'executar_apos']) {
    const metadata = columnMetadata.find((item) => item.column_name === column)
    assert.equal(metadata?.data_type, 'timestamp without time zone', `${column} deve ser timestamp`)
  }
  const projects = await pool.query(`SELECT DISTINCT projeto_nome FROM sustentacao.automacao_new WHERE projeto_nome IS NOT NULL ORDER BY projeto_nome LIMIT 2`)
  const selectedAutomations = projects.rows.map((row) => row.projeto_nome)
  const multiFilterResult = await listRoutines(pool, {
    page: 1,
    statuses: ['Pendente', 'Erro'],
    automations: selectedAutomations,
    orderBy: 'executar_apos',
    direction: 'desc',
  })
  assert.ok(multiFilterResult.items.every((item) => ['Pendente', 'Erro'].includes(item.status)))
  assert.ok(multiFilterResult.items.every((item) => selectedAutomations.includes(item.automation)))
  console.log('ROUTINE_RESULT', JSON.stringify({
    total: result.total,
    pageSize: result.pageSize,
    itemKeys: Object.keys(result.items[0] ?? {}),
    metadataColumns: columnMetadata.length,
    boundedCharacterFields: columnMetadata.filter((column) => column.character_maximum_length != null).map((column) => ({ name: column.column_name, length: column.character_maximum_length })),
    status: result.items.map((item) => item.status),
  }))
  console.log('MULTI_FILTER', JSON.stringify({ selectedAutomations, selectedStatuses: ['Pendente', 'Erro'], returned: multiFilterResult.total }))
  console.log('STATUSES', JSON.stringify(await listRoutineStatuses(pool)))
} finally {
  await pool.end()
}

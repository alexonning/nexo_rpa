import 'dotenv/config'
import pg from 'pg'
import { getRoutineSources, listColumnMetadata } from '../dist/server/routine-service.js'

const pool = new pg.Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  max: 1,
})

try {
  const relations = [
    { schema: 'sustentacao', table: 'automacao_new' },
    { schema: 'sustentacao', table: 'robo_new' },
    ...await getRoutineSources(pool).then((sources) => sources.map((source) => ({ schema: source.schema_name, table: source.table_name }))),
  ]
  for (const relation of relations) {
    const columns = await listColumnMetadata(pool, relation.schema, relation.table)
    console.log(JSON.stringify({
      relation: `${relation.schema}.${relation.table}`,
      totalColumns: columns.length,
      constrainedOrTyped: columns.filter((column) => column.character_maximum_length != null || ['date', 'time without time zone', 'timestamp without time zone', 'timestamp with time zone', 'smallint', 'integer', 'bigint', 'numeric', 'boolean'].includes(column.data_type)),
    }))
  }
} finally {
  await pool.end()
}

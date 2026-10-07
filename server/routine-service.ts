import type { Pool, PoolClient } from 'pg'
import { quoteIdentifier } from './db.js'

export type RoutineFilters = {
  page: number
  search?: string
  statuses?: string[]
  automations?: string[]
  orderBy?: 'id_situacao' | 'executar_apos'
  direction?: 'asc' | 'desc'
}

export type ColumnMetadata = {
  column_name: string
  data_type: string
  udt_name: string
  character_maximum_length: number | null
  numeric_precision: number | null
  numeric_scale: number | null
  is_nullable: 'YES' | 'NO'
  is_identity: 'YES' | 'NO'
  is_generated: string
}

export async function getRoutineSources(pool: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>) {
  const { rows } = await pool.query<{ schema_name: string; table_name: string }>(`
    SELECT DISTINCT a.table_name_schema AS schema_name, a.table_name
    FROM rotina.tarefas_pendentes t
    INNER JOIN sustentacao.automacao_new a ON a.id = t.id_automacao
    ORDER BY a.table_name_schema, a.table_name
  `)
  return rows.filter((row) => row.schema_name === 'rotina' && /^[a-zA-Z_][a-zA-Z0-9_$]*$/.test(row.table_name))
}

export async function listRoutines(pool: Pool, filters: RoutineFilters) {
  const sources = await getRoutineSources(pool)
  const values: unknown[] = []
  const sourceQueries = sources.map(({ schema_name, table_name }) => {
    values.push(schema_name, table_name)
    const schemaParam = `$${values.length - 1}`
    const tableParam = `$${values.length}`
    return `
      SELECT a.id AS automation_id, a.projeto_nome AS automation,
             r.id::text AS routine_id, r.id_situacao,
             sr.descricao AS status, r.id_agencia, ag.nome AS agency,
             r.id_robo, rb.nome AS robot, r.id_tarefa,
             r.primeira_tentativa, r.tentativas, r.inicio, r.fim,
             r.executar_apos, r.processo_num, r.etapa_execucao, r.obs,
             ${schemaParam}::text AS schema_name, ${tableParam}::text AS table_name,
             to_jsonb(r) AS details,
             COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                 'column_name', c.column_name, 'data_type', c.data_type, 'udt_name', c.udt_name,
                 'character_maximum_length', c.character_maximum_length,
                 'numeric_precision', c.numeric_precision, 'numeric_scale', c.numeric_scale,
                 'is_nullable', c.is_nullable, 'is_identity', c.is_identity, 'is_generated', c.is_generated
               ) ORDER BY c.ordinal_position)
               FROM information_schema.columns c
               WHERE c.table_schema = ${schemaParam} AND c.table_name = ${tableParam}
             ), '[]'::jsonb) AS column_metadata
      FROM ${quoteIdentifier(schema_name)}.${quoteIdentifier(table_name)} r
      INNER JOIN sustentacao.automacao_new a
        ON a.table_name_schema = ${schemaParam} AND a.table_name = ${tableParam}
      INNER JOIN rotina.tarefas_pendentes t
        ON t.id_automacao = a.id AND t.id_tarefa = r.id_tarefa
      LEFT JOIN sustentacao.situacao_rotina sr ON sr.id = r.id_situacao
      LEFT JOIN dw.agencia_new ag ON ag.id = r.id_agencia
      LEFT JOIN sustentacao.robo_new rb ON rb.id = r.id_robo
    `
  })

  if (sourceQueries.length === 0) return { items: [], page: filters.page, pageSize: 10, total: 0 }

  const conditions: string[] = []
  if (filters.statuses !== undefined) {
    values.push(filters.statuses)
    conditions.push(`status = ANY($${values.length}::text[])`)
  }
  if (filters.automations !== undefined) {
    values.push(filters.automations)
    conditions.push(`automation = ANY($${values.length}::text[])`)
  }
  if (filters.search) {
    values.push(`%${filters.search}%`)
    conditions.push(`(automation ILIKE $${values.length} OR routine_id ILIKE $${values.length} OR (table_name || '/' || routine_id) ILIKE $${values.length} OR COALESCE(processo_num, '') ILIKE $${values.length})`)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const union = sourceQueries.join('\nUNION ALL\n')
  const count = await pool.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM (${union}) routines ${where}`, values)

  const sortColumn = filters.orderBy === 'id_situacao' ? 'id_situacao' : 'executar_apos'
  const direction = filters.direction === 'asc' ? 'ASC' : 'DESC'
  const dataValues = [...values, 10, (filters.page - 1) * 10]
  const pageResult = await pool.query(
    `SELECT * FROM (${union}) routines ${where}
     ORDER BY ${sortColumn} ${direction} NULLS LAST, routine_id
     LIMIT $${dataValues.length - 1} OFFSET $${dataValues.length}`,
    dataValues,
  )

  return { items: pageResult.rows, page: filters.page, pageSize: 10, total: Number(count.rows[0]?.total ?? 0) }
}

export async function listRoutineStatuses(pool: Pool) {
  const { rows } = await pool.query('SELECT id, descricao FROM sustentacao.situacao_rotina ORDER BY id')
  return rows
}

export async function listColumnMetadata(pool: Pool, schema: string, table: string) {
  const { rows } = await pool.query<ColumnMetadata>(`
    SELECT column_name, data_type, udt_name, character_maximum_length,
           numeric_precision, numeric_scale, is_nullable, is_identity, is_generated
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    ORDER BY ordinal_position
  `, [schema, table])
  return rows
}

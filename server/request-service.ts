import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { quoteIdentifier } from './db.js'
import { getRoutineSources } from './routine-service.js'

type Target = { type: 'rotina' | 'automacao' | 'robo'; schema?: string; table?: string; id: string | number; changes: Record<string, unknown>; automationId?: string | number; routineId?: string | number }

type ColumnInfo = { column_name: string; is_primary: boolean; is_generated: string; is_identity: string }

async function resolveTarget(pool: Pool | PoolClient, target: Target) {
  let schema: string
  let table: string
  if (target.type === 'rotina') {
    schema = target.schema ?? ''
    table = target.table ?? ''
    const sources = await getRoutineSources(pool)
    if (schema !== 'rotina' || !sources.some((source) => source.table_name === table)) throw new Error('Tabela de rotina não autorizada')
  } else if (target.type === 'automacao') {
    schema = 'sustentacao'; table = 'automacao_new'
  } else {
    schema = 'sustentacao'; table = 'robo_new'
  }

  const metadata = await pool.query<ColumnInfo>(`
    SELECT c.column_name,
           EXISTS (
             SELECT 1 FROM information_schema.key_column_usage k
             JOIN information_schema.table_constraints tc
               USING (constraint_catalog, constraint_schema, constraint_name, table_schema, table_name)
             WHERE tc.constraint_type = 'PRIMARY KEY'
               AND k.table_schema = c.table_schema AND k.table_name = c.table_name
               AND k.column_name = c.column_name
           ) AS is_primary,
           c.is_generated, c.is_identity
    FROM information_schema.columns c
    WHERE c.table_schema = $1 AND c.table_name = $2
    ORDER BY c.ordinal_position
  `, [schema, table])
  if (!metadata.rowCount) throw new Error('Tabela de origem não encontrada')
  const primaryKeys = metadata.rows.filter((column) => column.is_primary)
  if (primaryKeys.length !== 1 || primaryKeys[0].column_name !== 'id') throw new Error('A origem não tem uma chave primária id única')
  const allowedColumns = new Set(metadata.rows.filter((column) => !column.is_primary && column.is_generated === 'NEVER' && column.is_identity === 'NO').map((column) => column.column_name))
  const source = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
  return { schema, table, source, allowedColumns }
}

async function loadRow(client: PoolClient, target: Target, lock: boolean) {
  const resolved = await resolveTarget(client, target)
  const result = await client.query<{ row_data: Record<string, unknown> }>(
    `SELECT to_jsonb(source_row) AS row_data FROM ${resolved.source} AS source_row WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [target.id],
  )
  if (!result.rowCount) throw new Error('Registro de origem não encontrado')
  return { ...resolved, row: result.rows[0].row_data }
}

export async function createRequestGroup(pool: Pool, userId: string, targets: Target[]) {
  if (!targets.length || targets.length > 100) throw new Error('Envie de 1 a 100 registros por solicitação')
  const client = await pool.connect()
  const groupId = randomUUID()
  try {
    await client.query('BEGIN')
    for (const target of targets) {
      const changedNames = Object.keys(target.changes ?? {})
      if (!changedNames.length) throw new Error('Cada item precisa ter ao menos um campo alterado')
      const current = await loadRow(client, target, false)
      for (const name of changedNames) {
        if (!current.allowedColumns.has(name)) throw new Error(`Campo não editável: ${name}`)
      }
      const previousValues = Object.fromEntries(changedNames.map((name) => [name, current.row[name]]))
      const automationId = target.automationId ?? current.row.id_automacao ?? null
      const routineId = target.routineId ?? current.row.id_tarefa ?? current.row.id ?? null
      await client.query(`
        INSERT INTO gestao_rpa.solicitacoes (
          grupo_id, solicitante_id, tipo_alvo, automacao_id, rotina_id,
          schema_origem, tabela_origem, chave_registro, valores_anteriores, valores_propostos
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [groupId, userId, target.type, automationId === null ? null : String(automationId), routineId === null ? null : String(routineId), current.schema, current.table, JSON.stringify({ id: target.id }), JSON.stringify(previousValues), JSON.stringify(target.changes)])
    }
    await client.query('COMMIT')
    return { groupId, count: targets.length }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function decideRequestGroup(pool: Pool, groupId: string, approverId: string, decision: 'Aprovado' | 'Recusado', note?: string, dryRun = false) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(`
      SELECT * FROM gestao_rpa.solicitacoes
      WHERE grupo_id = $1 AND estado = 'Pendente'
      ORDER BY id FOR UPDATE
    `, [groupId])
    if (!rows.length) throw new Error('Solicitação pendente não encontrada')

    if (decision === 'Aprovado') {
      for (const request of rows) {
        const target: Target = {
          type: request.tipo_alvo,
          schema: request.schema_origem,
          table: request.tabela_origem,
          id: request.chave_registro.id,
          changes: request.valores_propostos,
          automationId: request.automacao_id,
          routineId: request.rotina_id,
        }
        const current = await loadRow(client, target, true)
        for (const [name, previous] of Object.entries(request.valores_anteriores as Record<string, unknown>)) {
          if (JSON.stringify(current.row[name] ?? null) !== JSON.stringify(previous ?? null)) throw new Error(`Conflito: o campo ${name} foi alterado desde o envio`)
        }
        const names = Object.keys(target.changes)
        if (!names.length || names.some((name) => !current.allowedColumns.has(name))) throw new Error('A solicitação contém campo não editável')
        const assignments = names.map((name, index) => `${quoteIdentifier(name)} = $${index + 2}`).join(', ')
        await client.query(`UPDATE ${current.source} SET ${assignments} WHERE id = $1`, [target.id, ...names.map((name) => target.changes[name])])
      }
    }

    await client.query(`
      UPDATE gestao_rpa.solicitacoes
      SET estado = $2, decisor_id = $3, justificativa = $4, decidido_em = NOW()
      WHERE grupo_id = $1 AND estado = 'Pendente'
    `, [groupId, decision, approverId, note ?? null])
    await client.query(`
      INSERT INTO gestao_rpa.auditoria (usuario_id, solicitacao_id, acao, detalhes)
      SELECT $2, id, $3, jsonb_build_object('grupo_id', grupo_id, 'estado', $4::text, 'itens', $5::integer)
      FROM gestao_rpa.solicitacoes WHERE grupo_id = $1
    `, [groupId, approverId, decision.toLowerCase(), decision, rows.length])
    if (dryRun) {
      await client.query('ROLLBACK')
      return { groupId, count: rows.length, status: decision, dryRun: true }
    }
    await client.query('COMMIT')
    return { groupId, count: rows.length, status: decision, dryRun: false }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

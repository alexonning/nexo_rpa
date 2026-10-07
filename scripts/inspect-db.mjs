import 'dotenv/config'
import pg from 'pg'

const pool = new pg.Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  max: 1,
  connectionTimeoutMillis: 4000,
})

try {
  const identity = await pool.query('SELECT current_database() AS db_name, current_user AS username, version() AS server_version')
  console.log('CONNECTION', JSON.stringify(identity.rows[0]))

  const mappings = await pool.query(`
    SELECT a.table_name_schema AS schema_name, a.table_name, COUNT(*)::integer AS task_count
    FROM rotina.tarefas_pendentes AS t
    INNER JOIN sustentacao.automacao_new AS a ON a.id = t.id_automacao
    GROUP BY a.table_name_schema, a.table_name
    ORDER BY a.table_name_schema, a.table_name
  `)
  console.log('ROUTINE_TABLES', JSON.stringify(mappings.rows))

  const core = await pool.query(`
    SELECT table_schema, table_name, column_name, data_type
    FROM information_schema.columns
    WHERE (table_schema, table_name) IN (
      ('rotina', 'tarefas_pendentes'), ('sustentacao', 'automacao_new'),
      ('sustentacao', 'tarefa_new'), ('sustentacao', 'situacao_rotina'),
      ('sustentacao', 'robo_new'), ('dw', 'agencia_new')
    )
    AND column_name IN (
      'id', 'id_tarefa', 'id_automacao', 'table_name_schema', 'table_name',
      'projeto_nome', 'id_situacao', 'descricao', 'nome', 'id_agencia',
      'id_robo', 'rotinas', 'executar_apos', 'table_schema', 'table_name'
    )
    ORDER BY table_schema, table_name, ordinal_position
  `)
  console.log('CORE_COLUMNS', JSON.stringify(core.rows))

  const routines = await pool.query(`
    SELECT a.table_name_schema AS schema_name, a.table_name, t.*
    FROM rotina.tarefas_pendentes AS t
    INNER JOIN sustentacao.automacao_new AS a ON a.id = t.id_automacao
    ORDER BY a.table_name_schema, a.table_name
    LIMIT 1
  `)
  console.log('SOURCE_SAMPLE', JSON.stringify({
    count: routines.rowCount,
    columns: routines.fields.map((field) => field.name),
  }))

  const sourceTables = mappings.rows
  for (const source of sourceTables) {
    const tableInfo = await pool.query(`
      SELECT c.column_name, c.data_type,
             EXISTS (
               SELECT 1 FROM information_schema.key_column_usage k
               WHERE k.table_schema = c.table_schema AND k.table_name = c.table_name
                 AND k.column_name = c.column_name AND k.constraint_name IN (
                   SELECT tc.constraint_name FROM information_schema.table_constraints tc
                   WHERE tc.table_schema = c.table_schema AND tc.table_name = c.table_name
                     AND tc.constraint_type = 'PRIMARY KEY'
                 )
             ) AS is_primary_key
      FROM information_schema.columns c
      WHERE c.table_schema = $1 AND c.table_name = $2
      ORDER BY c.ordinal_position
    `, [source.schema_name, source.table_name])
    console.log('SOURCE_TABLE', JSON.stringify({ ...source, columns: tableInfo.rows }))
  }

  const statusValues = await pool.query(`
    SELECT id, descricao FROM sustentacao.situacao_rotina ORDER BY id
  `)
  console.log('ROUTINE_STATUSES', JSON.stringify(statusValues.rows))

  const access = await pool.query(`
    SELECT
      has_schema_privilege(current_user, 'sustentacao', 'USAGE') AS can_read_source_schema,
      has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_schema,
      EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'gestao_rpa') AS support_schema_exists,
      CASE WHEN EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'gestao_rpa')
        THEN has_schema_privilege(current_user, 'gestao_rpa', 'CREATE')
        ELSE NULL END AS can_create_support_objects
  `)
  console.log('ACCESS', JSON.stringify(access.rows[0]))

  const migration = await pool.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'gestao_rpa' AND table_name = 'solicitacoes' AND column_name = 'grupo_id'
    ) AS request_groups_ready
  `)
  console.log('MIGRATION_STATE', JSON.stringify(migration.rows[0]))

  const writeAccess = await pool.query(`
    SELECT
      has_table_privilege(current_user, 'sustentacao.automacao_new', 'UPDATE') AS can_update_automations,
      has_table_privilege(current_user, 'sustentacao.robo_new', 'UPDATE') AS can_update_robots,
      has_table_privilege(current_user, 'rotina.atualizacao_base_clientes_hubsoft', 'UPDATE') AS can_update_routine_a,
      has_table_privilege(current_user, 'rotina.renovacao_cadastral_envio', 'UPDATE') AS can_update_routine_b
  `)
  console.log('WRITE_ACCESS', JSON.stringify(writeAccess.rows[0]))
} catch (error) {
  console.error('DATABASE_ERROR', error.message)
  process.exitCode = 1
} finally {
  await pool.end()
}

export type Profile = 'visualizacao' | 'aprovador'
export type Section = 'Dashboard' | 'Rotinas' | 'Automações' | 'Robôs' | 'Solicitações' | 'Usuários' | 'Configurações'

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

export type Routine = {
  id: string
  automation: string
  status: 'Pendente' | 'Processando' | 'Erro' | 'Concluído'
  agency: string
  robot: string
  taskId: string
  attempt: number
  attempts: number
  start: string
  end: string
  scheduled: string
  process: string
  stage: string
  note: string
  schema?: string
  table?: string
  recordId?: string
  details?: Record<string, unknown>
  automationId?: string
  columnMetadata?: ColumnMetadata[]
}

export type ChangeRequest = {
  id: string
  owner: string
  automation: string
  routineId: string
  target: string
  changes: number
  status: 'Pendente' | 'Aprovado' | 'Recusado'
  createdAt: string
  items?: Array<{
    tipo: string
    schema: string
    tabela: string
    automation: string
    routineId: string
    recordKey: Record<string, unknown>
    previous: Record<string, unknown>
    proposed: Record<string, unknown>
  }>
}

import { useEffect, useState } from 'react'
import type { FormEvent, MouseEvent, ToggleEvent } from 'react'
import { Activity, AlertTriangle, ArrowDownUp, ArrowLeft, ArrowRight, Bell, Bot, Check, ChevronDown, ChevronUp, CircleHelp, Clock3, Database, FileClock, Filter, Gauge, KeyRound, ListChecks, LogOut, MoreHorizontal, Pencil, Plus, Search, Settings2, ShieldCheck, SlidersHorizontal, Users, X } from 'lucide-react'
import { apiRequest } from './api'
import type { ChangeRequest, ColumnMetadata, Profile, Routine, Section } from './types'
import './App.css'

type SessionUser = { id: string; login: string; nome: string; perfil: Profile }
type RoutineRow = {
  automation_id: number; automation: string; routine_id: string; id_situacao: number; status: string
  id_tarefa: number; primeira_tentativa: string | null; tentativas: number | null; inicio: string | null
  fim: string | null; executar_apos: string | null; processo_num: string | null; etapa_execucao: string | number | null
  obs: string | null; schema_name: string; table_name: string; agency: string | null; robot: string | null
  details: Record<string, unknown>
  column_metadata: ColumnMetadata[]
}
type DashboardData = { automacoes_ativas: string; rotinas_hoje: string; erros_com_solicitacao: number }
type RequestRow = { grupo_id: string; estado: ChangeRequest['status']; solicitante: string; automacao: string | null; criado_em: string; quantidade: number; itens: Array<{ tipo: string; automacao_id: string; automacao: string | null; rotina_id: string; schema: string; tabela: string; chave_registro: Record<string, unknown>; valores_anteriores: Record<string, unknown>; valores_propostos: Record<string, unknown> }> }
type PageResult<T> = { items: T[]; page: number; pageSize: number; total: number }
type RoutineDraft = { routine: Routine; changes: Record<string, unknown> }
type RoutineSort = 'routine_id' | 'automation' | 'status' | 'agency' | 'robot' | 'tentativas' | 'executar_apos' | 'etapa_execucao'

const sections: { label: Section; icon: typeof Gauge }[] = [
  { label: 'Dashboard', icon: Gauge }, { label: 'Rotinas', icon: ListChecks },
  { label: 'Automações', icon: Activity }, { label: 'Robôs', icon: Bot },
  { label: 'Solicitações', icon: FileClock }, { label: 'Usuários', icon: Users },
  { label: 'Configurações', icon: Settings2 },
]
const statusClass: Record<string, string> = { Erro: 'danger', Pendente: 'waiting', Processando: 'running', Concluído: 'done', Concluido: 'done', Aprovado: 'done', Recusado: 'danger' }
const todayLabel = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date()).toUpperCase()

function mapRoutine(row: RoutineRow): Routine {
  return {
    id: `${row.table_name}/${row.routine_id}`, recordId: row.routine_id, schema: row.schema_name, table: row.table_name,
    automationId: String(row.automation_id), automation: row.automation,
    status: (row.status === 'Concluido' ? 'Concluído' : row.status) as Routine['status'],
    agency: row.agency ?? '—', robot: row.robot ?? '—', taskId: String(row.id_tarefa),
    attempt: row.tentativas ?? 0, attempts: row.tentativas ?? 0, start: row.inicio ?? '—', end: row.fim ?? '—',
    scheduled: row.executar_apos ?? '—', process: row.processo_num ?? '—',
    stage: row.etapa_execucao == null ? '—' : String(row.etapa_execucao), note: row.obs ?? '—', details: row.details, columnMetadata: row.column_metadata,
  }
}

function mapRequest(row: RequestRow): ChangeRequest {
  return {
    id: row.grupo_id, owner: row.solicitante, automation: row.automacao ?? '—',
    routineId: row.itens[0]?.rotina_id ?? '—', target: `${row.itens[0]?.schema ?? ''}.${row.itens[0]?.tabela ?? ''}`,
    changes: row.quantidade, status: row.estado, createdAt: new Date(row.criado_em).toLocaleString('pt-BR'),
    items: row.itens.map((item) => ({ tipo: item.tipo, schema: item.schema, tabela: item.tabela, automation: item.automacao ?? '—', routineId: item.rotina_id, recordKey: item.chave_registro, previous: item.valores_anteriores, proposed: item.valores_propostos })),
  }
}

function displayValue(value: unknown) {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function normalizeFieldValue(value: unknown, metadata?: ColumnMetadata): unknown {
  if (value === '' || value == null) return null
  if (!metadata) return value
  if (metadata.data_type === 'boolean') return Boolean(value)
  if (metadata.data_type === 'json' || metadata.data_type === 'jsonb') {
    return typeof value === 'string' ? JSON.parse(value) as unknown : value
  }
  if (['smallint', 'integer', 'bigint'].includes(metadata.data_type)) {
    const text = String(value)
    if (!/^-?\d+$/.test(text)) throw new Error(`${metadata.column_name} deve ser um inteiro`)
    const integer = BigInt(text)
    const ranges: Record<string, [bigint, bigint]> = {
      int2: [-32768n, 32767n],
      int4: [-2147483648n, 2147483647n],
      int8: [-9223372036854775808n, 9223372036854775807n],
    }
    const range = ranges[metadata.udt_name]
    if (range && (integer < range[0] || integer > range[1])) throw new Error(`${metadata.column_name} está fora do limite de ${metadata.data_type}`)
    return text
  }
  if (['numeric', 'decimal', 'real', 'double precision'].includes(metadata.data_type)) {
    const text = String(value)
    const match = /^-?(\d+)(?:\.(\d+))?$/.exec(text)
    if (!match) throw new Error(`${metadata.column_name} deve ser um número válido`)
    const integerDigits = match[1].replace(/^0+/, '').length || 1
    const decimalDigits = match[2]?.length ?? 0
    if (metadata.numeric_precision != null && integerDigits + decimalDigits > metadata.numeric_precision) throw new Error(`${metadata.column_name} excede a precisão ${metadata.numeric_precision}`)
    if (metadata.numeric_scale != null && decimalDigits > metadata.numeric_scale) throw new Error(`${metadata.column_name} aceita no máximo ${metadata.numeric_scale} casas decimais`)
    return text
  }
  if (metadata.character_maximum_length != null && [...String(value)].length > metadata.character_maximum_length) throw new Error(`${metadata.column_name} aceita no máximo ${metadata.character_maximum_length} caracteres`)
  return value
}

function sameFieldValue(left: unknown, right: unknown, metadata?: ColumnMetadata) {
  const normalizedLeft = normalizeFieldValue(left, metadata)
  const normalizedRight = normalizeFieldValue(right, metadata)
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight)
}

function appendMultiFilter(query: URLSearchParams, key: string, selected: string[] | null) {
  if (selected === null) return
  if (selected.length === 0) {
    query.append(key, '__none__')
    return
  }
  selected.forEach((value) => query.append(key, value))
}

export default function LiveWorkspace() {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [section, setSection] = useState<Section>('Dashboard')
  const [setupRequired, setSetupRequired] = useState(false)
  const [setupChecked, setSetupChecked] = useState(false)
  const [serverError, setServerError] = useState('')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loginError, setLoginError] = useState('')
  const [notice, setNotice] = useState('')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string[] | null>(['Erro'])
  const [automationFilter, setAutomationFilter] = useState<string[] | null>(null)
  const [sort, setSort] = useState<RoutineSort>('executar_apos')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [requestStatus, setRequestStatus] = useState('Pendente')
  const [routineStatuses, setRoutineStatuses] = useState<Array<{ id: number; descricao: string }>>([])
  const [automationProjects, setAutomationProjects] = useState<string[]>([])
  const [routines, setRoutines] = useState<Routine[]>([])
  const [routineTotal, setRoutineTotal] = useState(0)
  const [requests, setRequests] = useState<ChangeRequest[]>([])
  const [requestTotal, setRequestTotal] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [recentRoutines, setRecentRoutines] = useState<Routine[]>([])
  const [errorRoutines, setErrorRoutines] = useState<Routine[]>([])
  const [errorRoutineTotal, setErrorRoutineTotal] = useState(0)
  const [entityRows, setEntityRows] = useState<Array<Record<string, unknown>>>([])
  const [entityColumns, setEntityColumns] = useState<ColumnMetadata[]>([])
  const [entityTotal, setEntityTotal] = useState(0)
  const [entitySearch, setEntitySearch] = useState('')
  const [refreshTick, setRefreshTick] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [drafts, setDrafts] = useState<Record<string, RoutineDraft>>({})
  const [detail, setDetail] = useState<Routine | null>(null)
  const [detailOriginal, setDetailOriginal] = useState<Record<string, unknown>>({})
  const [requestDetail, setRequestDetail] = useState<ChangeRequest | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([
      apiRequest<{ status: string }>('/health'),
      apiRequest<{ required: boolean }>('/auth/setup-status'),
      apiRequest<{ user: SessionUser | null }>('/auth/me'),
    ]).then(([, setup, session]) => {
      if (!active) return
      setSetupRequired(setup.required)
      setUser(session.user)
      if (session.user) {
        setRequestStatus(session.user.perfil === 'aprovador' ? 'Pendente' : 'Todos')
        setSection('Dashboard')
      }
      setSetupChecked(true)
    }).catch(() => {
      if (!active) return
      setServerError('Não foi possível conectar à API/PostgreSQL. Verifique a configuração do servidor.')
      setSetupChecked(true)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!user) return
    apiRequest<Array<{ id: number; descricao: string }>>('/routines/statuses').then(setRoutineStatuses).catch(() => undefined)
    apiRequest<string[]>('/automation-projects').then(setAutomationProjects).catch(() => undefined)
    const timer = window.setInterval(() => setRefreshTick((value) => value + 1), 15000)
    return () => window.clearInterval(timer)
  }, [user])

  useEffect(() => {
    if (!user) return
    let active = true
    const load = async () => {
      try {
        if (section === 'Dashboard') {
          const [metrics, recent, errors] = await Promise.all([
            apiRequest<DashboardData>('/dashboard'),
            apiRequest<PageResult<RoutineRow>>('/routines?page=1&sort=executar_apos&direction=desc'),
            apiRequest<PageResult<RoutineRow>>('/routines?page=1&status=Erro&sort=executar_apos&direction=desc'),
          ])
          if (!active) return
          setDashboard(metrics); setRecentRoutines(recent.items.map(mapRoutine)); setErrorRoutines(errors.items.map(mapRoutine)); setErrorRoutineTotal(errors.total)
        }
        if (section === 'Rotinas') {
          const query = new URLSearchParams({ page: String(page), sort, direction: sortDirection })
          if (search) query.set('search', search)
          appendMultiFilter(query, 'status', statusFilter)
          appendMultiFilter(query, 'automation', automationFilter)
          const result = await apiRequest<PageResult<RoutineRow>>(`/routines?${query}`)
          if (active) { setRoutines(result.items.map(mapRoutine)); setRoutineTotal(result.total) }
        }
        if (section === 'Solicitações') {
          const query = new URLSearchParams({ page: String(page), status: requestStatus })
          const result = await apiRequest<PageResult<RequestRow>>(`/requests?${query}`)
          if (active) { setRequests(result.items.map(mapRequest)); setRequestTotal(result.total) }
        }
        if (section === 'Automações' || section === 'Robôs' || section === 'Usuários') {
          const endpoint = section === 'Automações' ? '/entities/automations' : section === 'Robôs' ? '/entities/robots' : '/users'
          const query = new URLSearchParams({ page: String(page) })
          if (entitySearch) query.set('search', entitySearch)
          const result = await apiRequest<PageResult<Record<string, unknown>> & { columns: ColumnMetadata[] }>(`${endpoint}?${query}`)
          if (active) { setEntityRows(result.items); setEntityColumns(result.columns ?? []); setEntityTotal(result.total) }
        }
      } catch {
        if (active) setNotice(`Não foi possível carregar dados de ${section.toLowerCase()} do AGIS`)
      }
    }
    void load()
    const timer = window.setInterval(() => setRefreshTick((value) => value + 1), 15000)
    return () => { active = false; window.clearInterval(timer) }
  }, [user, section, page, search, statusFilter, automationFilter, sort, sortDirection, requestStatus, entitySearch, refreshTick])

  useEffect(() => {
    if (!user) return
    apiRequest<PageResult<RequestRow>>('/requests?page=1&status=Pendente')
      .then((result) => setPendingCount(result.total)).catch(() => undefined)
  }, [user, section, refreshTick])

  const visibleSections = sections.filter(({ label }) => user?.perfil === 'aprovador' || label !== 'Usuários')
  const pageCount = Math.max(1, Math.ceil((section === 'Rotinas' ? routineTotal : section === 'Solicitações' ? requestTotal : entityTotal) / 10))
  const initials = user?.nome.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() ?? ''

  function notify(message: string) { setNotice(message); window.setTimeout(() => setNotice(''), 3200) }
  function sortRoutinesBy(column: RoutineSort) {
    setPage(1)
    if (sort === column) setSortDirection((value) => value === 'asc' ? 'desc' : 'asc')
    else { setSort(column); setSortDirection('desc') }
  }
  function navigate(next: Section) { setSection(next); setPage(1); setSelected([]); setEntitySearch('') }
  function openRoutineFromDashboard(routine: Routine) {
    setSearch(`${routine.table}/${routine.recordId}`)
    setStatusFilter(null)
    setAutomationFilter(null)
    setPage(1)
    setSection('Rotinas')
  }
  function handleContentRowClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement
    if (section === 'Automações' || section === 'Robôs') {
      if (target.closest('button')) return
      const row = target.closest('tbody tr')
      row?.querySelector<HTMLButtonElement>('button[title="Solicitar alteração"]')?.click()
      return
    }
    if (section !== 'Solicitações' || target.closest('.approve-icon, .reject-icon')) return
    const row = target.closest('tbody tr')
    const body = row?.parentElement
    if (!row || !body) return
    const index = Array.from(body.children).indexOf(row)
    const request = requests[index]
    if (request) setRequestDetail(request)
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoginError('')
    try {
      const endpoint = setupRequired ? '/auth/setup' : '/auth/login'
      const body = setupRequired ? { login, nome: name, password } : { login, password }
      const result = await apiRequest<{ user: SessionUser }>(endpoint, { method: 'POST', body: JSON.stringify(body) })
      setUser(result.user)
      setRequestStatus(result.user.perfil === 'aprovador' ? 'Pendente' : 'Todos')
      setSetupRequired(false)
      setSection('Dashboard')
    } catch {
      setLoginError('Não foi possível validar o acesso. Confira os campos e a disponibilidade da API.')
    }
  }

  function openRoutine(row: Routine) {
    setDetail({ ...row, details: { ...(row.details ?? {}) } })
    setDetailOriginal({ ...(row.details ?? {}) })
  }

  function saveRoutineDraft() {
    if (!detail?.details) return
    let changes: Record<string, unknown>
    try {
      changes = Object.fromEntries(Object.entries(detail.details).flatMap(([key, value]) => {
        if (key === 'id') return []
        const metadata = detail.columnMetadata?.find((column) => column.column_name === key)
        if (value === '' && metadata?.is_nullable === 'NO') throw new Error(`${key} não pode ficar vazio`)
        if (sameFieldValue(value, detailOriginal[key], metadata)) return []
        return [[key, normalizeFieldValue(value, metadata)]]
      }))
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Valor inválido')
      return
    }
    if (!Object.keys(changes).length) { notify('Nenhuma alteração detectada'); return }
    setDrafts((current) => ({ ...current, [detail.id]: { routine: detail, changes } }))
    setSelected((current) => current.includes(detail.id) ? current : [...current, detail.id])
    setDetail(null)
    notify('Alteração adicionada ao lote')
  }

  async function sendForApproval() {
    const items = selected.map((id) => drafts[id]).filter((draft): draft is RoutineDraft => Boolean(draft))
    if (!items.length) { notify('Abra os detalhes e altere ao menos um campo'); return }
    try {
      await apiRequest('/requests', { method: 'POST', body: JSON.stringify({ items: items.map(({ routine, changes }) => ({
        type: 'rotina', schema: routine.schema, table: routine.table, id: routine.recordId,
        automationId: routine.automationId, routineId: routine.taskId, changes,
      })) }) })
      setDrafts({}); setSelected([]); setRequestStatus('Pendente'); navigate('Solicitações')
      notify(`${items.length} registro(s) enviado(s) para aprovação`)
    } catch { notify('Falha ao enviar solicitação para aprovação') }
  }

  async function decideRequest(id: string, decision: 'Aprovado' | 'Recusado') {
    try {
      await apiRequest(`/requests/${id}/decision`, { method: 'POST', body: JSON.stringify({ decision }) })
      setRefreshTick((value) => value + 1)
      notify(`Solicitação ${decision.toLowerCase()}`)
    } catch (error) { notify(error instanceof Error ? error.message : 'Não foi possível concluir a decisão') }
  }

  if (!setupChecked) return <main className="login-shell"><section className="login-panel"><p>Conectando ao AGIS…</p></section></main>
  if (!user) return <Login onSubmit={submitLogin} setupRequired={setupRequired} name={name} setName={setName} login={login} setLogin={setLogin} password={password} setPassword={setPassword} error={loginError || serverError} />

  return <div className="app-shell">
    <aside className="sidebar">
      <Brand />
      <div className="workspace-switch"><i /><span><strong>AGIS</strong><small>Banco operacional</small></span><ChevronDown size={15} /></div>
      <span className="nav-caption">ESPAÇO DE TRABALHO</span>
      <nav className="main-nav">{visibleSections.map(({ label, icon: Icon }) => <button key={label} title={label} aria-label={label} className={`nav-item ${section === label ? 'active' : ''}`} onClick={() => navigate(label)}><Icon size={17} /><span>{label}</span>{label === 'Solicitações' && pendingCount > 0 && <b className="nav-count">{pendingCount}</b>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="connection"><i className="connection-dot" /><span><strong>Banco conectado</strong><small>PostgreSQL · 1 conexão</small></span><Database size={15} /></div><button className="help-link"><CircleHelp size={16} /> Central de ajuda</button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumbs"><span>Operações</span><b>/</b><strong>{section}</strong></div><div className="top-actions"><span className="live-state"><i /> AO VIVO</span><button className="icon-button notification-button" title="Notificações"><Bell size={17} />{pendingCount > 0 && <i />}</button><span className="top-divider" /><button className="profile-button" onClick={() => navigate('Configurações')}><span className="avatar">{initials}</span><span><strong>{user.nome}</strong><small>{user.perfil === 'aprovador' ? 'Aprovador' : 'Visualização'}</small></span><ChevronDown size={14} /></button><button className="icon-button" title="Sair" onClick={async () => { await apiRequest('/auth/logout', { method: 'POST' }).catch(() => undefined); setUser(null); setSetupRequired(false) }}><LogOut size={16} /></button></div></header>
      <div className="content-wrap" onClick={handleContentRowClick}>
        {notice && <div className="toast"><Check size={15} />{notice}<button onClick={() => setNotice('')}><X size={14} /></button></div>}
        {section === 'Dashboard' && <Dashboard onOpen={navigate} onSelectRoutine={openRoutineFromDashboard} stats={dashboard} rows={recentRoutines} errorRows={errorRoutines} errorTotal={errorRoutineTotal} />}
        {section === 'Rotinas' && <>
          <Heading eyebrow="MONITORAMENTO" title="Rotinas" description="Acompanhe a execução e trate ocorrências das automações." actions={<>{selected.some((id) => drafts[id]) && <button className="primary-button" onClick={() => void sendForApproval()}>Enviar {selected.filter((id) => drafts[id]).length} para aprovação <ArrowRight size={15} /></button>}<button className="secondary-button" onClick={() => setRefreshTick((value) => value + 1)}><ArrowDownUp size={15} /> Atualizar</button></>} />
          <section className="data-panel"><div className="panel-title-row"><div><h2>Fila de execução</h2><span className="panel-meta">{routineTotal} registros · atualização automática</span></div><button className="icon-button" title="Mais opções"><MoreHorizontal size={19} /></button></div>
            <div className="filters-row"><label className="search-field"><Search size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Buscar rotina, tarefa ou automação" /></label><MultiSelectFilter icon={<Filter size={15} />} label="Automações" allLabel="Todas as automações" options={automationProjects} selected={automationFilter} onChange={(values) => { setAutomationFilter(values); setPage(1) }} /><MultiSelectFilter icon={<SlidersHorizontal size={15} />} label="Status" allLabel="Todos os status" options={routineStatuses.map((item) => item.descricao)} selected={statusFilter} onChange={(values) => { setStatusFilter(values); setPage(1) }} /></div>
            <div className="table-scroll"><table><thead><tr><th><input type="checkbox" aria-label="Selecionar rascunhos da página" checked={routines.some((row) => drafts[row.id]) && routines.filter((row) => drafts[row.id]).every((row) => selected.includes(row.id))} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, ...routines.filter((row) => drafts[row.id]).map((row) => row.id)])] : current.filter((id) => !routines.some((row) => row.id === id)))} /></th><SortHeader label="ROTINA" column="routine_id" sort={sort} direction={sortDirection} onSort={sortRoutinesBy} /><SortHeader label="AUTOMAÇÃO" column="automation" sort={sort} direction={sortDirection} onSort={sortRoutinesBy} /><SortHeader label="STATUS" column="status" sort={sort} direction={sortDirection} onSort={sortRoutinesBy} /><SortHeader label="AGÊNCIA" column="agency" sort={sort} direction={sortDirection} onSort={sortRoutinesBy} /><SortHeader label="ROBÔ" column="robot" sort={sort} direction={sortDirection} onSort={sortRoutinesBy} /><SortHeader label="TENTATIVAS" column="tentativas" sort={sort} direction={sortDirection} onSort={sortRoutinesBy} /><SortHeader label="EXECUTAR APÓS" column="executar_apos" sort={sort} direction={sortDirection} onSort={sortRoutinesBy} /><SortHeader label="ETAPA" column="etapa_execucao" sort={sort} direction={sortDirection} onSort={sortRoutinesBy} /><th /></tr></thead><tbody>{routines.map((row) => <tr key={row.id}><td><input type="checkbox" aria-label={`Selecionar ${row.id}`} checked={selected.includes(row.id)} onChange={() => setSelected((items) => items.includes(row.id) ? items.filter((id) => id !== row.id) : drafts[row.id] ? [...items, row.id] : items)} /></td><td><button className="routine-id" onClick={() => openRoutine(row)}>{row.id}</button><small className="sub-cell">Tarefa {row.taskId}</small></td><td className="strong-cell">{row.automation}</td><td><Status value={row.status} /></td><td>{row.agency}</td><td>{row.robot}</td><td>{row.attempts}</td><td>{row.scheduled}</td><td className="stage-cell">{row.stage}</td><td><button className="icon-button" title="Detalhes" onClick={() => openRoutine(row)}><MoreHorizontal size={17} /></button></td></tr>)}</tbody></table>{routines.length === 0 && <div className="empty-state">Nenhuma rotina encontrada com esses filtros.</div>}</div>
            <Pagination page={page} pageCount={pageCount} total={routineTotal} onChange={setPage} />
          </section>
        </>}
        {section === 'Solicitações' && <>
          <Heading eyebrow="GOVERNANÇA" title="Solicitações" description={user.perfil === 'aprovador' ? 'Revise as alterações propostas antes de aplicá-las no AGIS.' : 'Acompanhe o andamento das alterações que você enviou.'} actions={<span className="pending-total"><i />{pendingCount} pendentes</span>} />
          <section className="data-panel request-panel"><div className="request-toolbar"><div className="segmented-control">{(user.perfil === 'aprovador' ? ['Pendente', 'Todos', 'Aprovado', 'Recusado'] : ['Todos', 'Pendente', 'Aprovado', 'Recusado']).map((value) => <button key={value} className={requestStatus === value ? 'selected' : ''} onClick={() => { setRequestStatus(value); setPage(1) }}>{value}{value === 'Pendente' && user.perfil === 'aprovador' && pendingCount > 0 && <b>{pendingCount}</b>}</button>)}</div></div>
            <div className="table-scroll"><table><thead><tr><th>SOLICITAÇÃO</th>{user.perfil === 'aprovador' && <th>SOLICITANTE</th>}<th>AUTOMAÇÃO / ROTINA</th><th>OBJETO</th><th>ALTERAÇÕES</th><th>ENVIADA</th><th>STATUS</th>{user.perfil === 'aprovador' && <th>AÇÕES</th>}</tr></thead><tbody>{requests.map((item) => <tr key={item.id}><td><button className="routine-id" onClick={() => setRequestDetail(item)}>{item.id.slice(0, 8)}</button></td>{user.perfil === 'aprovador' && <td>{item.owner}</td>}<td><span className="strong-cell">{item.automation}</span><small className="sub-cell">{item.routineId}</small></td><td><code className="object-code">{item.target}</code></td><td>{item.changes} registros</td><td>{item.createdAt}</td><td><Status value={item.status} /></td>{user.perfil === 'aprovador' && <td>{item.status === 'Pendente' ? <span className="row-actions"><button className="approve-icon" title="Aprovar" onClick={() => void decideRequest(item.id, 'Aprovado')}><Check size={15} /></button><button className="reject-icon" title="Recusar" onClick={() => void decideRequest(item.id, 'Recusado')}><X size={15} /></button></span> : <button className="icon-button" title="Detalhes" onClick={() => setRequestDetail(item)}><MoreHorizontal size={16} /></button>}</td>}</tr>)}</tbody></table>{requests.length === 0 && <div className="empty-state">Nenhuma solicitação encontrada.</div>}</div><Pagination page={page} pageCount={Math.max(1, Math.ceil(requestTotal / 10))} total={requestTotal} onChange={setPage} /></section>
        </>}
        {(section === 'Automações' || section === 'Robôs' || section === 'Usuários') && <LiveEntity title={section} desc={section === 'Automações' ? 'Campos de sustentacao.automacao_new.' : section === 'Robôs' ? 'Campos de sustentacao.robo_new.' : 'Acessos, perfis e estado das contas cadastradas.'} items={entityRows} columns={entityColumns} page={page} total={entityTotal} search={entitySearch} onSearch={(value) => { setEntitySearch(value); setPage(1) }} onPage={setPage} onNotice={notify} onRefresh={() => setRefreshTick((value) => value + 1)} />}
        {section === 'Configurações' && <Settings user={user} onUserChange={(updated) => setUser((current) => current ? { ...current, ...updated } : current)} onNotice={notify} />}
      </div>
    </main>
    {requestDetail && <RequestDialog request={requestDetail} canApprove={user.perfil === 'aprovador'} onClose={() => setRequestDetail(null)} onDecide={(decision) => { void decideRequest(requestDetail.id, decision); setRequestDetail(null) }} />}
    {detail && <RoutineDialog routine={detail} onChange={setDetail} onClose={() => setDetail(null)} onSave={saveRoutineDraft} />}
  </div>
}

function Brand({ light = false }: { light?: boolean }) { return <div className={`brand ${light ? 'brand-light' : ''}`}><span className="brand-mark"><Activity size={18} /></span><span>nexo<span className="brand-thin">/rpa</span></span></div> }

function Login({ onSubmit, setupRequired, name, setName, login, setLogin, password, setPassword, error }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; setupRequired: boolean; name: string; setName: (value: string) => void; login: string; setLogin: (value: string) => void; password: string; setPassword: (value: string) => void; error: string }) {
  return <main className="login-shell"><section className="login-art"><Brand light /><div className="art-grid" /><div className="login-claim"><span className="eyebrow">CENTRO DE OPERAÇÕES</span><h1>Automação<br />sob controle.</h1><p>Visibilidade e governança para cada rotina crítica da operação.</p></div><div className="art-foot"><span>AGIS · AMBIENTE OPERACIONAL</span><span>01 / 03</span></div></section><section className="login-panel"><div className="login-top"><span>{setupRequired ? 'CONFIGURAÇÃO INICIAL' : 'ACESSO RESTRITO'}</span><span className="secure-label"><ShieldCheck size={14} /> CONEXÃO SEGURA</span></div><form className="login-form" onSubmit={onSubmit}><div className="login-heading"><span className="eyebrow">{setupRequired ? 'PRIMEIRO ACESSO' : 'BEM-VINDO DE VOLTA'}</span><h2>{setupRequired ? 'Criar conta aprovadora' : 'Entrar na plataforma'}</h2><p>{setupRequired ? 'Esta conta administrará os perfis e aprovações.' : 'Use suas credenciais para continuar.'}</p></div>{setupRequired && <label>Nome completo<input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Seu nome" required /></label>}<label>Usuário<input autoComplete="username" value={login} onChange={(event) => setLogin(event.target.value)} placeholder="seu.login" required /></label><label>Senha<input type="password" autoComplete={setupRequired ? 'new-password' : 'current-password'} minLength={setupRequired ? 12 : undefined} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={setupRequired ? 'Mínimo de 12 caracteres' : 'Senha'} required /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button login-button">{setupRequired ? 'Criar aprovador' : 'Acessar'} <ArrowRight size={16} /></button></form><div className="login-footer"><span>© 2026 NEXO AUTOMAÇÃO</span><span>AGIS</span></div></section></main>
}

function SortHeader({ label, column, sort, direction, onSort }: { label: string; column: RoutineSort; sort: RoutineSort; direction: 'asc' | 'desc'; onSort: (column: RoutineSort) => void }) {
  const active = sort === column
  return <th aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
    <button type="button" className={`sort-header${active ? ' active' : ''}`} onClick={() => onSort(column)}>
      {label}
      {active && (direction === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
    </button>
  </th>
}

function Heading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) { return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div><div className="heading-actions">{actions}</div></div> }
function Metric({ label, value, note, icon: Icon, tone }: { label: string; value: string; note: string; icon: typeof Gauge; tone: string }) { return <div className="metric"><span className={`metric-icon ${tone}`}><Icon size={17} /></span><span className="metric-label">{label}</span><strong>{value}</strong><small>{note}</small></div> }
function Status({ value }: { value: string }) { return <span className={`status-pill ${statusClass[value] ?? 'waiting'}`}><i />{value}</span> }

function Dashboard({ onOpen, onSelectRoutine, stats, rows, errorRows, errorTotal }: { onOpen: (section: Section) => void; onSelectRoutine: (routine: Routine) => void; stats: DashboardData | null; rows: Routine[]; errorRows: Routine[]; errorTotal: number }) {
  const errorCount = stats?.erros_com_solicitacao
  return <><Heading eyebrow={todayLabel} title="Visão geral" description="Acompanhe a saúde operacional das automações em tempo real." actions={<button className="secondary-button"><Clock3 size={15} /> Hoje <ChevronDown size={14} /></button>} /><div className="metric-strip dashboard-metrics"><Metric label="Automações ativas" value={stats ? String(stats.automacoes_ativas) : '—'} note="Situações 4 e 5" icon={Bot} tone="green" /><Metric label="Rotinas processadas hoje" value={stats ? String(stats.rotinas_hoje) : '—'} note="Soma de rotinas agendadas hoje" icon={Activity} tone="blue" /><Metric label="Erros com solicitação" value={errorCount == null ? '—' : String(errorCount)} note="Rotinas em erro com solicitação" icon={AlertTriangle} tone="red" /></div><div className="dashboard-grid"><section className="data-panel execution-panel"><div className="panel-title-row"><div><h2>Execuções recentes</h2><span className="panel-meta">Clique numa execução para abrir essa rotina</span></div><button className="text-button" onClick={() => onOpen('Rotinas')}>Ver todas <ArrowRight size={14} /></button></div>
        <div className="activity-list">{rows.slice(0, 5).map((row) => <button className="activity-row" key={row.id} onClick={() => onSelectRoutine(row)}><span className={`activity-mark ${statusClass[row.status]}`}><Activity size={15} /></span><span className="activity-main"><strong>{row.automation}</strong><small>{row.table}/{row.recordId} · tarefa {row.taskId}</small></span><span className="activity-time">{row.scheduled}</span><Status value={row.status} /></button>)}</div>
        {rows.length === 0 && <div className="empty-state">Nenhuma rotina retornada pelo AGIS.</div>}
      </section>
      <section className="data-panel errors-panel">
        <div className="panel-title-row"><div><h2>Rotinas com erro</h2><span className="panel-meta">Falhas consultadas no AGIS</span></div><span className="error-count">{errorTotal}</span></div>
        {errorRows.slice(0, 3).map((row) => <button className="error-row" key={row.id} onClick={() => onSelectRoutine(row)}><span className="error-marker"><AlertTriangle size={14} /></span><span><strong>{row.automation}</strong><small>{row.table}/{row.recordId} · {row.note}</small></span><ArrowRight size={15} /></button>)}
        {errorRows.length === 0 && <div className="empty-state">Nenhuma rotina em erro retornada.</div>}
        <button className="all-errors" onClick={() => { onOpen('Rotinas') }}>Abrir fila de rotinas <ArrowRight size={14} /></button>
      </section>
    </div>
  </>
}

function Pagination({ page, pageCount, total, onChange }: { page: number; pageCount: number; total: number; onChange: (value: number) => void }) { return <div className="pagination"><span>Exibindo <strong>{total ? (page - 1) * 10 + 1 : 0}–{Math.min(page * 10, total)}</strong> de <strong>{total}</strong></span><div><button className="icon-button" disabled={page <= 1} onClick={() => onChange(page - 1)} title="Anterior"><ArrowLeft size={15} /></button><span>Página <strong>{page}</strong> de {pageCount}</span><button className="icon-button" disabled={page >= pageCount} onClick={() => onChange(page + 1)} title="Próxima"><ArrowRight size={15} /></button></div></div> }

function inputValue(value: unknown, metadata?: ColumnMetadata) {
  if (value == null) return ''
  if ((metadata?.data_type === 'json' || metadata?.data_type === 'jsonb') && typeof value === 'object') return JSON.stringify(value, null, 2)
  const text = String(value)
  if (metadata?.data_type === 'date') return text.slice(0, 10)
  if (metadata?.data_type.startsWith('timestamp')) {
    const local = text.replace(' ', 'T')
    if (metadata.data_type.includes('with time zone')) {
      const parsed = new Date(text)
      if (!Number.isNaN(parsed.getTime())) return new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
    }
    return local.slice(0, 16)
  }
  if (metadata?.data_type.startsWith('time')) return text.slice(0, 8)
  return text
}

function MetadataField({ metadata, value, disabled = false, onChange }: { metadata?: ColumnMetadata; value: unknown; disabled?: boolean; onChange: (value: unknown) => void }) {
  const label = metadata?.column_name ?? 'Campo'
  const type = metadata?.data_type ?? 'text'
  const required = metadata?.is_nullable === 'NO' && !disabled
  const common = { disabled, required, maxLength: metadata?.character_maximum_length ?? undefined }
  const typeFlagColumns = new Set(['dia_util', 'by_pass', 'somente_dia_util', 'restricao_sistema', 'ativo', 'prioritario'])
  if (typeFlagColumns.has(label)) {
    return <label key={label}><span className="field-label-line"><span>{label}</span><small className="field-type">char(1)</small></span><select disabled={disabled} required={required} value={value == null ? '' : String(value)} onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}><option value="">{metadata?.is_nullable === 'YES' ? 'Nulo' : 'Selecione T ou F'}</option><option value="T">T</option><option value="F">F</option></select></label>
  }
  if (type === 'boolean' && metadata?.is_nullable === 'YES') {
    return <label key={label}><span className="field-label-line"><span>{label}</span><small className="field-type">boolean · opcional</small></span><select disabled={disabled} value={value == null ? '' : value ? 'true' : 'false'} onChange={(event) => onChange(event.target.value === '' ? null : event.target.value === 'true')}><option value="">Nulo</option><option value="true">Sim</option><option value="false">Não</option></select></label>
  }
  if (type === 'boolean') {
    return <label key={label} className="boolean-field"><span className="field-label-line"><span>{label}</span><small className="field-type">boolean</small></span><input type="checkbox" checked={Boolean(value)} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /></label>
  }
  if (type === 'text' || type === 'json' || type === 'jsonb') {
    return <label key={label}><span className="field-label-line"><span>{label}</span><small className="field-type">{type}</small></span><textarea value={inputValue(value, metadata)} disabled={disabled} required={required} onChange={(event) => onChange(event.target.value)} rows={type === 'text' ? 3 : 4} /></label>
  }
  if (type === 'date' || type.includes('timestamp') || type.startsWith('time')) {
    const inputType = type === 'date' ? 'date' : type.startsWith('timestamp') ? 'datetime-local' : 'time'
    return <label key={label}><span className="field-label-line"><span>{label}</span><small className="field-type">{type}</small></span><input {...common} type={inputType} value={inputValue(value, metadata)} onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)} /></label>
  }
  const numeric = ['smallint', 'integer', 'bigint', 'numeric', 'decimal', 'real', 'double precision'].includes(type)
  const integer = ['smallint', 'integer', 'bigint'].includes(type)
  const step = integer ? '1' : metadata?.numeric_scale != null && metadata.numeric_scale > 0 ? String(10 ** -metadata.numeric_scale) : 'any'
  return <label key={label}><span className="field-label-line"><span>{label}</span><small className="field-type">{type}{metadata?.character_maximum_length ? `(${metadata.character_maximum_length})` : ''}</small></span><input {...common} type={numeric ? 'number' : 'text'} step={numeric ? step : undefined} value={inputValue(value, metadata)} onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)} /></label>
}

function MultiSelectFilter({ icon, label, allLabel, options, selected, onChange }: { icon: React.ReactNode; label: string; allLabel: string; options: string[]; selected: string[] | null; onChange: (values: string[] | null) => void }) {
  const summary = selected === null ? allLabel : selected.length === 0 ? `Nenhum(a) ${label.toLowerCase()}` : selected.length === 1 ? selected[0] : `${selected.length} ${label.toLowerCase()} selecionados`
  function toggle(option: string) {
    const next = selected === null
      ? options.filter((item) => item !== option)
      : selected.includes(option)
        ? selected.filter((item) => item !== option)
        : [...selected, option]
    onChange(next.length === options.length ? null : next)
  }
  function closeSiblings(event: ToggleEvent<HTMLDetailsElement>) {
    if (!event.currentTarget.open) return
    const row = event.currentTarget.parentElement
    if (!row) return
    for (const details of row.querySelectorAll('details.multi-select-filter')) {
      if (details !== event.currentTarget) details.removeAttribute('open')
    }
  }
  return <details className="multi-select-filter" name="rotinas-filters" onToggle={closeSiblings}>
    <summary className="select-filter">{icon}<span>{summary}</span><ChevronDown size={13} /></summary>
    <div className="multi-select-menu">
      <button type="button" className="multi-select-all" onClick={() => onChange(selected === null ? [] : null)}>{selected === null ? 'Desmarcar todos' : 'Selecionar todos'}</button>
      {options.map((option) => <label key={option} className="multi-select-option"><input type="checkbox" checked={selected === null || selected.includes(option)} onChange={() => toggle(option)} /><span>{option}</span></label>)}
      {options.length === 0 && <span className="multi-select-empty">Nenhuma opção disponível</span>}
    </div>
  </details>
}

function LiveEntity({ title, desc, items, columns: columnMetadata, page, total, search, onSearch, onPage, onNotice, onRefresh }: { title: 'Automações' | 'Robôs' | 'Usuários'; desc: string; items: Array<Record<string, unknown>>; columns: ColumnMetadata[]; page: number; total: number; search: string; onSearch: (value: string) => void; onPage: (page: number) => void; onNotice: (message: string) => void; onRefresh: () => void }) {
  const [active, setActive] = useState<Record<string, unknown> | null>(null)
  const [edited, setEdited] = useState<Record<string, unknown>>({})
  const [creating, setCreating] = useState(false)
  const [resetting, setResetting] = useState<Record<string, unknown> | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [newUser, setNewUser] = useState({ nome: '', login: '', password: '', perfil: 'visualizacao' as Profile })
  const isUsers = title === 'Usuários'
  const entityType = title === 'Automações' ? 'automacao' : 'robo'
  const columns = items[0] ? Object.keys(items[0]) : columnMetadata.map((column) => column.column_name)

  async function submitChange() {
    if (!active) return
    let changes: Record<string, unknown>
    try {
      changes = Object.fromEntries(Object.entries(edited).flatMap(([key, value]) => {
        if (key === 'id') return []
        const metadata = columnMetadata.find((column) => column.column_name === key)
        if (value === '' && metadata?.is_nullable === 'NO') throw new Error(`${key} não pode ficar vazio`)
        if (sameFieldValue(value, active[key], metadata)) return []
        return [[key, normalizeFieldValue(value, metadata)]]
      }))
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Valor inválido')
      return
    }
    if (!Object.keys(changes).length) { onNotice('Nenhuma alteração detectada'); return }
    try {
      await apiRequest('/requests', { method: 'POST', body: JSON.stringify({ items: [{ type: entityType, id: active.id, automationId: active.id_automacao, changes }] }) })
      setActive(null); onNotice('Alteração enviada para aprovação')
    } catch { onNotice('Não foi possível enviar a alteração') }
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      await apiRequest('/users', { method: 'POST', body: JSON.stringify(newUser) })
      setCreating(false); setNewUser({ nome: '', login: '', password: '', perfil: 'visualizacao' }); onRefresh(); onNotice('Usuário criado')
    } catch { onNotice('Não foi possível criar o usuário') }
  }

  async function toggleUserProfile(item: Record<string, unknown>) {
    const perfil = item.perfil === 'aprovador' ? 'visualizacao' : 'aprovador'
    try { await apiRequest(`/users/${item.id}`, { method: 'PATCH', body: JSON.stringify({ perfil }) }); onRefresh(); onNotice(`Perfil atualizado para ${perfil}`) }
    catch { onNotice('Não foi possível alterar o perfil') }
  }

  async function saveResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!resetting) return
    try {
      await apiRequest(`/users/${resetting.id}`, { method: 'PATCH', body: JSON.stringify({ password: resetPassword }) })
      setResetting(null); setResetPassword(''); onRefresh(); onNotice('Senha redefinida')
    } catch { onNotice('Não foi possível redefinir a senha') }
  }

  return <><Heading eyebrow={isUsers ? 'ADMINISTRAÇÃO' : 'CADASTROS'} title={title} description={desc} actions={isUsers ? <button className="primary-button" onClick={() => setCreating(true)}><Plus size={15} /> Novo usuário</button> : undefined} /><section className="data-panel entity-panel"><div className="filters-row"><label className="search-field"><Search size={16} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder={`Buscar ${title.toLowerCase()}`} /></label><span className="panel-meta">{total} registros</span></div><div className="table-scroll"><table><thead><tr>{columns.map((column) => <th key={column}>{column.replaceAll('_', ' ').toUpperCase()}</th>)}{columns.length > 0 && <th>AÇÕES</th>}</tr></thead><tbody>{items.map((item) => <tr key={String(item.id)}>{columns.map((column, index) => <td key={column}>{index === 0 ? <span className="strong-cell">{displayValue(item[column])}</span> : displayValue(item[column])}</td>)}{columns.length > 0 && <td>{isUsers ? <span className="row-actions"><button className="icon-button" title="Alternar perfil aprovador" onClick={() => void toggleUserProfile(item)}><ShieldCheck size={16} /></button><button className="icon-button" title="Redefinir senha" onClick={() => setResetting(item)}><KeyRound size={15} /></button></span> : <button className="icon-button" title="Solicitar alteração" onClick={() => { setActive(item); setEdited({ ...item }) }}><Pencil size={15} /></button>}</td>}</tr>)}</tbody></table>{items.length === 0 && <div className="empty-state">Nenhum registro encontrado.</div>}</div><Pagination page={page} pageCount={Math.max(1, Math.ceil(total / 10))} total={total} onChange={onPage} /></section>
    {active && <div className="modal-backdrop" onClick={() => setActive(null)}><section className="detail-modal" onClick={(event) => event.stopPropagation()}><header><div><span className="eyebrow">SOLICITAR ALTERAÇÃO</span><h2>{title} · {displayValue(active.id)}</h2></div><button className="icon-button" onClick={() => setActive(null)} title="Fechar"><X size={18} /></button></header><div className="detail-grid">{columns.map((key) => <MetadataField key={key} metadata={columnMetadata.find((column) => column.column_name === key)} value={edited[key]} disabled={key === 'id' || columnMetadata.find((column) => column.column_name === key)?.is_identity === 'YES' || columnMetadata.find((column) => column.column_name === key)?.is_generated !== 'NEVER'} onChange={(value) => setEdited((current) => ({ ...current, [key]: value }))} />)}</div><footer><button className="secondary-button" onClick={() => setActive(null)}>Cancelar</button><button className="primary-button" onClick={() => void submitChange()}>Enviar para aprovação</button></footer></section></div>}
    {creating && <div className="modal-backdrop" onClick={() => setCreating(false)}><form className="detail-modal user-create-form" onSubmit={createUser} onClick={(event) => event.stopPropagation()}><header><div><span className="eyebrow">NOVO ACESSO</span><h2>Criar usuário</h2></div><button type="button" className="icon-button" onClick={() => setCreating(false)} title="Fechar"><X size={18} /></button></header><div className="detail-grid"><label>Nome<input required value={newUser.nome} onChange={(event) => setNewUser((current) => ({ ...current, nome: event.target.value }))} /></label><label>Login<input required minLength={3} value={newUser.login} onChange={(event) => setNewUser((current) => ({ ...current, login: event.target.value }))} /></label><label>Senha inicial<input required minLength={12} type="password" value={newUser.password} onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))} /></label><label>Perfil<select value={newUser.perfil} onChange={(event) => setNewUser((current) => ({ ...current, perfil: event.target.value as Profile }))}><option value="visualizacao">Visualização</option><option value="aprovador">Aprovador</option></select></label></div><footer><button type="button" className="secondary-button" onClick={() => setCreating(false)}>Cancelar</button><button className="primary-button">Criar usuário</button></footer></form></div>}
    {resetting && <div className="modal-backdrop" onClick={() => setResetting(null)}><form className="detail-modal user-create-form" onSubmit={saveResetPassword} onClick={(event) => event.stopPropagation()}><header><div><span className="eyebrow">SEGURANÇA DA CONTA</span><h2>Redefinir senha</h2></div><button type="button" className="icon-button" onClick={() => setResetting(null)} title="Fechar"><X size={18} /></button></header><div className="detail-grid"><label>Usuário<input value={String(resetting.login ?? '')} disabled /></label><label>Nova senha<input type="password" minLength={12} required value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} /></label></div><footer><button type="button" className="secondary-button" onClick={() => setResetting(null)}>Cancelar</button><button className="primary-button">Salvar senha</button></footer></form></div>}
  </>
}

function RoutineDialog({ routine, onChange, onClose, onSave }: { routine: Routine; onChange: (routine: Routine) => void; onClose: () => void; onSave: () => void }) {
  return <div className="modal-backdrop" onClick={onClose}><section className="detail-modal" onClick={(event) => event.stopPropagation()}><header><div><span className="eyebrow">DETALHES DA ROTINA</span><h2>{routine.id}</h2></div><button className="icon-button" onClick={onClose} title="Fechar"><X size={18} /></button></header><div className="detail-status"><Status value={routine.status} /><span>Tarefa {routine.taskId}</span></div><div className="detail-grid">{Object.entries(routine.details ?? {}).map(([key, value]) => {
    const metadata = routine.columnMetadata?.find((column) => column.column_name === key)
    return <MetadataField key={key} metadata={metadata} value={value} disabled={key === 'id' || metadata?.is_identity === 'YES' || (metadata != null && metadata.is_generated !== 'NEVER')} onChange={(nextValue) => onChange({ ...routine, details: { ...routine.details, [key]: nextValue } })} />
  })}</div><footer><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" onClick={onSave}>Adicionar ao lote <ArrowRight size={15} /></button></footer></section></div>
}

function RequestDialog({ request, canApprove, onClose, onDecide }: { request: ChangeRequest; canApprove: boolean; onClose: () => void; onDecide: (decision: 'Aprovado' | 'Recusado') => void }) {
  return <div className="modal-backdrop" onClick={onClose}>
    <section className="detail-modal request-detail-modal" onClick={(event) => event.stopPropagation()}>
      <header>
        <div><span className="eyebrow">SOLICITAÇÃO · {request.id}</span><h2>Revisão das alterações</h2></div>
        <button className="icon-button" onClick={onClose} title="Fechar"><X size={18} /></button>
      </header>
      <div className="request-summary">
        <Status value={request.status} />
        <span><small>Solicitante</small><strong>{request.owner}</strong></span>
        <span><small>Enviada</small><strong>{request.createdAt}</strong></span>
        <span><small>Registros no lote</small><strong>{request.changes}</strong></span>
      </div>
      <div className="request-record-list">
        {request.items?.map((item, index) => {
          const fields = [...new Set([...Object.keys(item.previous), ...Object.keys(item.proposed)])]
          const recordId = item.recordKey.id ?? Object.values(item.recordKey).join(', ')
          return <section className="change-item" key={`${item.schema}.${item.tabela}-${String(recordId)}-${index}`}>
            <div className="change-record-heading">
              <span className="record-index">{String(index + 1).padStart(2, '0')}</span>
              <div className="record-title"><strong>{item.schema}.{item.tabela}</strong><small>{item.automation}</small></div>
              <span className="record-primary"><small>Registro (id)</small><strong>{displayValue(recordId)}</strong></span>
            </div>
            <div className="record-context">
              <span><small>Tipo</small><strong>{item.tipo}</strong></span>
              <span><small>ID da tarefa</small><strong>{displayValue(item.routineId)}</strong></span>
              <span><small>Campos alterados</small><strong>{fields.length}</strong></span>
            </div>
            <div className="change-table-wrap"><table className="change-table">
              <thead><tr><th>CAMPO</th><th>VALOR ATUAL</th><th>VALOR SOLICITADO</th></tr></thead>
              <tbody>{fields.map((field) => <tr key={field}>
                <td><code>{field}</code></td>
                <td><span className="change-old-value">{displayValue(item.previous[field])}</span></td>
                <td><span className="change-new-value"><ArrowRight size={13} />{displayValue(item.proposed[field])}</span></td>
              </tr>)}</tbody>
            </table></div>
          </section>
        })}
        {(!request.items || request.items.length === 0) && <div className="empty-state">Esta solicitação não possui detalhes de alteração disponíveis.</div>}
      </div>
      <footer>
        <button className="secondary-button" onClick={onClose}>Fechar</button>
        {canApprove && request.status === 'Pendente' && <>
          <button className="reject-icon" title="Recusar" onClick={() => onDecide('Recusado')}><X size={15} /></button>
          <button className="primary-button" onClick={() => onDecide('Aprovado')}><Check size={15} /> Aprovar lote</button>
        </>}
      </footer>
    </section>
  </div>
}

function Settings({ user, onUserChange, onNotice }: { user: SessionUser; onUserChange: (user: Partial<SessionUser>) => void; onNotice: (message: string) => void }) {
  const [nome, setNome] = useState(user.nome)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (newPassword && newPassword !== confirmation) { onNotice('As senhas não coincidem'); return }
    try {
      const result = await apiRequest<{ nome: string }>('/settings', { method: 'PATCH', body: JSON.stringify({ nome, currentPassword: currentPassword || undefined, newPassword: newPassword || undefined }) })
      onUserChange({ nome: result.nome }); setCurrentPassword(''); setNewPassword(''); setConfirmation(''); onNotice('Configurações atualizadas')
    } catch { onNotice('Não foi possível salvar. Confira a senha atual e os campos.') }
  }
  return <><Heading eyebrow="PREFERÊNCIAS" title="Configurações" description="Gerencie seus dados de acesso e preferências pessoais." /><section className="settings-panel data-panel"><div className="settings-heading"><span className="avatar large">{user.nome.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span><div><h2>{user.nome}</h2><p>{user.login} · {user.perfil === 'aprovador' ? 'Aprovador' : 'Visualização'}</p></div></div><form className="settings-form" onSubmit={save}><label>Nome completo<input value={nome} onChange={(event) => setNome(event.target.value)} required /></label><label>Login<input value={user.login} disabled /></label><label>Senha atual<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" /></label><label>Nova senha<input type="password" minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Mínimo de 12 caracteres" autoComplete="new-password" /></label><label>Confirmar nova senha<input type="password" minLength={12} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Repita a nova senha" autoComplete="new-password" /></label><div className="settings-footer"><button className="primary-button">Salvar alterações</button></div></form></section></>
}

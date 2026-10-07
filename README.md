# Gestão RPA

Aplicação de governança para consulta de rotinas do AGIS e aprovação de alterações antes da gravação nas tabelas de origem.

## Requisitos

- Node.js 20.19+ (validado com Node 24.19.0)
- PostgreSQL acessível pelo servidor Node

## Configuração local

1. Copie `.env.example` para `.env` e configure host, porta, database, usuário, senha e `SESSION_SECRET`. Não versione `.env`.
2. Inicie a API com `npm run dev`.
3. Em outro terminal, inicie a interface com `npm run dev --prefix client`.
4. Abra `http://localhost:5173/`. Na primeira execução, crie o primeiro aprovador com login próprio e senha de pelo menos 12 caracteres. Esse cadastro inicial só é permitido por conexão local e quando ainda não há usuários.

A API inicia em `http://localhost:3000`. Na inicialização, aplica os scripts SQL em `server/migrations/` ao schema `gestao_rpa`. Também é possível provisionar o aprovador por `ADMIN_LOGIN`, `ADMIN_PASSWORD` e `ADMIN_NAME` no ambiente; esses valores devem ser secretos e não devem ser colocados no repositório.

## Banco AGIS confirmado

- PostgreSQL 13.20, database `agis`, conexão com o usuário `rpa` validada.
- A API compartilha um `pg.Pool` configurado com `max: 1`.
- O usuário possui acesso de leitura à origem, criação de schema e atualização nas tabelas de automação, robôs e nas tabelas dinâmicas verificadas.
- A consulta-base retorna schemas/tabelas dinâmicas em `rotina`; as tabelas verificadas possuem chave primária `id` e as colunas padronizadas para listagem.
- Status confirmados: Pendente (1), Concluido (2), Erro (3), Devolvido (4), Reportado (5), Aguardando Outros (6) e Processando (7).
- A API escapa e valida nomes de relações contra os resultados da consulta-base; valores de usuário são enviados como parâmetros.

Os detalhes do catálogo podem ser revalidados sem imprimir valores de registros com `node scripts/inspect-db.mjs`. A consulta dinâmica e a paginação são verificadas por `node --import tsx scripts/smoke-routines.mjs`.

## Funcionalidades implementadas

- Login com sessão armazenada em PostgreSQL, setup inicial do aprovador e perfis `visualizacao`/`aprovador`.
- Dashboard com agregações do AGIS.
- Rotinas dinâmicas com nomes de situação, agência e robô, busca, seleção múltipla de automações/status (Erro pré-selecionado), ordenação por status/horário, detalhes e paginação de 10.
- Formulários de edição de rotinas, automações e robôs usam metadata PostgreSQL para tipos, limites `varchar(n)`, nulabilidade, precisão e escala numérica, campos de data/hora e booleanos; flags AGIS `dia_util`, `by_pass`, `somente_dia_util`, `restricao_sistema`, `ativo` e `prioritario` usam seleção `T/F`.
- Solicitações de uma ou várias linhas, snapshots anterior/proposto, aprovação/recusa e auditoria.
- Detecção de conflito antes de aprovar; atualizações de um lote ocorrem numa única transação.
- Automações, robôs e usuários paginados; alterações a automações/robôs são submetidas para aprovação; aprovadores podem redefinir senhas de usuários.
- Viewers veem somente as próprias solicitações; aprovadores veem todas, com Pendente como filtro inicial e opção de histórico completo.
- Atualização periódica das telas ativas sem abrir conexões adicionais ao PostgreSQL.

Todas as telas operacionais consultam a API e o AGIS. Não há dados de demonstração ou fallback fictício; indisponibilidade do serviço é apresentada como erro/estado vazio.

# Especificacao de desenho: Gestao RPA

Data: 2026-10-06

## Objetivo

Criar uma aplicacao web para consultar rotinas do AGIS, permitir que usuarios proponham alteracoes e exigir aprovacao antes de gravar qualquer alteracao nas tabelas de origem. A aplicacao tera login, dashboard e areas de rotinas, automacoes, robos, solicitacoes, usuarios e configuracoes.

## Decisoes aprovadas

- Banco de dados: PostgreSQL local, database `agis` presumido a partir do pedido; validar durante a inspecao inicial.
- Backend Node.js e interface React, comunicando por API HTTP.
- Um processo da aplicacao compartilha um pool PostgreSQL com `max: 1`; todas as consultas reutilizam essa conexao.
- Atualizacao de dados da interface por consulta periodica, sem criar conexoes adicionais ao banco.
- Toda listagem de registros e paginada no servidor com 10 itens por pagina.
- Perfis: `visualizacao` e `aprovador`. A tela de solicitacoes e acessivel a ambos: usuarios de visualizacao veem apenas as proprias solicitacoes, enquanto aprovadores veem todas. Somente aprovadores podem administrar usuarios/perfis.
- O primeiro aprovador pode ser provisionado por variaveis de ambiente; quando ausentes, a primeira conta pode ser criada uma unica vez por setup local enquanto nao houver usuarios.
- A aprovacao aplica a alteracao na tabela original do AGIS.
- Solicitacoes de rotina podem propor alteracao em qualquer coluna editavel identificada nos metadados da tabela de origem.
- O total de erros conta rotinas atualmente em erro que possuam ao menos uma solicitacao de alteracao, contando cada rotina uma vez.

## Arquitetura e limites

A interface React nao acessa o banco diretamente. A API Node autentica o usuario, aplica autorizacao por perfil, valida entradas, executa consultas parametrizadas e fornece paginacao, filtros, ordenacao e metadados necessarios para as telas.

O modulo de banco mantem uma unica conexao reutilizavel por processo. A consulta-base de rotinas e:

```sql
SELECT a.table_name_schema AS schema, a.table_name, t.*
FROM rotina.tarefas_pendentes AS t
INNER JOIN sustentacao.automacao_new AS a ON a.id = t.id_automacao
```

O backend usa os valores de schema e tabela retornados pela consulta e os metadados do catalogo PostgreSQL para consultar as tabelas de origem. Identificadores SQL devem ser escapados como identificadores e validados contra os metadados; valores devem ser enviados como parametros. Nenhum identificador recebido diretamente do navegador pode compor SQL. Chaves primarias e tipos das tabelas dinamicas serao descobertos durante a inspecao do AGIS. Tabelas sem identificacao inequivoca de linha nao permitirao alteracoes ate que uma chave seja configurada.

As tabelas de suporte da aplicacao ficam no schema `gestao_rpa`, criadas por migracoes versionadas. O desenho logico inclui usuarios, solicitacoes, itens de solicitacao e auditoria. Cada item guarda alvo (schema/tabela autorizados e chave primaria), valores anteriores e valores propostos. O estado da solicitacao e `Pendente`, `Aprovado` ou `Recusado`.

## Autenticacao e autorizacao

A tela inicial e login. Senhas sao armazenadas com hash forte, nunca em texto puro. A sessao usa cookie seguro e validacao no servidor. O primeiro aprovador e criado por variaveis de ambiente ou, quando nao configuradas, por setup restrito a conexao local e a banco ainda sem usuarios; nao existe cadastro publico apos a primeira conta.

Todos os usuarios autenticados veem o menu Solicitações. O backend restringe usuarios de visualizacao as solicitacoes criadas por eles, independentemente dos parametros enviados pelo navegador. Aprovadores podem consultar todas as solicitacoes. Apenas aprovadores veem o menu Usuarios e podem acessar sua API; a pagina permite criar usuarios, redefinir senhas e atribuir/remover o perfil aprovador. Usuarios podem alterar os proprios dados de perfil e senha em Configuracoes, sem poder alterar o proprio perfil.

## Telas e comportamento

### Dashboard

Exibe tres indicadores:

1. Total de automacoes: contagem em `sustentacao.automacao_new` com `id_situacao IN (4, 5)`.
2. Rotinas processadas hoje: soma de `rotinas` em `sustentacao.tarefa_new` cuja data de `executar_apos` seja a data atual. A coluna e `timestamp without time zone`; validar a semantica operacional do fuso.
3. Total de erros: quantidade distinta de rotinas em estado de erro com ao menos uma solicitacao de alteracao, conforme a decisao acima.

### Rotinas

Mostra as rotinas da consulta-base, consolidando os dados encontrados nas tabelas de origem identificadas por schema e tabela. Colunas principais: `id_situacao` apresentado com a descricao de `sustentacao.situacao_rotina`; `id_agencia` apresentado com o nome de `dw.agencia_new`; `id_robo` apresentado com o nome de `sustentacao.robo_new`; `id_tarefa`, `primeira_tentativa`, `tentativas`, `inicio`, `fim`, `executar_apos`, `processo_num`, `etapa_execucao` e `obs`.

Uma acao de detalhes mostra todas as colunas e valores identificados na linha. O filtro de automacao usa `projeto_nome` de `sustentacao.automacao_new`. O filtro de status oferece primeiro Pendente, Processando e Erro, e tambem os demais status presentes em `sustentacao.situacao_rotina`. Ordenacao por `id_situacao` e `executar_apos` e validada no servidor. A lista e paginada em 10 itens.

O usuario pode editar uma ou mais linhas. A interface destaca os campos alterados e permite enviar apenas as linhas modificadas, individualmente ou em lote. O envio cria uma solicitacao pendente, sem gravar na tabela de origem.

### Automacoes e Robos

Exibem colunas e valores das tabelas `sustentacao.automacao_new` e `sustentacao.robo_new`, respectivamente, com paginacao de 10 itens. Alteracoes propostas seguem o mesmo fluxo de solicitacao e aprovacao usado pelas rotinas. A lista de colunas editaveis e validada com metadados e permissao efetiva do usuario de banco.

### Solicitacoes

Todos os usuarios autenticados podem abrir a tela. Usuarios de visualizacao veem apenas as solicitacoes que enviaram. Aprovadores veem todas as solicitacoes; o filtro padrao e Pendente e podem selecionar qualquer estado, incluindo Aprovado e Recusado. A lista e paginada em 10 itens e apresenta solicitante, automacao, identificador da rotina quando aplicavel, alteracoes propostas, data e estado.

Somente aprovadores podem aceitar ou recusar um lote. Na aprovacao, a API compara os valores atuais com o snapshot anterior e atualiza todos os itens do lote em uma transacao. Se algum item estiver desatualizado ou falhar na validacao, nenhuma alteracao do lote e gravada e a solicitacao permanece sem aprovacao aplicada, com o conflito registrado para revisao. O resultado e auditado. A autorizacao e aplicada no servidor: usuarios de visualizacao nao podem ampliar a consulta para incluir solicitacoes alheias nem executar acoes de aprovacao.

### Usuarios

Tela exclusiva para aprovadores, para criar contas, redefinir senhas e atribuir ou remover o perfil aprovador. Operacoes administrativas ficam auditadas. Nao ha remocao do ultimo aprovador ativo.

### Configuracoes

Permite ao usuario autenticado atualizar nome e senha. A senha atual e exigida para troca de senha. Alteracoes de perfil so podem ser feitas por um aprovador na tela Usuarios.

## Solicitacoes, concorrencia e auditoria

O envio de solicitacao nao altera o AGIS. A aprovacao valida novamente usuario, perfil, alvo, colunas, tipos e snapshot. Todas as escritas do lote ocorrem em uma transacao PostgreSQL; qualquer erro reverte o lote inteiro. A API grava ator, acao, instante, valores anteriores e novos valores no historico de auditoria em `gestao_rpa`.

A aplicacao nao executa SQL arbitrario. Consultas dinamicas limitam-se as tabelas registradas na consulta-base e as entidades explicitamente autorizadas (automacoes e robos). Uma aprovacao recusada atualiza apenas o estado da solicitacao e sua auditoria.

## Filtros, ordenacao e paginacao

Todas as listagens de rotinas, automacoes, robos, solicitacoes e usuarios aplicam filtros, ordenacao e paginacao no servidor; pagina padrao e de 10 itens. A API valida numero de pagina, tamanho permitido e campos de ordenacao. O dashboard usa agregacoes, nao uma listagem paginada.

## Entregas

1. Fundacao: inspecao do AGIS e permissoes do usuario `rpa`, migracoes de `gestao_rpa`, bootstrap do aprovador, autenticacao e estrutura da interface.
2. Rotinas: dashboard, consulta dinamica, joins de descricao, filtros, ordenacao, detalhes e paginacao.
3. Aprovacao: solicitacoes individuais e em lote, revisao por aprovador, escrita atomica, deteccao de conflito e auditoria.
4. Cadastros: automacoes, robos, usuarios e configuracoes; verificacao final de perfis e paginacao.

## Validacao

- Testes de autorizacao: viewer consulta somente as proprias solicitacoes e nao acessa endpoints de aprovacao nem administracao; aprovador consulta todas as solicitacoes e pode aprovar/recusar e administrar usuarios.
- Testes de consulta: paginacao de 10, filtros, ordenacoes permitidas, relacoes de descricao e contagens do dashboard.
- Testes de seguranca para identificadores dinamicos e parametrizacao de valores.
- Testes de solicitacao com uma linha e com multiplas linhas, incluindo recusa, aprovacao atomica e conflito por alteracao concorrente.
- Testes de integracao no PostgreSQL AGIS para confirmar nomes, tipos, chaves, timezone e privilegios de leitura/escrita/criacao em `gestao_rpa`.

## Dependencias a confirmar na inspecao do AGIS

- Existencia do database `agis` e acesso do usuario `rpa`.
- Nomes reais das colunas de chave primaria e campos editaveis em cada tabela de origem.
- Chaves e tipos dos relacionamentos para situacao, agencia e robo.
- Valores/descritivos exatos dos estados Pendente, Processando e Erro.
- Permissoes para escrever nas tabelas de origem e criar objetos em `gestao_rpa`.
- Tipo e fuso horario de `executar_apos` e semantica do contador de rotinas processadas.

## Resultado da inspecao inicial do AGIS

- Confirmado PostgreSQL 13.20, database `agis`, acesso pelo usuario `rpa`.
- As tabelas dinamicas observadas ficam no schema `rotina`, possuem chave primaria `id` e incluem todas as colunas padrao usadas na tela.
- Agencia: `dw.agencia_new.id` / `nome`; situacao: `sustentacao.situacao_rotina.id` / `descricao`; robo: `sustentacao.robo_new.id` / `nome`.
- Status encontrados: Pendente (1), Concluido (2), Erro (3), Devolvido (4), Reportado (5), Aguardando Outros (6), Processando (7).
- O usuario `rpa` pode criar schema e atualizar as tabelas dinamicas observadas, automacoes e robos. O schema `gestao_rpa` e as tabelas de suporte foram criados; o agrupamento de solicitacoes foi aplicado por migracao incremental.
- `rotina.tarefas_pendentes.executar_apos` e texto, enquanto `sustentacao.tarefa_new.executar_apos` e timestamp sem fuso.

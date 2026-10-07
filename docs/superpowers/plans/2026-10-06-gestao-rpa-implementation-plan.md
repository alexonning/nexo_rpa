# Plano de implementacao: Gestao RPA

## Ordem de execucao

1. **Inspecionar o PostgreSQL**
   - Preparar acesso Node ao PostgreSQL sem gravar credenciais no repositorio.
   - Confirmar database, tabelas, colunas, chaves, tipos, status, timezone e grants do usuario de aplicacao.
   - Mapear tabelas dinamicas retornadas pela consulta-base e validar identificadores/chaves.

2. **Estruturar a aplicacao**
   - Criar um projeto React + Node API, com configuracao local ignorada pelo Git e exemplo sem segredos.
   - Definir migracoes no schema `gestao_rpa`: usuarios, sessoes, solicitacoes, itens e auditoria.
   - Configurar uma conexao PostgreSQL compartilhada com limite maximo de uma conexao.

3. **Implementar seguranca e dominio**
   - Provisionar o primeiro aprovador por variaveis de ambiente; implementar login, sessao e perfis.
   - Implementar consultas paginadas (10 por pagina), filtros e ordenacao permitida no backend.
   - Implementar detalhe e edicao controlada de rotinas, automacoes e robos.
   - Implementar solicitacoes em lote; aprovacao atomica com comparacao do snapshot e auditoria; recusas sem escrita nas tabelas de origem.

4. **Implementar a interface**
   - Criar login e navegacao protegida por perfil.
   - Criar dashboard, rotinas, automacoes, robos, solicitacoes, usuarios e configuracoes.
   - Exibir solicitacoes proprias para viewers; aprovadores veem todas com filtro inicial Pendente.
   - Conectar filtros, paginacao, detalhes, edicao em lote e acoes de aprovacao a API.

5. **Validar e executar**
   - Testar regras de autorizacao, validacao de SQL dinamico, paginacao, solicitacoes e concorrencia.
   - Validar consultas e escrita no AGIS com os grants efetivamente disponiveis.
   - Rodar build/testes, corrigir erros da implementacao e iniciar o servidor local.

## Restricoes

- Nenhuma senha ou segredo deve ser incluído no codigo ou no controle de versao.
- A API nunca aceita schema, tabela ou coluna arbitrarios do navegador.
- Se as tabelas dinamicas nao tiverem chaves inequivocas ou grants de escrita, bloquear escrita e registrar a limitacao antes de alterar os dados.
- Manter os detalhes reais do catalogo do AGIS em configuracao/metadata e nao assumir nomes que ainda nao foram verificados.

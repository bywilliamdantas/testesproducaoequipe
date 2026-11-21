# Produção Parcial — versão final (21 etapas do roteiro)

## O que tem na pasta
| Arquivo | Para quê | Onde colocar |
|---|---|---|
| `Code.gs` | Back-end (Apps Script) | Apps Script > cole no lugar do atual > **Implantar > Gerenciar implantações > Editar > Nova versão** |
| `index.html`, `styles.css`, `app.js` | Front-end | Suba **os três juntos**, na mesma pasta do site (GitHub Pages) |
| `backup-original/` | Seus arquivos de antes da Etapa 1 | Guarde para voltar atrás ou para a auditoria |

A configuração (`URL_PADRAO`, `URL_CSV`, `AUTO_MIN`) está no topo do `app.js`, com a mesma URL de antes. O Modo TV tem o seu bloco `TV_CFG` logo abaixo.

## Ordem para publicar (importante)
1. Publique o **Code.gs** primeiro (nova versão). O front novo funciona com o Code.gs antigo, mas só mostra tudo com o novo.
2. Suba os 3 arquivos do front.
3. No editor do Apps Script rode `testarClassificacao` e `testarNiveis` (devem terminar com "todos os ... casos OK") e `testarCache` (a 2ª leitura deve vir do cache).
4. Opcional, aba **Config**: linhas `Inicio expediente` e `Fim expediente` (ex.: 08:00 e 18:00). Sem elas o painel usa 08:00 e 18:00 para a projeção do dia.

## O que mudou, etapa por etapa
| # | Etapa | Resultado | Onde |
|---|---|---|---|
| 1 | Selo "Em atraso" | Play (executando e agendado) e Backlog, supervisor e técnico; tem texto e ícone | Code.gs `lerAbertos` (campos `atr`, `pz`); `seloAtraso()` |
| 2 | Concluídos hoje (Backlog) | KPI clicável (mouse, Enter, Espaço); chips de empresa, busca, lista por técnico | Code.gs `concluidosHojeDetalhe`; `abrirConcluidosHoje()` |
| 3 | Limpeza | URL antiga, 39 regras de CSS sem uso, `corSup`/`MATIZES`, 3 ícones sem uso, rodapé único (template). `dlgCodigo` mantido. Fontes: as duas ficam (IBM Plex é reserva na pilha) | |
| 4 | 3 arquivos | `index.html` + `styles.css` + `app.js`, mesma ordem de antes, tela idêntica | |
| 5 | CSS consolidado | 11 seções; 641 linhas viraram 1.327 (reformatado, uma regra por linha). Removidas 122 declarações que nunca valiam (mesmo seletor e propriedade, regra posterior sempre vence). 27 regras mudaram de seção para não alterar a cascata. Estilo calculado de todos os elementos conferido em 48 estados: idêntico | |
| 6 | Regras no servidor | `classificarOS`, `calcularNivel`, `nivelDia` no Code.gs; o front só recalcula se o Code.gs for o antigo. Testes `testarClassificacao` (12 casos) e `testarNiveis` (21 casos) | |
| 7 | Cache no servidor | CacheService só dos dados brutos, em pedaços de 30 mil caracteres, chave com o carimbo do Sincronismo, TTL 60 s (usuários/config/metas: 5 min). `limparCache()` e `testarCache()` | |
| 8 | Detalhes sob demanda | `leve=1`; ações `detalhe`, `os`, `concluidosHoje`; "Carregando..." com erro e "Tentar de novo" | |
| 9 | Cache local | Última resposta por usuário e filtro, "Dados de HH:MM, atualizando...", "dados de há X min", apaga ao sair, puxar para atualizar, aviso offline | |
| 10 | Ordenar pelo cabeçalho, vazios com ação, busca com destaque | Setinha, sincronizado com o menu; botões "Limpar busca e filtros" / "Limpar filtros"; destaque com `<mark>` sem innerHTML | |
| 11 | Ranking e equipes | Medalhas (empate = mesma medalha) e linha por equipe com Ativos, Concl., Meta e Gap, recolhível; KPIs somam tudo | |
| 12 | Gráfico por dia | SVG no diálogo do técnico, cores de nível, linhas Meta I a IV, toque mostra data e valor | |
| 13 | Comparativo e projeção | "+12% vs ontem" (toque alterna para a semana passada); projeção linear no técnico e em Mais detalhes | |
| 14 | Exportar e compartilhar | CSV (`;`, BOM, vírgula decimal) da Produção e do Backlog; imprimir/PDF em preto sobre branco; "Copiar resumo" + compartilhar | |
| 15 | Backlog por técnico | Bloco com "Sem técnico", filtro cruzado, "Ver todos"; some no perfil técnico | |
| 16 | Alertas | Faixa vermelha com a sincronização acima de 60 min; chip "Vencem em 4h"; contador no título da aba; notificação só se você aceitar | |
| 17 | Acessibilidade | Contraste, símbolo do nível (▼ ● ✔ ▲) e nível por extenso, tabela com roles corretos (nome do técnico é o botão), foco no título e retorno do foco, alvos de 44 px, animações só no que está ao vivo | |
| 18 | Tema claro | Todas as cores viraram variáveis; alternador Automático/Claro/Escuro (sol/lua); aplicado antes de pintar; escuro idêntico ao anterior | |
| 19 | Barra inferior | Até 520 px: Produção, Backlog e Filtros; some com diálogo ou teclado abertos; respeita a área segura | |
| 20 | Modo TV | Sem login na URL; relógio e "Atualizado em"; escala 1,4x; tela cheia; rotação a cada 30 s; rolagem automática; sai com Esc ou toque longo no canto superior direito e volta à tela e aos filtros de antes | |
| 21 | Auditoria | Veja abaixo | |

## Etapa 21: auditoria final
**Dados preservados** (original x final, mesmos dados simulados, celular e desktop): Reab. Inst., Reab. Pend., Instalação, Pendência, Concluídos, Play (4 estados), Meta/Gap, Ativos, Mais detalhes, filtros, cartões de empresa, 6 KPIs, chips, tipo, status, tempo de atraso, cidade, comparativo por empresa, lista e detalhe da OS (ligar, WhatsApp, mapa): **sem perda**. As únicas diferenças são os itens novos (medalha, "Exportar CSV", selo "Em atraso").
**Código:** sem erro no console; todo id usado no JS existe no HTML; nenhuma função definida e nunca chamada; `Code.gs` e `app.js` passam na checagem de sintaxe; 50 testes do servidor passam (resultado igual ao Code.gs original em todos os períodos e perfis, fora os campos novos).
**Compatibilidade:** front novo + Code.gs antigo funciona (sem comparativo, sem projeção, sem clique em Concluídos hoje, listas completas); Code.gs novo + front antigo também.
**Contraste:** ajustes no tema escuro: `#6b7da3`→`#7f93b8`, `#5d6c8c`→`#8396ba`, vermelho do chip `#ff4a55`→`#ff7a84`, botões azuis `#2f7bff`→`#1f63e6`, botão laranja do login clareado/escurecido para 4,5:1. Restam só 2 avisos que são falsos positivos (dias do calendário desabilitados) e KPIs coloridos no tema claro, conferidos a olho.

### Mudanças extras que você não pediu (pequenas, para o roteiro funcionar)
- `resolverUrl()` não faz mais um pedido extra ao Apps Script quando `URL_CSV` é igual a `URL_PADRAO` (era uma chamada a mais por requisição).
- `concluidosHojeItens` traz também `status: "Concluído"` para o cartão ficar igual ao dos Concluídos da Produção.
- Comparativo: cada técnico leva `cmpOntem`/`cmpSemana`, para a soma respeitar busca e equipes selecionadas.

### Riscos e o que NÃO consegui testar
- **Não testei com a sua planilha real nem no Apps Script de verdade.** Usei um simulador (50 testes) e navegador automatizado com dados fictícios. Faça o checklist abaixo com o seu login.
- Leitor de tela (TalkBack, VoiceOver, NVDA), notificações do navegador, tela cheia e rotação por 10 minutos em TV real: só dá para validar no aparelho.
- Cache do servidor: trocar senha ou meta demora até 5 minutos para valer (rode `limparCache()` para forçar).
- `color-mix` (KPIs do tema claro) pede navegador de 2023 em diante; em navegador antigo cai numa cor sólida escura.
- Medalhas: empate recebe a mesma medalha e a seguinte pula (1º, 1º, 3º). Se preferir sem pular, é uma linha em `medalhas()`.
- Projeção usa o relógio de Fortaleza do aparelho; aparece só depois de 1 h de expediente e antes do fim.

## Checklist rápido para você (nos 3 perfis: técnico, supervisor, coordenador)
1. Login, Sair e código de acesso (se ativo na aba Config).
2. Produção: KPIs, linhas, Play e Concluídos (cartões), Mais detalhes, todos os períodos e o calendário.
3. Backlog: cartões de empresa, KPIs, chips, tipo, status, atraso, cidade, comparativo, lista e detalhe da OS.
4. Selo "Em atraso", Concluídos hoje, "Por técnico", "Vencem em 4h", exportar CSV, tema claro, barra inferior no celular, Modo TV.

Fora deste roteiro, para depois: segurança (POST ou token, hash de senha, limite de tentativas, remover `LOGIN_TESTE`, filtro de equipe no servidor) e PWA.


---

# Novidades desta versão (pedido de 21/11/2026)

| Pedido | Resultado | Onde |
|---|---|---|
| Selo "Em atraso" ao lado do status (supervisor e técnico) | **Já estava nesta versão** (Etapa 1) e foi conferido: cartões do Play/agenda, lista e detalhe da OS do Backlog. Não foi alterado. | `seloAtraso()` |
| "Concluídos hoje" clicável no Backlog | **Já estava** (Etapa 2) e foi conferido. Não foi alterado. | `abrirConcluidosHoje()` |
| Atrasadas em Play x fora do Play (Backlog) | Dois chips novos: **Atrasadas em play** e **Atrasadas fora do play**, com contagem e filtro (respeitam empresa, supervisor e busca). | `blChips()`, `BLP.sit` |
| Prioridades | Nova aba **Prioridades** lida pelo `Code.gs`. OS marcada com selo violeta "Prioridade" no Backlog, no Play/agenda do técnico e nos concluídos; estrela com a quantidade na linha do técnico; bloco **Prioridades** no Backlog (pendentes, em atraso, atendidas hoje, 30 dias, atendidas por dia nos últimos 7 dias, lista); e linhas em "Mais detalhes" e no detalhe do técnico. | `lerPrioridades`, `situacaoPrioridades`, `blPrio()` |
| Aba Controlador | Novo perfil **controlador**: vê só a equipe do supervisor indicado (filtrado no servidor) e o **backlog geral**. | `autenticar`, `montar` |
| Detalhamento do técnico e do supervisor | Detalhe do técnico: bloco **Metas** com todas as metas (atingida ou quanto falta), barra, faixa atual e próxima; play, atrasadas e prioridades da agenda. "Mais detalhes": quantos técnicos em cada meta. | `blocoMetas()` |

## Regras das prioridades
- Cada linha da aba Prioridades é um pedido. O protocolo (só os dígitos) é cruzado com `protocolo_novo` (Base_Abertos) e `Código` (encerramentos). Mais de um pedido para a mesma OS conta como **uma** prioridade.
- **Pendente**: a OS ainda está na Base_Abertos. **Atendida**: tem ENCERRAMENTO no dia do primeiro pedido ou depois (conta no dia do encerramento). **Cancelada**: só tem CANCELADO. **Sem registro**: não está em nenhuma base (ex.: `#N/A`).
- Cabeçalho: a linha com "SOLICITANTE" (nas 15 primeiras linhas); a coluna do protocolo pode ficar sem título. "DT REQUIS." pode estar na linha de cima.
- **Atenção:** o histórico vem da própria aba. Se pedidos encerrados forem apagados dela, deixam de ser contados como atendidos.
- A tela mostra atendidas dos últimos 30 dias. Sem a aba Prioridades, nada some: só não aparecem as marcas.

## Aba Controlador
Colunas: Controlador | Supervisor | Login | Senha | Ativo. O nome em "Supervisor" precisa ser igual ao da aba Técnicos (acento e maiúsculas não importam). Quem está sem login/senha não consegue entrar.

## Para publicar
1. Cole o novo `Code.gs` e publique **nova versão** da implantação. 2. Suba `index.html`, `styles.css` e `app.js` juntos. 3. Rode `testarPrioridades` e `testarControlador` no editor. 4. `limparCache()` se quiser ver mudanças de planilha na hora.

Testado com simulador (dados fictícios + os pedidos reais da planilha) e navegador automatizado. **Não testado no Apps Script real nem com a sua planilha completa.**

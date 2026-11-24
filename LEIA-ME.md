# Configurações dentro do painel (etapas 1 a 6 do roteiro de configurações)

Coordenador e supervisor ganharam o item **Configurações** no menu de 3 barrinhas (logo abaixo de "Quem está logado"). Nada da Produção, do Backlog, do login, das metas ou da classificação das OS foi alterado: no Code.gs, a única linha antiga que mudou foi o retorno do login (agora traz também o token).

## Como publicar (nesta ordem)
1. **Code.gs primeiro**: cole no Apps Script, salve e **Implantar > Gerenciar implantações > Editar (lápis) > Nova versão > Implantar** (mesmo link /exec). Sem nova versão o painel novo não consegue gravar.
2. Rode no editor `testarPermissoes`, `testarLog` e `testarEnvio` (não leem nem gravam a planilha real). Todos devem terminar em "todos os N casos OK".
3. Depois publique os 3 arquivos do site: `index.html`, `styles.css`, `app.js`. Dê Ctrl+F5 para limpar o cache.
4. A implantação precisa continuar com acesso "Qualquer pessoa" (como já era). Na primeira gravação o Google pode pedir autorização (CacheService, LockService e planilha): aceite.

## O que mudou
- **Etapa 1, base segura (Code.gs)**: login devolve um token (CacheService, 6 h); as gravações entram por `doPost` (JSON); permissão conferida no servidor a cada ação (coordenador: tudo; supervisor: só técnicos e controladores da própria equipe, sem Metas/Config; técnico e controlador: nada); `LockService` em toda gravação; conferência da versão da linha (se a linha mudou na planilha desde que a tela a carregou, recusa e pede para recarregar); aba **Log_Alterações** (data/hora, login, perfil, ação, aba, chave da linha, valor antigo e novo; senha e código de acesso nunca vão para o log); `limparCache()` depois de gravar; backup em aba oculta `Backup_<aba>` (só o último de cada aba) com restauração; erros em português.
- **Etapa 2, cadastros**: abas Técnicos, Controladores, Supervisores e Coordenadores com busca, filtro Ativos/Inativos/Todos, Adicionar, Editar e Ativar/Desativar (desativar grava `Ativo = NÃO`; nada é apagado). Supervisor e Tipo são escolhidos em lista; login único entre as 4 abas; sem espaços no login; nome obrigatório (e único na aba). Senhas mascaradas com botão de mostrar; supervisor vê e redefine as da própria equipe. Só as células alteradas são gravadas: colunas extras e fórmulas ficam como estão.
- **Etapa 3, Metas e Config (só coordenador)**: Metas com vírgula decimal e validação I ≤ II ≤ III ≤ IV, adicionar tipo, remover tipo (avisa quantos técnicos usam; faz backup). Config com validação de números e HH:MM; linhas desconhecidas da aba não são tocadas; mudar o código de acesso pede confirmação.
- **Etapa 4, Enviar dados**: Encerramentos, Encerramentos_Hoje e Base_Abertos, em .xlsx, .xls ou .csv, lidos no navegador (SheetJS 0.18.5 do cdnjs, carregado só quando se escolhe um .xlsx/.xls). Colunas casadas pelo NOME, em qualquer ordem; faltou obrigatória = bloqueia; sobrando = ignora e avisa. Modos: substituir tudo, acrescentar sem duplicar e (só Encerramentos_Hoje e Base_Abertos) mesclar. Protocolo comparado só pelos dígitos; notação científica ou sem dígitos não entra; repetido no arquivo entra a primeira; já existente na aba mantém a da planilha. Prévia obrigatória, alerta forte com digitação do nome da aba, lotes numa aba temporária oculta (a aba verdadeira só muda no final, com backup, e se a gravação falhar o backup volta sozinho), "Desfazer último envio", relatório com CSV das ignoradas/inválidas, carimbo do Sincronismo (Base_Abertos A2, Encerramentos_Hoje B2, Encerramentos C2; nenhuma outra célula).
- **Etapa 5, Escala e Prioridades**: Prioridades só adiciona e edita (não existe apagar); protocolo só dígitos (8 ou mais). Escala_FDS: escolhe a data e troca o código de cada pessoa, só com códigos que a aba já usa; nova pessoa precisa existir na aba Técnicos; supervisor só vê e edita a própria equipe. Backup antes de cada gravação, com "Restaurar último backup" (coordenador).

## Decisões que tomei (confira se concordam)
- Para o conteúdo da aba, **a coluna de destino manda**: se a coluna guarda número/data de verdade, o envio grava número/data; se guarda texto, grava texto. Protocolo de coluna numérica vira número só quando é seguro (sem zero à esquerda, até 15 dígitos); senão fica texto.
- **Colunas com fórmula na linha 2** da aba de destino não recebem valores do arquivo; a fórmula é repetida nas linhas novas. (Você deixou em branco o campo "[PREENCHER]" do prompt 4, então tratei os dois casos: com e sem fórmula.)
- Tipo de uma meta existente não pode ser renomeado pela tela (os técnicos perderiam a meta); remova e crie outro, ou mude também a coluna Tipo em Técnicos.
- Alerta forte (digitar o nome da aba) também vale para a mesclagem que remove mais da metade das linhas, e um envio sem nenhuma linha válida nunca esvazia a aba.
- Desfazer envio devolve também o carimbo antigo da célula do Sincronismo daquela aba.
- Limite de 100 mil linhas por arquivo (constante `ENVIO_MAX_LINHAS`).

## Riscos conhecidos
- **O Google Sheets converte textos que parecem número/data** ao gravar; o código formata como texto só as células necessárias, mas confira os zeros à esquerda e as datas no primeiro envio real.
- Edição **simultânea**: a trava e a versão da linha evitam sobrescrever, mas quem estiver com a tela aberta recebe "recarregue" ao salvar uma linha que mudou. Isso é proposital.
- **Desfazer** restaura a aba inteira como estava antes do envio: o que alguém digitou direto na aba depois do envio se perde. Só existe 1 backup por aba (o último).
- Fórmulas só são preservadas se estiverem na **linha 2** e forem iguais para todas as linhas daquela coluna.
- A senha aparece na tela para coordenador e supervisor (pedido seu) e trafega no corpo do POST (HTTPS). O login do site continua sendo feito como antes.
- Sessão dura até 6 h; depois o painel entra de novo sozinho com as credenciais guardadas.
- A aba **Sincronismo** precisa existir; se não existir, o envio grava os dados e avisa que não carimbou.
- Aba de log e abas Backup_/Temp_Envio_ ficam na planilha (Backup_ e Temp_ ocultas). Não renomeie nem apague o cabeçalho das abas.

## Checklist de teste (numa CÓPIA da planilha)
1. **Perfis**: entre como coordenador (vê 9 abas), supervisor (vê Técnicos, Controladores, Enviar dados, Escala, Prioridades e só a própria equipe) e técnico/controlador (nem aparece "Configurações"). Como supervisor, confirme que não aparece pessoa de outra equipe.
2. **Cadastros** (cada um dos 4): adicionar, editar, desativar e reativar; login repetido (inclusive igual ao de outra aba, com maiúscula diferente); login com espaço; nome vazio; supervisor inexistente. Veja na planilha: colunas extras e fórmulas da linha continuaram iguais e a senha com zero à esquerda (ex.: 00789) ficou como texto. Entre com o login novo.
3. **Metas**: vírgula decimal, I > II (deve recusar), campo vazio, tipo repetido, adicionar tipo, remover tipo em uso (deve avisar quantos técnicos), restaurar último backup.
4. **Config**: horário 25:00, gap 7, número inválido; mudar o código de acesso (confirmação e novo código passa a valer); conferir que linhas extras da aba continuam lá.
5. **Envio, cada aba x cada modo**: Encerramentos (acrescentar e substituir), Encerramentos_Hoje e Base_Abertos (substituir, acrescentar com o aviso, mesclar). Confira prévia, contagens, relatório, CSV baixado e o carimbo (A2/B2/C2 só da aba enviada).
6. **Arquivo com protocolos duplicados** (repetidos no arquivo e já existentes na aba), com protocolo em notação científica (1,23E+10), com zeros à esquerda, e colunas em ordem diferente com uma coluna a mais.
7. **Arquivo com coluna obrigatória faltando**: deve bloquear com aviso.
8. **Arquivo pequeno demais** no modo substituir (menos da metade das linhas): precisa pedir o nome da aba; cancele e confira que nada mudou.
9. **Cancelar no meio** e **fechar a aba do navegador no meio** de um envio grande: a aba verdadeira deve continuar intacta.
10. **Desfazer último envio**: conteúdo e carimbo voltam.
11. **Edição direto na planilha logo depois de salvar pelo sistema**: salve um cadastro, edite outra coluna da mesma linha direto na planilha, volte à tela sem recarregar e tente salvar: deve avisar para recarregar. Depois recarregue e salve: deve funcionar.
12. **Prioridades**: protocolo com letras (recusa), adicionar, editar, e confirmar que não existe apagar. **Escala**: trocar o código de alguém numa data e conferir na aba.
13. Conferir que **Produção e Backlog** mostram os mesmos números de antes (compare com uma captura anterior).
14. Celular: tudo acima (cartões, botões de 44 px, envio de arquivo pelo celular).
15. Abra a aba **Log_Alterações** e confira que nenhuma senha nem código de acesso aparece.

---

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

---

# Novidades (escala, login e acessos)

| Pedido | Resultado | Onde |
|---|---|---|
| Aba **Escala_FDS** | Em **Filtros**, o campo "Escala e extra (fim de semana / feriado)" lista as datas da aba. Ao escolher uma data, a produção vai para esse dia e a tela mostra só quem está de **ESCALA** (selo azul) ou **EXTRA** (selo violeta), com o código da célula no detalhe do técnico e as contagens em "Mais detalhes". Disponível para supervisor, coordenador e controlador (o controlador continua só com a equipe dele). Técnico não vê o filtro. | `lerEscala`, `escOpcoes()` |
| Botão do login | "Salvar credenciais" virou **Salvar**. | `index.html` |
| Quem está logado | Ícone de pessoas no topo (só supervisor e coordenador): **online agora** e **último acesso** de técnicos e controladores, com filtros. Supervisor vê a própria equipe; coordenador vê todos. Atualiza sozinho a cada 30 s. | `acaoAcessos`, `acDesenhar()` |

## Regras da escala (ajuste em `tipoEscala` / `ESC_FERIADO_PCT` no Code.gs se precisar)
- Cabeçalho: a linha com **COLABORADOR**; as colunas seguintes são as datas (data real ou texto `1/nov.`).
- Célula com **EXTRA** = extra (qualquer dia). **TRA** = escala, mas só em sábado, domingo ou feriado (dia útil com 30% ou mais de células "F." na coluna). **FOL**, **F. ESCALAVEL**, **F. OBRIGATORIA** = folga; **FÉRIAS** não aparece.
- Entendi "F." como folga. Se for feriado trabalhado, me avise para trocar a regra.
- O nome do colaborador precisa ser igual ao da aba Técnicos (acento e maiúsculas não importam).

## Regras dos acessos
- Cada chamada autenticada grava o horário (PropertiesService, no máximo 1 vez por 45 s). A tela aberta e visível avisa a cada 90 s. **Online** = atividade nos últimos 4 minutos. "Sair" marca offline na hora; fechar a aba só cai para offline em até 4 min.
- Aparecem só técnicos e controladores **ativos e com login e senha**.
- Na primeira publicação todos aparecem como "Nunca acessou" até entrarem.

---

# Novidades (menu, login e limpeza)
- **Ranking removido:** sumiram as medalhas 1º/2º/3º ao lado do nome do técnico.
- **Faixa vermelha "Dados sem atualizar há..." e chip "Dados de HH:MM, atualizando..." removidos** (Produção e Backlog).
- **Menu de 3 barrinhas** no canto superior direito, igual na Produção e no Backlog, mesma cor e ordem: Atualizar dados, Quem está logado (supervisor/coordenador), Modo TV, Tema, [Filtrar por supervisor, só no Backlog], Backlog ou Produção, Sair. No celular, Backlog/Produção ficam só na barra inferior (como antes).
- **Login repaginado** conforme o modelo: duas colunas no desktop, uma coluna no celular. Campos sem texto interno; "Manter conectado" (igual ao botão Salvar); "Esqueceu sua senha?" orienta procurar o supervisor responsável para redefinir senha ou usuário.

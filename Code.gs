/**
 * PRODUÇÃO EQUIPE - Web App (Apps Script)
 * Contagem equivalente às fórmulas CONT.SES da planilha:
 *   Reab. Inst. = Atendente + Status=ENCERRAMENTO + Tipo Solicitação contém "INSTALAÇÃO FIBRA" + Reabertura=1
 *   Reab. Pend. = Atendente + Status=ENCERRAMENTO + Tipo Solicitação NÃO contém "INSTALAÇÃO FIBRA" + Reabertura=1
 *   Instalação  = Atendente + Status=ENCERRAMENTO + Tipo Solicitação contém "INSTALAÇÃO FIBRA"
 *   Pendência   = Atendente + Status=ENCERRAMENTO + Tipo Solicitação NÃO contém "INSTALAÇÃO FIBRA" nem Prestação de contas / Combustível, e sem Reabertura
 *   Concluídos  = Atendente + Status=ENCERRAMENTO + Tipo Solicitação NÃO contém "PRESTAÇÃO DE CONTAS" nem "COMBUSTÍVEL" (liberação de combustível)
 *   Reabertura (Reabertura=1) NÃO entra em Instalação, Pendência, Prest. de contas, Concluídos nem em atraso:
 *   o valor fica visível apenas nas colunas Reab. Inst. / Reab. Pend. (serviço que já tinha sido feito antes).
 *
 * O texto do tipo é normalizado antes de comparar (sem acento, maiúsculas, e espaço
 * não separável / hífen / espaço duplo viram um espaço só). Isso evita que pequenas
 * diferenças de formatação (comuns em Encerramentos_Hoje) joguem instalações em Pendência.
 *
 * As colunas são localizadas pelo NOME do cabeçalho (linha 1 de cada aba),
 * então não dependem de letras (AC, BG...) nem da ordem.
 *
 * DE ONDE VÊM OS DADOS (por filtro):
 *   Hoje                          -> somente a aba Encerramentos_Hoje (sem filtro de data)
 *   Ontem / Último dia com dados  -> somente a aba Encerramentos
 *   Mês, 7 dias, Personalizado,
 *   Todo o período                -> Encerramentos + Encerramentos_Hoje
 *
 * Produção mensal (calendário): periodo=cal + dias=aaaa-mm-dd,... + meses=aaaa-mm,...
 *   Usa as duas abas. Mês inteiro vale até hoje; a meta é por dia selecionado.
 *
 * Se a mesma OS (coluna Código) existir nas duas abas, vale a linha de Encerramentos_Hoje
 * e a da base é descartada, para não contar duas vezes.
 *
 * PLAY (aba Base_Abertos):
 *   Lista as solicitações ainda não atendidas. Colunas lidas pelo cabeçalho:
 *   responsavel, em_play (Sim/Não), tipo_solicitacao, protocolo_novo, nome_cliente, cidade.
 *   Por técnico (cruza com a aba Técnicos pelo nome em "responsavel"):
 *     play   = tem ao menos uma OS com em_play = Sim            (▶ em execução)
 *     parado = tem OS na base, mas nenhuma em play              (■ agendado, não iniciou)
 *     fim    = nada agendado, mas já encerrou ao menos uma OS   (⏳ ampulheta: terminou a agenda)
 *     vazio  = nada agendado E nenhuma OS encerrada             (👻 fantasma: sem atividade)
 *     na     = a aba Base_Abertos não existe / cabeçalho não reconhecido
 *   Cada item (OS) traz: tipo, protocolo, cliente, cidade, bairro, status (status_solicitacao), emp (empresa, mesma regra do Backlog),
 *   atr (1 = em atraso, coluna em_atraso) e pz (data_prazo em milissegundos).
 *   CONCLUÍDOS (conclItens): lista das OS concluídas de cada técnico no período, com cliente/cidade/bairro lidos pelo cabeçalho
 *   da aba de encerramentos (Cliente, Cidade, Bairro; se o nome for outro, qualquer cabeçalho que contenha a palavra).
 *   "Encerrou" (campo produziu) = qualquer ENCERRAMENTO no período (concluídos, prestação de contas ou reabertura).
 *   TÉCNICO ATIVO (campo ativo, usado na contagem do painel e na meta/Gap):
 *     Hoje      -> tem OS agendada (Base_Abertos) OU já encerrou alguma OS hoje
 *     Demais    -> encerrou ao menos uma OS no período
 *     Assim técnico ausente não precisa ser desativado na aba Técnicos para não pesar na contagem.
 *
 * LOGIN / PERFIS (abas Técnicos, Supervisor e Coordenador):
 *   Técnicos    : Técnico | Supervisor  | Login | Senha | Ativo
 *   Supervisor  : Supervisor | Coordenador | Login | Senha | Ativo
 *   Coordenador : Coordenador | CEO | Login | Senha | Ativo
 *   Controlador : Controlador | Supervisor   | Login | Senha | Ativo   (o "Supervisor" é a equipe do controlador)
 *   Toda chamada (doGet) precisa de login + senha. O servidor valida e já devolve só o que o perfil pode ver:
 *     tecnico     -> só a própria produção e só as OS abertas em que ele é o responsável (agenda dele)
 *     controlador -> produção só da equipe do supervisor indicado na aba Controlador + backlog geral
 *     supervisor  -> produção de todas as equipes (o filtro do painel começa na equipe dele) + backlog geral
 *     coordenador -> produção de todas as equipes + backlog geral
 *   Ativo = NÃO bloqueia o login e tira a pessoa das listas. Vazio conta como ativo.
 *
 * ESCALA (aba Escala_FDS): linha com "COLABORADOR" = cabeçalho; a partir da coluna seguinte, uma coluna por data (aceita data real ou texto "1/nov.").
 *   Código da célula: contém EXTRA = extra · TRA (ou TRABALHO / ESCALA) = trabalha · FOL ou "F. ..." = folga · FÉRIAS.
 *   Dia de escala = sábado, domingo ou feriado (dia útil com 30% ou mais de "F." na coluna). Nesses dias, TRA = técnico de ESCALA.
 *   EXTRA conta em qualquer dia. O filtro (parâmetro escala=aaaa-mm-dd) mostra só quem está de escala ou extra na data.
 *
 * ACESSOS (quem está logado): cada chamada autenticada grava o horário do usuário (PropertiesService, no máx. 1 vez por 45 s).
 *   Online = atividade há até 4 minutos. Supervisor vê a própria equipe e controladores; coordenador vê tudo (acao=acessos).
 *
 * PRIORIDADES (aba Prioridades: uma linha por pedido de prioridade; a mesma OS pode ter mais de um pedido):
 *   Colunas lidas pelo cabeçalho (a linha de cabeçalho é a que tem "SOLICITANTE", em qualquer uma das 15 primeiras linhas):
 *   protocolo (coluna sem título com números de 8+ dígitos, ou título "Protocolo"), SOLICITANTE, SETOR SOLICITANTE, JUSTIFICATIVA,
 *   RELATO JUSTIFICATIVA PRIORIDADE e DT REQUIS. (a data pode estar numa linha acima do título).
 *   Regra de identificação: o protocolo (só os dígitos) igual a protocolo_novo da Base_Abertos ou a Código dos encerramentos.
 *     pendente    = a OS ainda está na Base_Abertos (backlog / agenda do técnico)
 *     atendida    = a OS tem ENCERRAMENTO em Encerramentos / Encerramentos_Hoje no dia da solicitação ou depois (conta no dia do encerramento)
 *     cancelada   = só tem CANCELADO nas abas de encerramento
 *     sem registro= não está na Base_Abertos nem nas abas de encerramento (ex.: #N/A na planilha de pedidos)
 *   Importante: pedidos que forem apagados da aba Prioridades deixam de ser contados (o histórico vem da própria aba).
 *
 * METAS POR TIPO DE TÉCNICO (aba Metas + coluna Tipo da aba Técnicos):
 *   Tipo (Condominio / Instalador / Misto) define a meta diária de concluídas: Meta I a Meta IV.
 *   Dia produzido = dia em que o técnico encerrou ao menos uma OS. O GAP usa só os dias produzidos
 *   (no filtro Hoje, o técnico ativo conta 1 dia). Faixa de referência do GAP: Config > "Meta do gap (1 a 4)" (padrão 1 = Meta I).
 *   Técnico sem Tipo (ou Tipo que não está na aba Metas) usa Config > "Meta padrao (por dia)" (padrão 5).
 *
 * SINCRONISMO:
 *   Aba "Sincronismo" -> B2 = data/hora da última atualização de Encerramentos_Hoje
 *                        C2 = data/hora da última atualização de Encerramentos
 *                        A2 =  data/hora da última atualização de Base_Abertos (usada na página Backlog)
 *   O front usa B2 para exibir "última sincronização" e para colorir o alerta de Produção de Hoje
 *   (até 30 min verde, 31 a 60 min laranja, acima de 60 min vermelho).
 *
 * BACKLOG (página nova, chamada com ?pagina=backlog):
 *   Lê TODA a aba Base_Abertos (uma linha = uma OS aberta) e devolve as OS já classificadas:
 *     empresa   = prefixo do tipo (JEBNET - / DNET - / GIGANET - / EMX -); se não tiver, olha equipe_solicitacao
 *                 e cat_1; sem nenhum dos dois = INFOLINK
 *     categoria = Pendências, Instalações, Transferências, Retrabalhos, Serviço, Reativação, Troca de roteador,
 *                 Repetidor ou Outros (tudo que não se encaixa nas anteriores)
 *     atrasada  = coluna em_atraso = Sim
 *     em play   = coluna em_play = Sim
 *     na fila   = responsavel vazio ou "AGENDAMENTO ..." / "ROTEIRIZADOR ..." (ainda sem técnico definido)
 *   Só entram as OS da equipe "Gestão de OS" (coluna equipe_solicitacao, a AD): Infraestrutura, Faturamento etc. ficam de fora.
 *   Os totais e gráficos são montados no próprio navegador a partir dessa lista.
 *   Colunas lidas pelo cabeçalho (as que faltarem apenas ficam vazias): protocolo_novo, nome_cliente, numero_1,
 *   numero_2, cidade, bairro, rua, numero_casa, latitude, longitude, tipo_solicitacao, status_solicitacao,
 *   data_abertura, data_prazo, em_atraso, responsavel, em_play, cat_1..cat_5, atendente_origem,
 *   descricao_abertura, protocolo_os_original, equipe_solicitacao.
 *
 * GRAVAÇÃO (configurações, cadastros, Metas, Config, envio de arquivos, Escala e Prioridades): ver o bloco "GRAVAÇÃO SEGURA NO SERVIDOR" mais abaixo (doPost).
 */

const ABA_BASE = 'Encerramentos';
const ABA_HOJE = 'Encerramentos_Hoje';
const ABA_TEC = 'Técnicos';
const ABA_CFG = 'Config';
const ABA_SINC = 'Sincronismo';
const ABA_ABERTOS = 'Base_Abertos';
const ABA_SUP = 'Supervisor';
const ABA_COORD = 'Coordenador';
const ABA_CONTR = 'Controlador';    // Controlador | Supervisor | Login | Senha | Ativo
const ABA_ESC = 'Escala_FDS';        // escala de fim de semana / feriado e extras (ver o bloco ESCALA no topo)
const ABA_PRIO = 'Prioridades';     // pedidos de prioridade (ver o bloco PRIORIDADES no topo)
const ACESSO_ON_MS = 4 * 60000;     // online = última atividade há no máximo 4 minutos (a tela avisa a cada 90 s)
const ESC_FERIADO_PCT = 0.3;        // dia útil com 30% ou mais de "F." (folga/feriado) na escala conta como feriado
const LIMITE_PRIO_DIAS = 30;        // dias de prioridades atendidas enviadas para a tela
const LIMITE_PRIO_LISTA = 600;      // máx. de OS atendidas / sem registro detalhadas na resposta
const ABA_METAS = 'Metas';          // Tipo | Meta I | Meta II | Meta III | Meta IV  (meta diária de concluídas por tipo de técnico)
// Tipos de OS que SEMPRE contam como concluídos (Pendência), mesmo que a coluna Reabertura venha = 1.
// Comparação por "contém", sem acento. Para desligar a regra, deixe a lista vazia: [].
const TIPOS_SEMPRE_CONTAM = ['REPETIDOR'];   // ex.: TROCA DE ULTRA REPETIDOR
const LIMITE_CONCL_ITENS = 400;   // máx. de OS concluídas detalhadas por técnico (evita resposta gigante em "Todo o período")
const CACHE_TTL_DADOS = 60;       // segundos: dados brutos das abas de encerramentos e abertos (a chave também leva o carimbo da aba Sincronismo)
const CACHE_TTL_CFG = 300;        // segundos: usuários, configuração e metas
const CACHE_PARTE = 30000;        // caracteres por pedaço (o CacheService aceita ~100 KB por chave; 30 mil caracteres ficam abaixo disso mesmo com acentos)
const CACHE_MAX_PARTES = 40;      // acima disso o dado não é guardado em cache (lê direto da planilha)

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    _SINC = null;
    const acao = String(p.acao || '');
    if (acao === 'login') return json(fazerLogin(p));
    if (acao === 'ping') return json(acaoPing(p));                // batimento da tela aberta (presença)
    if (acao === 'sair') return json(acaoSair(p));
    if (acao === 'acessos') return json(acaoAcessos(p));          // quem está logado / último acesso (supervisor e coordenador)
    if (acao === 'detalhe') return json(acaoDetalhe(p));          // lista de OS de um técnico (concl | play | agenda)
    if (acao === 'os') return json(acaoOS(p));                    // descrição de abertura de uma OS do Backlog
    if (acao === 'concluidosHoje') return json(acaoConcluidosHoje(p));
    if (String(p.pagina || '') === 'backlog') return json(montarBacklog(p));
    return json(montar(p));
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- cache (CacheService) ----------
 * Guarda só os DADOS BRUTOS lidos das abas (nunca a resposta final de um usuário), então um perfil jamais vê dado de outro.
 * A chave leva o carimbo da aba Sincronismo: quando a planilha sincroniza, o carimbo muda e o cache antigo deixa de valer sozinho.
 * Qualquer erro de cache é ignorado: a leitura cai direto na planilha (o cache nunca derruba a resposta).
 */
let CACHE_LOG = null;   // nas funções de teste vira uma lista para registrar "cache" ou "planilha"
let _SINC = null;       // memória da leitura do Sincronismo durante uma requisição
function sincMemo(ss) { return _SINC || (_SINC = lerSinc(ss)); }

function cacheVer() {
  try {
    const c = CacheService.getScriptCache();
    let v = c.get('dp:ver');
    if (!v) { v = String(Date.now()); c.put('dp:ver', v, 21600); }
    return v;
  } catch (e) { return '0'; }
}
function cacheLer(chave) {
  const c = CacheService.getScriptCache();
  const v = c.get(chave);
  if (!v) return undefined;
  if (v.charAt(0) === 'I') return JSON.parse(v.slice(1));
  const n = Number(v.slice(1));
  if (!(n > 0)) return undefined;
  const ks = []; for (let i = 0; i < n; i++) ks.push(chave + ':' + i);
  const got = c.getAll(ks);
  let s = '';
  for (let i = 0; i < n; i++) { const parte = got[ks[i]]; if (parte == null) return undefined; s += parte; }
  return JSON.parse(s);
}
function cacheGravar(chave, obj, ttl) {
  const c = CacheService.getScriptCache();
  const s = JSON.stringify(obj);
  if (s.length <= CACHE_PARTE) { c.put(chave, 'I' + s, ttl); return; }
  const n = Math.ceil(s.length / CACHE_PARTE);
  if (n > CACHE_MAX_PARTES) return;                     // grande demais: não guarda
  const tudo = {};
  for (let i = 0; i < n; i++) tudo[chave + ':' + i] = s.slice(i * CACHE_PARTE, (i + 1) * CACHE_PARTE);
  c.putAll(tudo, ttl);
  c.put(chave, 'P' + n, ttl);                           // o índice é gravado por último
}
function viaCache(nome, ttl, carimbo, fn, revive) {
  const chave = 'dp1:' + cacheVer() + ':' + nome + ':' + (carimbo == null ? 'x' : carimbo);
  try {
    const v = cacheLer(chave);
    if (v !== undefined) { if (CACHE_LOG) CACHE_LOG.push(nome + ': cache'); return revive ? revive(v) : v; }
  } catch (e) {}
  const r = fn();                                       // se a planilha falhar, o erro segue normalmente (nada foi guardado)
  try { cacheGravar(chave, r, ttl); } catch (e) {}
  if (CACHE_LOG) CACHE_LOG.push(nome + ': planilha');
  return r;
}
/** Rode manualmente para forçar a releitura das abas na próxima requisição. */
function limparCache() {
  try { CacheService.getScriptCache().remove('dp:ver'); Logger.log('Cache limpo: a próxima requisição lê direto da planilha.'); }
  catch (e) { Logger.log('Não foi possível limpar o cache: ' + e); }
}
/** Diagnóstico: roda duas leituras seguidas e mostra de onde veio cada dado (cache ou planilha). */
function testarCache() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [1, 2].forEach(n => {
    _SINC = null; CACHE_LOG = [];
    lerAbaC(ss, ABA_BASE); lerAbaC(ss, ABA_HOJE); lerAbertos(ss); lerBacklog(ss); lerUsuarios(ss, ABA_TEC); lerMetas(ss); lerConfig(ss);
    Logger.log('Leitura ' + n + ': ' + CACHE_LOG.join(' | '));
  });
  CACHE_LOG = null;
}

/* ---------- usuários e login ---------- */
const ERRO_LOGIN = 'Login ou senha inválidos.';
function ehAtivo(v) { return nomeKey(v) !== 'NAO'; }   // vazio = ativo; NÃO / NAO = inativo

/**
 * Lê uma aba de usuários. Colunas: 1ª = nome, 2ª = vínculo (supervisor / coordenador / CEO);
 * Login, Senha e Ativo são localizados pelo cabeçalho (com a posição C, D, E como alternativa).
 */
function lerUsuarios(ss, aba) { return viaCache('usr:' + aba, CACHE_TTL_CFG, null, () => lerUsuariosRaw(ss, aba)); }
function lerUsuariosRaw(ss, aba) {
  const sh = ss.getSheetByName(aba);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getDataRange().getValues();
  const cab = v[0].map(chaveH);
  const ix = (nomes, fb) => { for (let i = 0; i < nomes.length; i++) { const k = cab.indexOf(nomes[i]); if (k >= 0) return k; } return fb; };
  // a aba Técnicos tem a coluna Tipo antes do nome, então nome e vínculo também são localizados pelo cabeçalho
  const dica = aba === ABA_TEC ? [['tecnico', 'tecnicos', 'nome'], ['supervisor']]
             : aba === ABA_SUP ? [['supervisor', 'nome'], ['coordenador']]
             : aba === ABA_CONTR ? [['controlador', 'nome'], ['supervisor']]
             : [['coordenador', 'nome'], ['ceo']];
  const iNom = ix(dica[0], 0), iRef = ix(dica[1], 1);
  const iLog = ix(['login', 'usuario'], 2), iSen = ix(['senha'], 3), iAti = ix(['ativo', 'ativa'], 4);
  const iTip = ix(['tipo'], -1);
  const out = [];
  v.slice(1).forEach(r => {
    const nome = corrigeTexto(r[iNom]).trim();
    if (!nome) return;
    out.push({
      nome: nome,
      ref: corrigeTexto(r[iRef]).trim(),
      tipo: iTip >= 0 ? corrigeTexto(r[iTip]).trim() : '',
      login: String(r[iLog] == null ? '' : r[iLog]).trim(),
      senha: String(r[iSen] == null ? '' : r[iSen]).trim(),
      ativo: ehAtivo(r[iAti])
    });
  });
  return out;
}

/** Confere login + senha nas abas Coordenador, Supervisor, Controlador e Técnicos (nessa ordem). Devolve o usuário ou null. */
function autenticar(ss, login, senha) {
  const l = chave(login), s = String(senha == null ? '' : senha).trim();
  if (!l || !s) return null;
  const grupos = [['coordenador', ABA_COORD], ['supervisor', ABA_SUP], ['controlador', ABA_CONTR], ['tecnico', ABA_TEC]];
  for (let g = 0; g < grupos.length; g++) {
    const lista = lerUsuarios(ss, grupos[g][1]);
    for (let i = 0; i < lista.length; i++) {
      const u = lista[i];
      if (u.ativo && u.login && chave(u.login) === l && u.senha === s) {
        registrarAcesso(l, false);
        return {
          papel: grupos[g][0], nome: u.nome,
          supervisor: grupos[g][0] === 'tecnico' || grupos[g][0] === 'controlador' ? u.ref : grupos[g][0] === 'supervisor' ? u.nome : '',
          coordenador: grupos[g][0] === 'supervisor' ? u.ref : grupos[g][0] === 'coordenador' ? u.nome : ''
        };
      }
    }
  }
  return null;
}
function usuarioPublico(u) { return { papel: u.papel, nome: u.nome, supervisor: u.supervisor, coordenador: u.coordenador }; }
function negaLogin() { return { ok: false, auth: true, login: true, error: ERRO_LOGIN }; }

function fazerLogin(p) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const u = autenticar(ss, p.login, p.senha);
  if (u) registrarAcesso(chave(p.login), true);               // entrada: grava na hora e tira a marca de "saiu"
  return u ? { ok: true, usuario: usuarioPublico(u), token: criarToken(p.login) } : negaLogin();   // token: usado nas ações de configuração (POST)
}

// Supervisores para o filtro: aba Supervisor (ativos) + supervisores citados na aba Técnicos que não estejam lá
function listaSupervisores(ss) {
  const vistos = {}, lista = [];
  const add = n => { const k = nomeKey(n); if (k && !vistos[k]) { vistos[k] = 1; lista.push(String(n).trim()); } };
  lerUsuarios(ss, ABA_SUP).forEach(u => { if (u.ativo) add(u.nome); });
  lerUsuarios(ss, ABA_TEC).forEach(u => { if (u.ativo) add(u.ref); });
  return lista.sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/* ---------- utilidades ---------- */
// Conserta texto com acento "quebrado" (ex.: INSTALAÃ‡ÃƒO -> INSTALAÇÃO), que acontece quando a
// exportação foi lida com a codificação errada. Texto normal passa direto, sem alteração.
const CP1252 = {0x20AC:0x80,0x201A:0x82,0x0192:0x83,0x201E:0x84,0x2026:0x85,0x2020:0x86,0x2021:0x87,0x02C6:0x88,0x2030:0x89,0x0160:0x8A,0x2039:0x8B,0x0152:0x8C,0x017D:0x8E,0x2018:0x91,0x2019:0x92,0x201C:0x93,0x201D:0x94,0x2022:0x95,0x2013:0x96,0x2014:0x97,0x02DC:0x98,0x2122:0x99,0x0161:0x9A,0x203A:0x9B,0x0153:0x9C,0x017E:0x9E,0x0178:0x9F};
function corrigeTexto(s) {
  s = String(s == null ? '' : s);
  if (!/[\u00C2\u00C3]/.test(s)) return s;
  try {
    let h = '';
    for (const ch of s) {
      let c = ch.codePointAt(0);
      if (CP1252[c]) c = CP1252[c];
      if (c > 255) return s;
      h += '%' + (c < 16 ? '0' : '') + c.toString(16);
    }
    return decodeURIComponent(h);
  } catch (e) { return s; }
}
function sa(s) { return corrigeTexto(s).normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function up(s) { return corrigeTexto(s).trim().toUpperCase(); }
function chave(s) { return sa(s).trim().toLowerCase(); }

// Normaliza o tipo: sem acento, maiúsculas, e qualquer sinal/espaço estranho
// (espaço não separável, hífen, ponto, espaço duplo) vira um único espaço.
function tipoLimpo(s) {
  return sa(corrigeTexto(s).toUpperCase()).replace(/[^A-Z0-9]+/g, ' ').trim();
}
function ehInstalacaoFibra(s) { return tipoLimpo(s).indexOf('INSTALACAO FIBRA') >= 0; }
// Prestação de contas e Liberação de combustível (abastecimento) seguem a mesma regra: ficam fora de Concluídos
function ehPrestacaoContas(s) {
  const t = tipoLimpo(s);
  return t.indexOf('PRESTACAO DE CONTAS') >= 0 || t.indexOf('COMBUSTIVEL') >= 0;
}

// Tipos que sempre contam como concluído (ver TIPOS_SEMPRE_CONTAM no topo)
function ehTipoSempreConta(s) {
  const t = tipoLimpo(s);
  for (let i = 0; i < TIPOS_SEMPRE_CONTAM.length; i++) if (t.indexOf(TIPOS_SEMPRE_CONTAM[i]) >= 0) return true;
  return false;
}
// Reabertura de verdade = coluna Reabertura = 1, exceto nos tipos que sempre contam
function ehReabertura(x) {
  return Number(String(x.re).replace(',', '.')) === 1 && !ehTipoSempreConta(x.tp);
}

// Classificação de UMA OS encerrada (fonte única da regra; usada por montar() e pelos testes).
//   cat: 'reabInst' | 'reabPend' | 'reabOutros' (reabertura) · 'outros' (prestação de contas / combustível) · 'inst' | 'pend' (contam como concluído)
function classificarOS(x) {
  const pc = ehPrestacaoContas(x.tp), inst = ehInstalacaoFibra(x.tp);
  if (ehReabertura(x)) return { reab: true, concl: false, cat: pc ? 'reabOutros' : inst ? 'reabInst' : 'reabPend' };
  if (pc) return { reab: false, concl: false, cat: 'outros' };
  return { reab: false, concl: true, cat: inst ? 'inst' : 'pend' };
}

/* ---------- metas por tipo de técnico ---------- */
function numPT(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const t = String(v == null ? '' : v).trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return isFinite(n) ? n : null;
}
// Aba Metas: Tipo | Meta I | Meta II | Meta III | Meta IV  ->  mapa['condominio'] = [3.5, 4.4, 5.5, 6.5]
function lerMetas(ss) { return viaCache('metas', CACHE_TTL_CFG, null, () => lerMetasRaw(ss)); }
function lerMetasRaw(ss) {
  const mapa = {}, sh = ss.getSheetByName(ABA_METAS);
  if (!sh || sh.getLastRow() < 2) return { ok: false, mapa: mapa };
  sh.getDataRange().getValues().slice(1).forEach(r => {
    const k = chave(r[0]);
    if (!k) return;
    const m = [1, 2, 3, 4].map(i => numPT(r[i]));
    if (m.some(x => x == null)) return;
    mapa[k] = m;
  });
  return { ok: Object.keys(mapa).length > 0, mapa: mapa };
}
// quantas metas (0 a 4) o valor já alcançou
function faixaMeta(v, metas) { let f = 0; metas.forEach(m => { if (v + 1e-9 >= m) f++; }); return f; }
// cor: abaixo de 1 de distância da Meta I = observação (laranja); mais longe = atenção (vermelho);
// Meta I = normal (verde); Meta II ou mais = acima (azul)
function nivelMeta(v, metas) {
  const f = faixaMeta(v, metas);
  if (f >= 2) return 'acima';
  if (f === 1) return 'normal';
  return v + 1e-9 >= metas[0] - 1 ? 'obs' : 'atencao';
}

// Cor da produção de um dia sem meta por tipo: até 2 = atenção · 3 = observação · 4 e 5 = normal · acima de 5 = acima
function nivelDia(c) { return c <= 2 ? 'atencao' : c === 3 ? 'obs' : c <= 5 ? 'normal' : 'acima'; }
// Nível (cor) do técnico. Única fonte da regra: o front só exibe o que vem daqui.
//   com metas do tipo -> nivelMeta da média por dia produzido
//   sem metas, período de um dia só -> nivelDia
//   sem metas, período longo -> metas Normal / Observação do período (aba Config)
function calcularNivel(o) {
  if (o.metas) return o.diasMeta ? nivelMeta(o.media, o.metas) : 'atencao';
  if (o.diario) return nivelDia(o.concl);
  return o.concl >= o.metaN ? 'normal' : o.concl >= o.metaO ? 'obs' : 'atencao';
}

function lerData(v) {
  if (v instanceof Date) return isNaN(v) ? null : v;
  const m = String(v || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
  const i = String(v || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  return i ? new Date(+i[1], +i[2] - 1, +i[3]) : null;
}
function dia(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function isoDia(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
const NOMES_MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/**
 * Seleção do calendário (Produção mensal). Parâmetros:
 *   dias  = "2026-05-03,2026-05-10"   (dias avulsos)
 *   meses = "2026-04,2026-05"         (meses inteiros; no mês atual vale só até hoje)
 * Devolve o conjunto de dias (chaves yyyy-mm-dd), o menor/maior dia e o rótulo.
 */
function lerSelecao(p, hoje) {
  const set = {}, meses = [];
  String(p.meses || '').split(',').forEach(s => {
    const m = s.trim().match(/^(\d{4})-(\d{2})$/);
    if (!m) return;
    const y = +m[1], mo = +m[2] - 1, n = new Date(y, mo + 1, 0).getDate();
    meses.push({ y: y, mo: mo });
    for (let d = 1; d <= n; d++) { const dt = new Date(y, mo, d); if (dt <= hoje) set[isoDia(dt)] = 1; }
  });
  const chavesMeses = {};
  meses.forEach(x => { chavesMeses[x.y + '-' + ('0' + (x.mo + 1)).slice(-2)] = 1; });
  let avulsos = 0;
  String(p.dias || '').split(',').forEach(s => {
    const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return;
    const dt = new Date(+m[1], +m[2] - 1, +m[3]);
    if (dt > hoje) return;
    const k = isoDia(dt);
    if (!set[k]) { set[k] = 1; avulsos++; }
  });
  const chaves = Object.keys(set).sort();
  const partes = [];
  if (meses.length === 1) partes.push(NOMES_MES[meses[0].mo] + ' de ' + meses[0].y);
  else if (meses.length > 1) {
    const anos = Array.from(new Set(meses.map(x => x.y)));
    const todosDoAno = anos.length === 1 && meses.length === (anos[0] === hoje.getFullYear() ? hoje.getMonth() + 1 : 12);
    partes.push(todosDoAno ? 'Ano ' + anos[0] : meses.length + ' meses');
  }
  if (avulsos) partes.push(avulsos + (avulsos === 1 ? ' dia' : ' dias'));
  const iso2d = k => new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
  return {
    set: set, n: chaves.length,
    ini: chaves.length ? iso2d(chaves[0]) : null,
    fim: chaves.length ? iso2d(chaves[chaves.length - 1]) : null,
    rotulo: partes.length ? partes.join(' + ') : 'Calendário (sem seleção)'
  };
}
function br(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM/yyyy'); }

function lerConfig(ss) { return viaCache('cfg', CACHE_TTL_CFG, null, () => lerConfigRaw(ss)); }
// Hora do expediente em "HH:MM": aceita texto ("8:00", "08:00") ou célula de hora do Google Sheets
function horaCfg(ss, v, padrao) {
  try {
    if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, ss.getSpreadsheetTimeZone(), 'HH:mm');
    const m = String(v == null ? '' : v).trim().match(/^(\d{1,2})(?:[:h](\d{2}))?$/);
    if (m && +m[1] <= 24 && +(m[2] || 0) < 60) return ('0' + m[1]).slice(-2) + ':' + (m[2] || '00');
  } catch (e) {}
  return padrao;
}
function lerConfigRaw(ss) {
  const cfg = {};
  const sh = ss.getSheetByName(ABA_CFG);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => { cfg[chave(r[0])] = r[1]; });
  }
  const num = (k, fb) => { const n = Number(String(cfg[k] == null ? '' : cfg[k]).replace(',', '.')); return isFinite(n) && String(cfg[k]).trim() !== '' ? n : fb; };
  return {
    codigo: String(cfg['codigo de acesso'] == null ? '' : cfg['codigo de acesso']).trim(),
    metaNormal: num('meta normal (por dia)', 4),
    metaObs: num('meta observacao (por dia)', 2),
    metaGap: Math.min(4, Math.max(1, Math.round(num('meta do gap (1 a 4)', 1)))),
    metaPadrao: num('meta padrao (por dia)', 5),
    titulo: cfg['titulo'] || 'Desempenho da Equipe',
    subtitulo: cfg['subtitulo'] || '',
    expedIni: horaCfg(ss, cfg['inicio expediente'], '08:00'),   // Config > "Inicio expediente" (padrão 08:00)
    expedFim: horaCfg(ss, cfg['fim expediente'], '18:00')       // Config > "Fim expediente" (padrão 18:00)
  };
}

/**
 * Lê a aba Sincronismo e devolve os horários em milissegundos (epoch).
 *   hoje = B2 (Encerramentos_Hoje)
 *   base = C2 (Encerramentos)
 * Aceita data/hora real da planilha ou texto "dd/mm/aaaa hh:mm".
 */
function lerSinc(ss) {
  const sh = ss.getSheetByName(ABA_SINC);
  if (!sh) return { hoje: null, base: null };
  const conv = v => {
    const d = v instanceof Date ? v : lerData(v);
    return d && !isNaN(d) ? d.getTime() : null;
  };
  return {
    hoje: conv(sh.getRange('B2').getValue()),
    base: conv(sh.getRange('C2').getValue()),
    abertos: conv(sh.getRange('A2').getValue())
  };
}

/**
 * Lê uma aba de encerramentos e devolve as linhas já normalizadas.
 * Cada aba tem as colunas localizadas pelo próprio cabeçalho.
 */
// versão com cache (Encerramentos_Hoje usa o carimbo B2 do Sincronismo; Encerramentos usa C2)
function lerAbaC(ss, nome) {
  const s = sincMemo(ss);
  return viaCache('aba:' + nome, CACHE_TTL_DADOS, nome === ABA_HOJE ? s.hoje : s.base, () => lerAba(ss, nome),
    v => { (v.rows || []).forEach(x => { x.dt = x.dt ? new Date(x.dt) : null; }); return v; });
}
function lerAba(ss, nome) {
  const sh = ss.getSheetByName(nome);
  const dados = sh && sh.getLastRow() > 1 ? sh.getDataRange().getValues() : [];
  if (!dados.length) return { total: 0, rows: [] };

  const cab = dados[0].map(chave);
  const col = n => cab.indexOf(chave(n));
  const iAt = col('Atendente'), iSt = col('Status'), iTp = col('Tipo Solicitação'),
        iRe = col('Reabertura'), iDt = col('DT conclusão'), iAtr = col('Em atraso'), iCod = col('Código');
  // cliente / cidade / bairro: tenta os nomes mais comuns e, se não achar, qualquer cabeçalho que contenha a palavra
  const acha = (nomes, contem) => {
    for (let i = 0; i < nomes.length; i++) { const k = col(nomes[i]); if (k >= 0) return k; }
    for (let j = 0; j < cab.length; j++) { if (contem.some(w => cab[j].indexOf(w) >= 0)) return j; }
    return -1;
  };
  const iCli = acha(['Cliente', 'Nome Cliente', 'Nome do Cliente', 'nome_cliente', 'Nome Completo Cliente'], ['cliente']);
  const iCid = acha(['Cidade'], ['cidade']);
  const iBai = acha(['Bairro'], ['bairro']);
  if (iAt < 0 || iSt < 0 || iTp < 0 || iRe < 0) {
    throw new Error('Cabeçalho da aba ' + nome + ' não reconhecido (precisa de Atendente, Status, Tipo Solicitação, Reabertura).');
  }

  const rows = dados.slice(1)
    .filter(r => iCod < 0 ? up(r[iAt]) : String(r[iCod]).trim() !== '')
    .map(r => ({
      at: up(r[iAt]),
      st: up(r[iSt]),
      tp: corrigeTexto(r[iTp]),
      re: String(r[iRe]).trim(),
      dt: iDt >= 0 ? lerData(r[iDt]) : null,
      atr: iAtr >= 0 ? up(r[iAtr]) : '',
      cod: iCod >= 0 ? String(r[iCod]).trim() : '',
      cli: iCli >= 0 ? corrigeTexto(r[iCli]).trim() : '',
      cid: iCid >= 0 ? corrigeTexto(r[iCid]).trim() : '',
      bai: iBai >= 0 ? corrigeTexto(r[iBai]).trim() : ''
    }));
  return { total: dados.length, rows: rows };
}

/**
 * Lê a aba Base_Abertos (solicitações ainda não atendidas) e agrupa por responsável.
 * Devolve { ok, mapa } onde mapa[nome] = { total, play: [...], agenda: [...] } (itens: {tipo, protocolo, cliente, cidade, bairro, status, emp}).
 * Cabeçalho aceita "em_play" ou "em play" (underscore e espaço são tratados igual).
 */
function nomeKey(s) { return sa(up(s)).replace(/\s+/g, ' '); }
function chaveH(s) { return chave(s).replace(/[_\s]+/g, ' '); }

function lerAbertos(ss) { return viaCache('abertos', CACHE_TTL_DADOS, sincMemo(ss).abertos, () => lerAbertosRaw(ss)); }
function lerAbertosRaw(ss) {
  const sh = ss.getSheetByName(ABA_ABERTOS);
  if (!sh) return { ok: false, mapa: {} };
  if (sh.getLastRow() < 2) return { ok: true, mapa: {} };
  const dados = sh.getDataRange().getValues();
  const cab = dados[0].map(chaveH);
  const col = n => cab.indexOf(chaveH(n));
  const iResp = col('responsavel'), iPlay = col('em_play'), iTipo = col('tipo_solicitacao'),
        iProt = col('protocolo_novo'), iNome = col('nome_cliente'), iNome2 = col('nome_completo_cliente'), iCid = col('cidade'),
        iBai = col('bairro'), iSt = col('status_solicitacao'), iEq = col('equipe_solicitacao'), iC1 = col('cat_1'),
        iAtr = col('em_atraso'), iPz = col('data_prazo');
  if (iResp < 0 || iPlay < 0) return { ok: false, mapa: {} };

  const txt = (r, i) => i < 0 ? '' : corrigeTexto(r[i]).trim();
  const mapa = {};
  dados.slice(1).forEach(r => {
    const k = nomeKey(r[iResp]);
    if (!k) return;
    const m = mapa[k] || (mapa[k] = { total: 0, play: [], agenda: [] });
    m.total++;
    const tipoOS = txt(r, iTipo);
    const item = {
      tipo: tipoOS,
      protocolo: txt(r, iProt),
      cliente: txt(r, iNome) || txt(r, iNome2),
      cidade: txt(r, iCid),
      bairro: txt(r, iBai),
      status: txt(r, iSt),                                       // status_solicitacao (Agendado, Remarcação, Tratamento Infra...)
      emp: empresaDe(tipoOS, txt(r, iEq), txt(r, iC1)),          // mesma regra do Backlog
      atr: iAtr >= 0 && nomeKey(r[iAtr]) === 'SIM' ? 1 : 0,        // 1 = OS em atraso (coluna em_atraso = Sim)
      pz: iPz < 0 ? null : msDataHora(r[iPz])                      // data_prazo em milissegundos (ou null)
    };
    if (nomeKey(r[iPlay]) === 'SIM') m.play.push(item);
    else m.agenda.push(item);   // agendado, ainda não iniciou
  });
  return { ok: true, mapa: mapa };
}

/* ---------- BACKLOG (aba Base_Abertos) ---------- */
const EMPRESAS_PREFIXO = ['JEBNET', 'DNET', 'GIGANET', 'EMX'];   // o que não tiver prefixo é INFOLINK

// Empresa: 1) prefixo do tipo  2) equipe_solicitacao / cat_1  3) INFOLINK
function empresaDe(tipo, equipe, cat1) {
  const t = tipoLimpo(tipo);
  for (let i = 0; i < EMPRESAS_PREFIXO.length; i++) {
    const e = EMPRESAS_PREFIXO[i];
    if (t === e || t.indexOf(e + ' ') === 0) return e;
  }
  const x = ' ' + tipoLimpo(equipe) + ' | ' + tipoLimpo(cat1) + ' ';
  for (let i = 0; i < EMPRESAS_PREFIXO.length; i++) {
    if (x.indexOf(' ' + EMPRESAS_PREFIXO[i] + ' ') >= 0) return EMPRESAS_PREFIXO[i];
  }
  return 'INFOLINK';
}

// Categoria do backlog a partir do tipo (a ordem importa: Retrabalho vence Instalação/Pendência)
function categoriaDe(tipo) {
  const t = tipoLimpo(tipo);
  const tem = s => t.indexOf(s) >= 0;
  if (tem('RETRABALHO')) return 'retrab';
  if (tem('TRANSFERENCIA')) return 'transf';
  if (tem('REATIVACAO')) return 'reativ';
  if (tem('REPETIDOR')) return 'repet';
  if (tem('ROTEADOR') || tem('ROTEA')) return 'troca';
  if (tem('INSTALACAO FIBRA')) return 'inst';
  if (tem('PENDENCIA')) return 'pend';
  if (tem('SERVICO')) return 'serv';
  return 'outros';
}

// Aceita data/hora real da planilha, "aaaa-mm-dd hh:mm:ss(.ffffff)" ou "dd/mm/aaaa hh:mm"; devolve milissegundos
function msDataHora(v) {
  if (v instanceof Date) return isNaN(v) ? null : v.getTime();
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\s,-]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
  return null;
}
function coordenada(v, max) {
  const n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
  return isFinite(n) && Math.abs(n) <= max && n !== 0 ? n : null;
}
function ehFila(resp) {
  const k = nomeKey(resp);
  return !k || /^(AGENDAMENTO|ROTEIRIZADOR)(\s|$)/.test(k);
}

// Equipe do setor: contém "Gestão de OS" (aceita "Gestão de O.S", "DNET - Gestão de O.S", "Gestão De O.S - LB Jebnet"...)
function ehGestaoOS(eq) {
  return tipoLimpo(eq).replace(/ /g, '').indexOf('GESTAODEOS') >= 0;
}

// Tipos de OS que NÃO entram na soma do backlog (comparação por "contém", sem acento/pontuação)
const TIPOS_FORA_BACKLOG = [
  'VALIDACAO DE INVIABILIDADE TECNICA',
  'VERIFICACAO DE CAIXA',
  'VALIDACAO PRESTACAO DE CONTAS',
  'LIBERACAO DE COMBUSTIVEL'
];
function ehForaDoBacklog(tipo) {
  const t = tipoLimpo(tipo);
  for (let i = 0; i < TIPOS_FORA_BACKLOG.length; i++) {
    if (t.indexOf(TIPOS_FORA_BACKLOG[i]) >= 0) return true;
  }
  return false;
}

// Supervisor de cada técnico (aba Técnicos: A = nome, B = supervisor, E = ativo). Usado no filtro de supervisor do Backlog.
function lerSupervisoresTec(ss) {
  const mapa = {};
  lerUsuarios(ss, ABA_TEC).forEach(u => { if (u.ref) mapa[nomeKey(u.nome)] = u.ref; });
  return { mapa: mapa, lista: listaSupervisores(ss) };
}

function lerBacklog(ss) { return viaCache('backlog', CACHE_TTL_DADOS, sincMemo(ss).abertos, () => lerBacklogRaw(ss)); }
function lerBacklogRaw(ss) {
  const supT = lerSupervisoresTec(ss);
  const sh = ss.getSheetByName(ABA_ABERTOS);
  if (!sh) return { ok: false, motivo: 'A aba ' + ABA_ABERTOS + ' não foi encontrada.', itens: [] };
  if (sh.getLastRow() < 2) return { ok: true, itens: [] };
  const dados = sh.getDataRange().getValues();
  const cab = dados[0].map(chaveH);
  const col = n => cab.indexOf(chaveH(n));
  const I = {
    prot: col('protocolo_novo'), cli: col('nome_cliente'), cli2: col('nome_completo_cliente'),
    t1: col('numero_1'), t2: col('numero_2'), cid: col('cidade'), bai: col('bairro'), rua: col('rua'), num: col('numero_casa'),
    lat: col('latitude'), lon: col('longitude'), tipo: col('tipo_solicitacao'), st: col('status_solicitacao'),
    ab: col('data_abertura'), pz: col('data_prazo'), atr: col('em_atraso'), resp: col('responsavel'), play: col('em_play'),
    c1: col('cat_1'), c2: col('cat_2'), c3: col('cat_3'), c4: col('cat_4'), c5: col('cat_5'),
    at: col('atendente_origem'), desc: col('descricao_abertura'), orig: col('protocolo_os_original'), eq: col('equipe_solicitacao')
  };
  if (I.tipo < 0 || I.atr < 0) {
    return { ok: false, motivo: 'Cabeçalho da aba ' + ABA_ABERTOS + ' não reconhecido (precisa de tipo_solicitacao e em_atraso).', itens: [] };
  }
  const txt = (r, i) => i < 0 ? '' : corrigeTexto(r[i]).trim();
  const itens = [];
  dados.slice(1).forEach(r => {
    const tipo = txt(r, I.tipo), prot = txt(r, I.prot);
    if (!tipo && !prot) return;                       // linha vazia
    if (ehForaDoBacklog(tipo)) return;                // tipos que não contam no backlog
    if (I.eq >= 0 && !ehGestaoOS(txt(r, I.eq))) return;   // só o setor Gestão de OS (coluna equipe_solicitacao = AD)
    const emp = empresaDe(tipo, txt(r, I.eq), txt(r, I.c1));
    const cats = [I.c1, I.c2, I.c3, I.c4, I.c5].map(i => txt(r, i)).filter(Boolean);
    const rua = txt(r, I.rua), num = txt(r, I.num);
    let desc = txt(r, I.desc).replace(/\s+/g, ' ');
    if (desc.length > 1200) desc = desc.slice(0, 1200) + '…';
    const resp = txt(r, I.resp);
    itens.push({
      id: prot,
      cli: txt(r, I.cli) || txt(r, I.cli2),
      t1: txt(r, I.t1), t2: txt(r, I.t2),
      cid: txt(r, I.cid), bai: txt(r, I.bai), end: (rua + (num && rua ? ', ' : '') + num).trim(),
      lat: coordenada(I.lat < 0 ? '' : r[I.lat], 90), lon: coordenada(I.lon < 0 ? '' : r[I.lon], 180),
      tipo: tipo.replace(/^\s*(JEBNET|DNET|GIGANET|EMX)\s*-\s*/i, ''),
      st: txt(r, I.st),
      ab: msDataHora(I.ab < 0 ? '' : r[I.ab]), pz: msDataHora(I.pz < 0 ? '' : r[I.pz]),
      atr: nomeKey(r[I.atr]) === 'SIM' ? 1 : 0,
      resp: resp, fila: ehFila(resp) ? 1 : 0,
      sup: supT.mapa[nomeKey(resp)] || '',
      play: I.play >= 0 && nomeKey(r[I.play]) === 'SIM' ? 1 : 0,
      emp: emp, cat: categoriaDe(tipo),
      cats: cats, at: txt(r, I.at), desc: desc, orig: txt(r, I.orig), eq: txt(r, I.eq)
    });
  });
  return { ok: true, itens: itens };
}

// Concluídos de hoje (aba Encerramentos_Hoje), mesma regra da produção: ENCERRAMENTO, sem prestação de contas, sem reabertura.
// Com "somenteNome" conta só as OS desse técnico (visão do técnico).
function concluidosHoje(ss, somenteNome) {
  try {
    const a = lerAbaC(ss, ABA_HOJE), k = somenteNome ? nomeKey(somenteNome) : '';
    return a.rows.filter(x => (!k || nomeKey(x.at) === k) && x.st === 'ENCERRAMENTO' && !ehPrestacaoContas(x.tp) && !ehReabertura(x)).length;
  } catch (e) { return null; }
}

// Detalhe dos concluídos de hoje: MESMA regra de concluidosHoje() (ENCERRAMENTO, sem prestação de contas, sem reabertura).
// Devolve { total, itens }; itens limitados a LIMITE_CONCL_HOJE_ITENS (o total continua sendo o real).
// Com "somenteNome" devolve só as OS desse técnico (visão do técnico). Em erro devolve null.
const LIMITE_CONCL_HOJE_ITENS = 600;
function concluidosHojeDetalhe(ss, somenteNome) {
  try {
    const a = lerAbaC(ss, ABA_HOJE), k = somenteNome ? nomeKey(somenteNome) : '';
    const l = a.rows.filter(x => (!k || nomeKey(x.at) === k) && x.st === 'ENCERRAMENTO' && !ehPrestacaoContas(x.tp) && !ehReabertura(x));
    let pm = null; try { pm = lerPrioridades(ss); } catch (e2) {}
    return {
      total: l.length,
      itens: l.slice(0, LIMITE_CONCL_HOJE_ITENS).map(x => comPrio({
        tipo: x.tp, protocolo: x.cod, cliente: x.cli, cidade: x.cid, bairro: x.bai,
        tecnico: x.at, emp: empresaDe(x.tp, '', ''), status: 'Concluído'
      }, x.cod, pm))
    };
  } catch (e) { return null; }
}

/* ---------- ACESSOS (presença) ---------- */
function registrarAcesso(k, forcar) {
  try {
    const c = CacheService.getScriptCache(), ck = 'acc:' + k;
    if (!forcar && c.get(ck)) return;                            // já gravou há menos de 45 s
    PropertiesService.getScriptProperties().setProperty('acc:' + k, JSON.stringify({ t: Date.now(), o: 0 }));
    c.put(ck, '1', 45);
  } catch (e) {}                                                  // presença nunca derruba a resposta
}
function acaoPing(p) { const a = autorizar(p); return a.erro ? a.erro : { ok: true, ms: Date.now() }; }
function acaoSair(p) {
  const a = autorizar(p); if (a.erro) return a.erro;
  try {
    const k = 'acc:' + chave(p.login);
    PropertiesService.getScriptProperties().setProperty(k, JSON.stringify({ t: Date.now(), o: 1 }));
    CacheService.getScriptCache().remove(k);
  } catch (e) {}
  return { ok: true };
}
// Lista de técnicos e controladores com login: online agora e último acesso. Supervisor: só a equipe dele; coordenador: todos.
function acaoAcessos(p) {
  const a = autorizar(p); if (a.erro) return a.erro;
  if (a.usr.papel !== 'supervisor' && a.usr.papel !== 'coordenador') return { ok: false, error: 'Sem permissão.' };
  let props = {};
  try { props = PropertiesService.getScriptProperties().getProperties(); } catch (e) {}
  const agora = Date.now(), sup = a.usr.papel === 'supervisor' ? nomeKey(a.usr.nome) : '';
  const itens = [];
  [['tecnico', ABA_TEC], ['controlador', ABA_CONTR]].forEach(g => {
    lerUsuarios(a.ss, g[1]).forEach(u => {
      if (!u.ativo || !u.login) return;
      if (sup && nomeKey(u.ref) !== sup) return;
      let r = null; try { r = JSON.parse(props['acc:' + chave(u.login)] || 'null'); } catch (e) {}
      const t = r && r.t ? Number(r.t) : null;
      itens.push({ nome: u.nome, papel: g[0], equipe: u.ref, ultimo: t, online: !!(t && !r.o && agora - t <= ACESSO_ON_MS) });
    });
  });
  return { ok: true, agoraMs: agora, itens: itens };
}

/* ---------- ESCALA (aba Escala_FDS) ---------- */
const MES_ABREV = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
// cabeçalho de data: data real, "dd/mm/aaaa" ou "1/nov." (sem ano: o mais próximo de hoje). Devolve "aaaa-mm-dd" ou ''
function isoDataEscala(v) {
  if (v instanceof Date) return isNaN(v) ? '' : isoDia(dia(v));
  const t = String(v == null ? '' : v).trim();
  if (!t) return '';
  const l = lerData(t);
  if (l && /\d{1,2}\/\d{1,2}\/\d{4}/.test(t)) return isoDia(dia(l));
  const m = chave(t).match(/^(\d{1,2})\s*\/\s*([a-z]{3})/);
  if (!m || MES_ABREV[m[2]] == null) return '';
  const h = dia(new Date()); let y = h.getFullYear(); const mo = MES_ABREV[m[2]];
  if (mo - h.getMonth() > 6) y--; else if (h.getMonth() - mo > 6) y++;
  const d = new Date(y, mo, +m[1]);
  return d.getMonth() === mo ? isoDia(d) : '';
}
// tipo do código da célula: extra | trab | folga | ferias | outro
function tipoEscala(cod) {
  const t = tipoLimpo(cod);
  if (!t) return 'vazio';
  if (t.indexOf('EXTRA') >= 0) return 'extra';
  if (t === 'TRA' || t === 'TRABALHO' || t === 'ESCALA' || t === 'ESC') return 'trab';
  if (t.indexOf('FERIAS') >= 0) return 'ferias';
  if (t === 'FOL' || t === 'F' || t.indexOf('F ') === 0 || t.indexOf('FOLGA') === 0) return 'folga';
  return 'outro';
}
function lerEscala(ss) { return viaCache('escala', CACHE_TTL_DADOS, null, () => lerEscalaRaw(ss)); }
/** { ok, datas: [{ iso, escala (dia de escala), nEscala, nExtra }], porDia: { iso: { nomeKey: { c: código, t: tipo } } } } (só dias de escala ou com extra) */
function lerEscalaRaw(ss) {
  const sh = ss.getSheetByName(ABA_ESC);
  if (!sh) return { ok: false, motivo: 'A aba ' + ABA_ESC + ' não foi encontrada.', datas: [], porDia: {} };
  const v = sh.getLastRow() < 2 ? [] : sh.getDataRange().getValues();
  let h = -1, iCol = -1;
  for (let i = 0; i < Math.min(v.length, 10) && h < 0; i++) { const k = v[i].findIndex(c => chaveH(c) === 'colaborador'); if (k >= 0) { h = i; iCol = k; } }
  if (h < 0) return { ok: false, motivo: 'Não achei a coluna COLABORADOR na aba ' + ABA_ESC + '.', datas: [], porDia: {} };
  const cols = [];
  for (let j = iCol + 1; j < v[h].length; j++) { const iso = isoDataEscala(v[h][j]); if (iso) cols.push({ j: j, iso: iso }); }
  const linhas = v.slice(h + 1).filter(r => String(r[iCol] == null ? '' : r[iCol]).trim());
  const datas = [], porDia = {};
  cols.forEach(c => {
    const mapa = {}; let nF = 0, nExt = 0, nTra = 0;
    linhas.forEach(r => {
      const cod = corrigeTexto(r[c.j]).replace(/\s+/g, ' ').trim(), t = tipoEscala(cod);
      mapa[nomeKey(r[iCol])] = { c: cod, t: t };
      if (t === 'folga' && /^F\b/i.test(sa(cod))) nF++;
      if (t === 'extra') nExt++; if (t === 'trab') nTra++;
    });
    const d = new Date(+c.iso.slice(0, 4), +c.iso.slice(5, 7) - 1, +c.iso.slice(8, 10)), fim = d.getDay() === 0 || d.getDay() === 6;
    const escala = fim || (linhas.length > 0 && nF / linhas.length >= ESC_FERIADO_PCT);
    if (!escala && !nExt) return;                    // dia comum sem extra: fora da lista
    datas.push({ iso: c.iso, escala: escala, nEscala: escala ? nTra : 0, nExtra: nExt });
    porDia[c.iso] = mapa;
  });
  datas.sort((a, b) => a.iso < b.iso ? 1 : -1);
  return { ok: true, datas: datas, porDia: porDia };
}

/* ---------- PRIORIDADES (aba Prioridades) ---------- */
function digitosOS(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
// Data/hora da aba Prioridades: Date, texto ou número serial do Sheets (dias desde 30/12/1899, sem fuso)
function msPrio(v) {
  if (typeof v === 'number' && v > 30000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 864e5));
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()).getTime();
  }
  return msDataHora(v);
}
/**
 * Lê a aba Prioridades. Devolve { ok, n, mapa } onde mapa[protocolo só com dígitos] = { id, sol[], set[], jus[], rel, dt, n }.
 * A mesma OS pode ter vários pedidos: viram um registro só (n = quantidade de pedidos, dt = data do primeiro pedido).
 */
function lerPrioridades(ss) { return viaCache('prio', CACHE_TTL_DADOS, null, () => lerPrioridadesRaw(ss)); }
function lerPrioridadesRaw(ss) {
  const sh = ss.getSheetByName(ABA_PRIO);
  if (!sh) return { ok: false, n: 0, mapa: {}, motivo: 'A aba ' + ABA_PRIO + ' não foi encontrada.' };
  if (sh.getLastRow() < 2) return { ok: true, n: 0, mapa: {} };
  const v = sh.getDataRange().getValues();
  // linha do cabeçalho = a primeira (entre as 15 primeiras) que tem a célula "SOLICITANTE"
  let h = -1;
  for (let i = 0; i < Math.min(v.length, 15) && h < 0; i++) { if (v[i].some(c => chaveH(c) === 'solicitante')) h = i; }
  if (h < 0) h = 0;
  const ncol = v[h].length;
  // título da coluna: o da linha do cabeçalho ou, se estiver vazio, o da linha de cima (ex.: "DT REQUIS." fica uma linha acima)
  const cols = [];
  for (let j = 0; j < ncol; j++) cols.push(chaveH(v[h][j]) || (h > 0 ? chaveH(v[h - 1][j]) : ''));
  const exato = nomes => { for (let i = 0; i < nomes.length; i++) { const k = cols.indexOf(nomes[i]); if (k >= 0) return k; } return -1; };
  const contem = ws => { for (let j = 0; j < cols.length; j++) { if (cols[j] && ws.some(w => cols[j].indexOf(w) >= 0)) return j; } return -1; };
  let iProt = exato(['protocolo', 'protocolo novo', 'protocolo os', 'os', 'codigo']);
  if (iProt < 0) {                                   // coluna sem título: a que tem mais números de 8 ou mais dígitos
    let melhor = 0;
    for (let j = 0; j < ncol; j++) {
      let n = 0;
      for (let i = h + 1; i < Math.min(v.length, h + 60); i++) { if (/^\d{8,}$/.test(String(v[i][j]).trim())) n++; }
      if (n > melhor) { melhor = n; iProt = j; }
    }
  }
  if (iProt < 0) return { ok: false, n: 0, mapa: {}, motivo: 'Não achei a coluna do protocolo na aba ' + ABA_PRIO + '.' };
  const iSol = exato(['solicitante']), iSet = contem(['setor']), iJus = exato(['justificativa', 'motivo']),
        iRel = contem(['relato']), iDt = contem(['requis', 'data solicitacao', 'dt solicitacao']);
  const mapa = {}; let n = 0;
  for (let i = h + 1; i < v.length; i++) {
    const r = v[i], k = digitosOS(r[iProt]);
    if (k.length < 8) continue;
    const txt = j => j < 0 ? '' : corrigeTexto(r[j]).replace(/\s+/g, ' ').trim();
    const un = (arr, t) => { if (t && arr.indexOf(t) < 0) arr.push(t); };
    const dt = iDt < 0 ? null : msPrio(r[iDt]);
    let m = mapa[k];
    if (!m) { m = mapa[k] = { id: k, sol: [], set: [], jus: [], rel: '', dt: null, n: 0 }; n++; }
    m.n++;
    un(m.sol, txt(iSol)); un(m.set, txt(iSet)); un(m.jus, txt(iJus));
    const rel = txt(iRel); if (rel) m.rel = rel.length > 400 ? rel.slice(0, 400) + '…' : rel;   // vale o relato mais recente
    if (dt != null && (m.dt == null || dt < m.dt)) m.dt = dt;
  }
  return { ok: true, n: n, mapa: mapa };
}
// dados do pedido que vão junto da OS (compactos)
function prioInfo(m) { return { sol: m.sol.join(', '), set: m.set.join(', '), jus: m.jus.join(' / '), rel: m.rel, dt: m.dt, n: m.n }; }
// devolve a OS marcada como prioridade (prio = 1 e pr = dados do pedido); sem pedido, devolve a própria OS
function comPrio(item, id, pm) {
  const m = pm && pm.mapa ? pm.mapa[digitosOS(id)] : null;
  if (!m) return item;
  const c = Object.assign({}, item); c.prio = 1; c.pr = prioInfo(m);
  return c;
}
// o encerramento vale como atendimento se foi no dia do primeiro pedido ou depois
function prioValeEnc(m, dt) { return !!dt && (m.dt == null || dia(dt) >= dia(new Date(m.dt))); }

/**
 * Situação dos pedidos de prioridade (Backlog): cruza a aba Prioridades com a Base_Abertos e as abas de encerramento.
 *   pendente = ainda aberta (a tela conta pelas OS do backlog) · atendida = tem ENCERRAMENTO desde o pedido (lista dos últimos LIMITE_PRIO_DIAS dias)
 *   cancelada = só tem CANCELADO · sem registro = não está em nenhuma das bases
 * somenteNome (visão do técnico): só as atendidas por ele, sem canceladas nem sem registro.
 */
function situacaoPrioridades(ss, pm, bk, somenteNome) {
  if (!pm || !pm.ok) return { ok: false };
  const ids = Object.keys(pm.mapa);
  const r = { ok: true, total: ids.length, atend: [], atendCortado: 0, cancel: 0, semReg: 0, semRegItens: [] };
  const abertas = {};
  (bk && bk.ok ? bk.itens : []).forEach(x => { const k = digitosOS(x.id); if (k) abertas[k] = 1; });
  try {
    const ab = lerAbertos(ss);
    if (ab.ok) Object.keys(ab.mapa).forEach(nm => { const m = ab.mapa[nm]; m.play.concat(m.agenda).forEach(it => { const k = digitosOS(it.protocolo); if (k) abertas[k] = 1; }); });
  } catch (e) {}
  const hoje = dia(new Date());
  const enc = {}, canc = {};
  const visita = (rows, ehHoje) => rows.forEach(x => {
    const k = digitosOS(x.cod), m = k && pm.mapa[k];
    if (!m) return;
    const dt = x.dt || (ehHoje ? hoje : null);
    if (x.st === 'ENCERRAMENTO' && prioValeEnc(m, dt)) {
      const d = dia(dt).getTime();
      if (!enc[k] || d < enc[k].d) enc[k] = { d: d, iso: isoDia(dia(dt)), at: x.at, tp: x.tp, cli: x.cli, cid: x.cid, bai: x.bai };
    } else if (x.st === 'CANCELADO') canc[k] = 1;
  });
  try {
    const base = lerAbaC(ss, ABA_BASE), hj = lerAbaC(ss, ABA_HOJE);
    const codsHoje = new Set(hj.rows.filter(x => x.cod).map(x => digitosOS(x.cod)));
    visita(base.rows.filter(x => !(x.cod && codsHoje.has(digitosOS(x.cod)))), false);   // vale a linha de Encerramentos_Hoje
    visita(hj.rows, true);
  } catch (e) { return { ok: false }; }
  const supT = lerSupervisoresTec(ss).mapa;
  const lim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - (LIMITE_PRIO_DIAS - 1)).getTime();
  const quem = somenteNome ? nomeKey(somenteNome) : '';
  const atend = [];
  ids.forEach(k => {
    if (abertas[k]) return;
    const m = pm.mapa[k], e = enc[k];
    if (e) {
      if ((quem && nomeKey(e.at) !== quem) || e.d < lim) return;
      atend.push({ id: m.id, iso: e.iso, ms: e.d, tec: e.at, sup: supT[nomeKey(e.at)] || '', tipo: e.tp, cli: e.cli, cid: e.cid, bai: e.bai, emp: empresaDe(e.tp, '', ''), pr: prioInfo(m) });
    } else if (!quem) {
      if (canc[k]) r.cancel++;
      else { r.semReg++; if (r.semRegItens.length < 100) r.semRegItens.push({ id: m.id, pr: prioInfo(m) }); }
    }
  });
  atend.sort((a, b) => b.ms - a.ms || a.id.localeCompare(b.id));
  if (atend.length > LIMITE_PRIO_LISTA) { r.atendCortado = atend.length - LIMITE_PRIO_LISTA; atend.length = LIMITE_PRIO_LISTA; }
  r.atend = atend;
  return r;
}

function montarBacklog(p) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const usr = autenticar(ss, p.login, p.senha);
  if (!usr) return negaLogin();
  const cfg = lerConfig(ss);
  if (cfg.codigo && String(p.codigo || '').trim() !== cfg.codigo) {
    return { ok: false, auth: true, error: p.codigo ? 'Código incorreto.' : 'Informe o código de acesso.' };
  }
  const b = lerBacklog(ss);
  if (!b.ok) return { ok: false, error: b.motivo };
  const tec = usr.papel === 'tecnico';
  // técnico: só as OS abertas em que ele é o responsável (a agenda dele); supervisor e coordenador: backlog geral
  const itens = tec ? b.itens.filter(x => nomeKey(x.resp) === nomeKey(usr.nome)) : b.itens;
  const sinc = lerSinc(ss);
  const leve = String(p.leve || '') === '1';   // leve: OS sem a descrição (vem por acao=os) e sem a lista de concluídos (vem por acao=concluidosHoje)
  const ch = leve ? null : concluidosHojeDetalhe(ss, tec ? usr.nome : '');
  const lista0 = leve ? itens.map(x => { const c = Object.assign({}, x); c.temDesc = c.desc ? 1 : 0; delete c.desc; return c; }) : itens;
  let pm = { ok: false, mapa: {} };
  try { pm = lerPrioridades(ss); } catch (e) {}                       // sem a aba Prioridades (ou com erro) o backlog funciona igual, sem marcas
  const lista = pm.ok ? lista0.map(x => comPrio(x, x.id, pm)) : lista0;
  const resp = {
    ok: true,
    titulo: tec ? 'Minhas OS agendadas' : 'Backlog',
    usuario: usuarioPublico(usr),
    atualizado: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM HH:mm'),
    abertosAtualizadoMs: sinc.abertos,
    agoraMs: Date.now(),
    concluidosHoje: concluidosHoje(ss, tec ? usr.nome : ''),
    supervisores: tec ? [] : lerSupervisoresTec(ss).lista,
    itens: lista
  };
  resp.prioOk = !!pm.ok;                          // false = não existe a aba Prioridades (a tela esconde o bloco de prioridades)
  if (pm.ok) { const sp = situacaoPrioridades(ss, pm, b, tec ? usr.nome : ''); if (sp.ok) resp.prioridades = sp; }   // pedidos de prioridade: atendidas, canceladas, sem registro
  if (ch) resp.concluidosHojeItens = ch.itens;   // lista do diálogo "Concluídos hoje" (campo opcional)
  if (leve) resp.concluidosHojeDet = true;       // avisa o front que a lista está disponível sob demanda
  return resp;
}

/* ---------- principal ---------- */
function montar(p) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const usr = autenticar(ss, p.login, p.senha);
  if (!usr) return negaLogin();
  const cfg = lerConfig(ss);

  if (cfg.codigo && String(p.codigo || '').trim() !== cfg.codigo) {
    return { ok: false, auth: true, error: p.codigo ? 'Código incorreto.' : 'Informe o código de acesso.' };
  }

  // técnicos ativos (aba Técnicos: Técnico | Supervisor | Login | Senha | Ativo)
  // técnico logado enxerga só a si mesmo; controlador só a equipe dele; supervisor e coordenador recebem todos (o painel filtra por equipe)
  const tecs = [];
  const escIso = /^\d{4}-\d{2}-\d{2}$/.test(String(p.escala || '')) ? String(p.escala) : '';
  let esc = null, nEsc = 0, nExt = 0;
  if (usr.papel !== 'tecnico') { try { esc = lerEscala(ss); } catch (e) { esc = null; } }     // técnico não usa o filtro de escala
  const escDia = escIso && esc && esc.ok ? (esc.porDia[escIso] || {}) : null;
  lerUsuarios(ss, ABA_TEC).forEach(u => {
    if (!u.ativo) return;
    if (usr.papel === 'tecnico' && nomeKey(u.nome) !== nomeKey(usr.nome)) return;
    if (usr.papel === 'controlador' && nomeKey(u.ref) !== nomeKey(usr.supervisor)) return;   // controlador: só a equipe do supervisor dele
    let escReg = null;
    if (escDia) {                                    // filtro de escala: só quem está de escala (TRA em dia de escala) ou de extra na data
      const e = escDia[nomeKey(u.nome)];
      if (!e || e.t === 'vazio' || !(e.t === 'extra' || (e.t === 'trab' && esc.datas.some(d => d.iso === escIso && d.escala)))) return;
      escReg = { tp: e.t === 'extra' ? 'extra' : 'escala', cod: e.c };
      if (e.t === 'extra') nExt++; else nEsc++;
    }
    tecs.push({ nome: up(u.nome), supervisor: u.ref, tipo: u.tipo, esc: escReg });
  });

  const hoje = dia(new Date());
  const per = String(p.periodo || 'hoje');
  let pm = { ok: false, mapa: {} };
  try { pm = lerPrioridades(ss); } catch (e) {}      // sem a aba Prioridades (ou com erro) o painel funciona igual, sem marcas

  // quais abas entram, conforme o filtro
  const usaBase = per !== 'hoje';
  const usaHoje = per !== 'ontem' && per !== 'ultimo';

  const base = usaBase ? lerAbaC(ss, ABA_BASE) : { total: 0, rows: [] };
  const hojeAba = usaHoje ? lerAbaC(ss, ABA_HOJE) : { total: 0, rows: [] };

  // linhas de Encerramentos_Hoje sem data de conclusão valem como "hoje"
  hojeAba.rows.forEach(x => { if (!x.dt) x.dt = hoje; });

  // se a mesma OS está nas duas abas, vale a de Encerramentos_Hoje
  const codsHoje = new Set(hojeAba.rows.filter(x => x.cod).map(x => x.cod));
  let linhas = base.rows.filter(x => !(x.cod && codsHoje.has(x.cod))).concat(hojeAba.rows);

  // período
  const datas = linhas.map(x => x.dt).filter(Boolean).map(dia);
  const minD = datas.length ? new Date(Math.min.apply(null, datas)) : hoje;
  const maxD = datas.length ? new Date(Math.max.apply(null, datas)) : hoje;
  let ini = minD, fim = maxD, rotulo = 'Todo o período da base', filtra = true, sel = null;
  const addDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  if (per === 'cal') { sel = lerSelecao(p, hoje); ini = sel.ini || hoje; fim = sel.fim || hoje; rotulo = sel.rotulo; filtra = false; }
  else if (per === 'tudo') { filtra = false; }
  else if (per === 'ultimo') { ini = fim = maxD; rotulo = 'Último dia com dados'; }
  else if (per === 'hoje') { ini = fim = hoje; rotulo = 'Hoje'; filtra = false; } // a aba já é só de hoje
  else if (per === 'ontem') { ini = fim = addDias(hoje, -1); rotulo = 'Ontem'; }
  else if (per === '7d') { ini = addDias(hoje, -6); fim = hoje; rotulo = 'Últimos 7 dias'; }
  else if (per === 'mes') { ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1); fim = hoje; rotulo = 'Mês atual'; }
  else if (per === 'custom' && p.ini && p.fim) { ini = lerData(p.ini); fim = lerData(p.fim); rotulo = 'Personalizado'; }
  if (sel) {
    linhas = linhas.filter(x => x.dt && sel.set[isoDia(dia(x.dt))]);
  } else if (filtra) {
    linhas = linhas.filter(x => x.dt && dia(x.dt) >= ini && dia(x.dt) <= fim);
  }
  // no calendário a meta considera só os dias realmente selecionados (e não o intervalo todo)
  const nDias = sel ? Math.max(1, sel.n) : Math.max(1, Math.round((fim - ini) / 86400000) + 1);
  // período de um dia só (Hoje, Ontem ou início = fim): sem meta por tipo, o nível segue nivelDia
  const diario = per === 'hoje' || per === 'ontem' || !!(ini && fim && isoDia(ini) === isoDia(fim));
  const leve = String(p.leve || '') === '1';   // resposta leve: sem as listas de OS (vêm sob demanda por acao=detalhe)

  // comparativo (Etapa 13): concluídos por técnico no dia anterior e no mesmo dia da semana passada (mesma regra de concluídos, aba Encerramentos)
  let cmpAnt = null, cmpSem = null;
  if (per === 'hoje' || per === 'ontem') {
    const diaBase = per === 'hoje' ? hoje : addDias(hoje, -1);
    const nomes = {}; tecs.forEach(t => { nomes[nomeKey(t.nome)] = 1; });
    try {
      const rb = lerAbaC(ss, ABA_BASE).rows;
      cmpAnt = concluidosPorTecnicoDia(rb, addDias(diaBase, -1), nomes);
      cmpSem = concluidosPorTecnicoDia(rb, addDias(diaBase, -7), nomes);
    } catch (e) { cmpAnt = cmpSem = null; }
  }

  // contagem por técnico
  const mapa = {};
  tecs.forEach(t => { mapa[nomeKey(t.nome)] = { dias: {}, reabInst: 0, reabPend: 0, inst: 0, pend: 0, concl: 0, outros: 0, reabOutros: 0, cancel: 0, atraso: 0, naBase: false, conclItens: [], prioAtend: 0 }; });
  linhas.forEach(x => {
    const m = mapa[nomeKey(x.at)];
    if (!m) return;
    m.naBase = true;
    if (x.st === 'CANCELADO') m.cancel++;
    if (x.st !== 'ENCERRAMENTO') return;
    // controle por dia (dia produzido = ao menos um encerramento no dia)
    const kd = x.dt ? isoDia(dia(x.dt)) : '';
    const dd = kd ? (m.dias[kd] || (m.dias[kd] = { concl: 0, prod: 0, prio: 0 })) : { concl: 0, prod: 0, prio: 0 };
    dd.prod++;
    // prioridade atendida: o protocolo está na aba Prioridades e o encerramento é do dia do pedido ou depois
    const pmx = pm.ok ? pm.mapa[digitosOS(x.cod)] : null;
    if (pmx && prioValeEnc(pmx, x.dt)) { m.prioAtend++; dd.prio++; }
    const cls = classificarOS(x);
    // Reabertura: conta só nas colunas de reabertura e sai de todo o resto
    // (Prestação de contas / combustível reabertos vão só para "Reab. prest. contas")
    if (cls.reab) {
      if (cls.cat === 'reabOutros') m.reabOutros++;
      else if (cls.cat === 'reabInst') m.reabInst++;
      else m.reabPend++;
      return;
    }
    // Prestação de contas / combustível: só em "Outros tipos", fora de Instalação, Pendência e Concluídos
    if (cls.cat === 'outros') m.outros++;
    else {
      if (cls.cat === 'inst') m.inst++; else m.pend++;
      m.concl++;
      dd.concl++;
      // detalhe da OS concluída (aberto ao clicar no valor de Concluídos); limite de segurança por técnico
      if (m.conclItens.length < LIMITE_CONCL_ITENS) {
        m.conclItens.push(comPrio({
          tipo: x.tp, protocolo: x.cod, cliente: x.cli, cidade: x.cid, bairro: x.bai,
          status: 'Concluído', emp: empresaDe(x.tp, '', '')
        }, x.cod, pm));
      }
    }
    if (x.atr.indexOf('SIM') === 0) m.atraso++;
  });

  const ab = lerAbertos(ss);

  const metaN = cfg.metaNormal * nDias, metaO = cfg.metaObs * nDias;
  const mt = lerMetas(ss);
  const tecnicos = tecs.map(t => {
    const m = mapa[nomeKey(t.nome)];
    const a = ab.mapa[nomeKey(t.nome)];
    const agendaN = a ? a.total : 0;
    const produziu = (m.concl + m.outros + m.reabInst + m.reabPend + m.reabOutros) > 0;
    const ativo = produziu || (per === 'hoje' && (!ab.ok || agendaN > 0));

    // metas do tipo (aba Metas) e métricas por dia produzido
    const metas = mt.mapa[chave(t.tipo)] || null;
    const diasArr = Object.keys(m.dias).sort().filter(k => m.dias[k].prod > 0).map(k => {
      const c = m.dias[k].concl;
      return { iso: k, d: k.slice(8, 10) + '/' + k.slice(5, 7), concl: c, prio: m.dias[k].prio || 0,
               faixa: metas ? faixaMeta(c, metas) : null, nivel: metas ? nivelMeta(c, metas) : null };
    });
    const diasProd = diasArr.length;
    const diasMeta = per === 'hoje' ? (ativo ? 1 : 0) : diasProd;      // dias que entram na meta / GAP
    const metaRef = metas ? metas[cfg.metaGap - 1] : cfg.metaPadrao;
    const metaPer = Math.round(metaRef * diasMeta * 100) / 100;
    const media = diasMeta ? Math.round(m.concl / diasMeta * 100) / 100 : 0;
    const nivel = calcularNivel({ metas: metas, diasMeta: diasMeta, media: media, concl: m.concl, diario: diario, metaN: metaN, metaO: metaO });
    const tk = nomeKey(t.nome);
    const playIt = a ? a.play.map(it => comPrio(it, it.protocolo, pm)) : [];       // OS em execução / agendadas, com a marca de prioridade
    const agIt = a ? a.agenda.map(it => comPrio(it, it.protocolo, pm)) : [];
    const regTec = {
      nome: t.nome, supervisor: t.supervisor, tipo: t.tipo,
      reabInst: m.reabInst, reabPend: m.reabPend, inst: m.inst, pend: m.pend, concl: m.concl,
      outros: m.outros, reabOutros: m.reabOutros, cancel: m.cancel, atraso: m.atraso,
      nivel: nivel,
      escTipo: t.esc ? t.esc.tp : undefined, escCod: t.esc ? t.esc.cod : undefined,    // só com o filtro de escala ligado
      metasTipo: metas,                 // [Meta I, II, III, IV] ou null (sem Tipo / Tipo fora da aba Metas)
      metaRef: metaRef,                 // meta diária usada no GAP
      diasProd: diasProd, diasMeta: diasMeta,
      metaPer: metaPer,                 // meta do período = metaRef x dias produzidos
      gap: Math.round((m.concl - metaPer) * 100) / 100,
      media: media,
      dias: diasArr.slice(-62),         // detalhe diário (últimos 62 dias produzidos)
      semBase: !m.naBase,
      play: !ab.ok ? 'na' : agendaN ? (a.play.length ? 'play' : 'parado') : (produziu ? 'fim' : 'vazio'),
      produziu: produziu,
      // ativo: agendado (só no filtro Hoje) ou com encerramento no período; sem a base de abertos, em Hoje conta todos
      ativo: ativo,
      conclItens: m.conclItens,
      playItens: playIt,
      agendaItens: agIt,
      agenda: agendaN,
      // contadores para o detalhamento (a resposta leve não traz as listas): OS em atraso e prioridades
      playAtr: playIt.filter(x => x.atr).length, agendaAtr: agIt.filter(x => x.atr).length,
      prioPend: playIt.concat(agIt).filter(x => x.prio).length,   // prioridades ainda na agenda do técnico
      prioAtend: m.prioAtend                                       // prioridades atendidas por ele no período
    };
    if (cmpAnt) { regTec.cmpOntem = cmpAnt[tk] || 0; regTec.cmpSemana = cmpSem[tk] || 0; }   // comparativo por técnico (o front soma os visíveis)
    return leve ? aliviarTecnico(regTec) : regTec;
  });

  const sinc = lerSinc(ss);

  const resp = {
    ok: true,
    usuario: usuarioPublico(usr),
    titulo: cfg.titulo, subtitulo: cfg.subtitulo,
    atualizado: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM HH:mm'),
    // horários da aba Sincronismo (milissegundos): B2 = Encerramentos_Hoje, C2 = Encerramentos
    hojeAtualizadoMs: sinc.hoje,
    baseAtualizadoMs: sinc.base,
    // em "Hoje" a aba pode estar vazia no começo do dia, isso é normal e não gera aviso
    abertosOk: ab.ok,
    baseVazia: per !== 'hoje' && !base.total && !hojeAba.total,
    periodo: { ini: br(ini), fim: br(fim), iniBR: br(ini), fimBR: br(fim), rotulo: rotulo },
    supervisores: usr.papel === 'tecnico' ? [] : usr.papel === 'controlador' ? supervisoresDoControlador(ss, usr) : listaSupervisores(ss),
    prioOk: pm.ok,
    escalaDatas: usr.papel === 'tecnico' || !esc || !esc.ok ? null : esc.datas,      // datas disponíveis no filtro de escala
    escala: escIso ? { ok: !!(esc && esc.ok), data: escIso, nEscala: nEsc, nExtra: nExt } : null,
    metas: { normal: metaN, obs: metaO },
    metaGap: cfg.metaGap,
    metasOk: mt.ok,
    tecnicos: tecnicos
  };
  // Etapa 13: comparativo do total (só Hoje e Ontem) e expediente para a projeção do dia
  if (cmpAnt) {
    const soma = o => Object.keys(o).reduce((a, k) => a + o[k], 0);
    resp.comparativo = { ontem: soma(cmpAnt), mesmoDiaSemanaPassada: soma(cmpSem), base: per };
  }
  resp.expediente = { ini: cfg.expedIni, fim: cfg.expedFim };
  return resp;
}

// Controlador: a lista de equipes do filtro tem só a equipe dele (nome como está na aba Supervisor / Técnicos)
function supervisoresDoControlador(ss, usr) {
  const k = nomeKey(usr.supervisor);
  const l = listaSupervisores(ss).filter(n => nomeKey(n) === k);
  return l.length ? l : (usr.supervisor ? [usr.supervisor] : []);
}
// Resposta leve (Etapa 8): troca as listas pesadas de OS por contadores
function aliviarTecnico(t) {
  const c = Object.assign({}, t);
  c.conclN = (t.conclItens || []).length; c.playN = (t.playItens || []).length; c.agendaN = (t.agendaItens || []).length;
  delete c.conclItens; delete c.playItens; delete c.agendaItens;
  return c;
}
// Concluídos de um dia, por técnico (mesma regra de concluídos da tela). nomes = { nomeKey: 1 } dos técnicos visíveis
function concluidosPorTecnicoDia(rows, d, nomes) {
  const k = isoDia(d), r = {};
  rows.forEach(x => {
    if (!x.dt || x.st !== 'ENCERRAMENTO' || isoDia(dia(x.dt)) !== k) return;
    const n = nomeKey(x.at);
    if (!nomes[n] || !classificarOS(x).concl) return;
    r[n] = (r[n] || 0) + 1;
  });
  return r;
}

/* ---------- ações sob demanda (exigem login e senha como as demais) ---------- */
function autorizar(p) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const usr = autenticar(ss, p.login, p.senha);
  if (!usr) return { erro: negaLogin() };
  const cfg = lerConfig(ss);
  if (cfg.codigo && String(p.codigo || '').trim() !== cfg.codigo) {
    return { erro: { ok: false, auth: true, error: p.codigo ? 'Código incorreto.' : 'Informe o código de acesso.' } };
  }
  return { ss: ss, usr: usr, cfg: cfg };
}
// acao=detalhe&tec=NOME&lista=concl|play|agenda (+ mesmos filtros de período). Técnico só recebe a própria lista.
function acaoDetalhe(p) {
  const a = autorizar(p); if (a.erro) return a.erro;
  const lista = String(p.lista || '');
  if (['concl', 'play', 'agenda'].indexOf(lista) < 0) return { ok: false, error: 'Lista inválida.' };
  const r = montar(Object.assign({}, p, { leve: '0' }));
  if (!r.ok) return r;
  const k = nomeKey(p.tec);
  const t = (r.tecnicos || []).find(x => nomeKey(x.nome) === k);   // montar() já limita o técnico logado a ele mesmo
  const itens = !t ? [] : lista === 'concl' ? t.conclItens : lista === 'play' ? t.playItens : t.agendaItens;
  return { ok: true, tec: String(p.tec || ''), lista: lista, itens: itens };
}
// acao=os&id=PROTOCOLO -> descrição de abertura da OS (técnico só vê OS dele)
function acaoOS(p) {
  const a = autorizar(p); if (a.erro) return a.erro;
  const id = String(p.id || '').trim();
  const b = lerBacklog(a.ss);
  if (!b.ok) return { ok: false, error: b.motivo };
  let x = b.itens.find(i => i.id === id);
  if (x && a.usr.papel === 'tecnico' && nomeKey(x.resp) !== nomeKey(a.usr.nome)) x = null;
  return { ok: true, id: id, desc: x ? x.desc : '' };
}
// acao=concluidosHoje -> lista da Etapa 2 (técnico só recebe as dele)
function acaoConcluidosHoje(p) {
  const a = autorizar(p); if (a.erro) return a.erro;
  const ch = concluidosHojeDetalhe(a.ss, a.usr.papel === 'tecnico' ? a.usr.nome : '');
  if (!ch) return { ok: false, error: 'Não foi possível ler os concluídos de hoje.' };
  return { ok: true, total: ch.total, itens: ch.itens };
}

// Para os diagnósticos abaixo (testar, testarPlay, testarConcluidos): informe aqui um login de COORDENADOR ou SUPERVISOR.
const LOGIN_TESTE = { login: 'alan.souto', senha: '123456' };

/**
 * Testes de classificação com casos fixos (não usam a planilha). Selecione "testarClassificacao", Executar, Registro de execução.
 */
function testarClassificacao() {
  const casos = [
    ['Instalação Fibra normal',            { tp: 'INSTALAÇÃO FIBRA', re: '0' },                'inst',       true],
    ['Instalação Fibra reaberta',          { tp: 'INSTALAÇÃO FIBRA', re: '1' },                'reabInst',   false],
    ['Pendência normal',                   { tp: 'PENDÊNCIA - SEM CONEXÃO', re: '' },          'pend',       true],
    ['Pendência reaberta',                 { tp: 'PENDÊNCIA - SEM CONEXÃO', re: '1' },         'reabPend',   false],
    ['Prestação de contas',                { tp: 'PRESTAÇÃO DE CONTAS', re: '0' },              'outros',     false],
    ['Prestação de contas reaberta',       { tp: 'PRESTAÇÃO DE CONTAS', re: '1' },              'reabOutros', false],
    ['Liberação de combustível',           { tp: 'LIBERAÇÃO DE COMBUSTÍVEL', re: '0' },          'outros',     false],
    ['Tipo com hífen e espaço duplo',      { tp: 'JEBNET -  INSTALAÇÃO   FIBRA - NOVA', re: '0' }, 'inst',      true],
    ['Tipo com espaço não separável',      { tp: 'INSTALAÇÃO\u00A0FIBRA', re: '0' },            'inst',       true],
    ['REPETIDOR com Reabertura=1 conta',   { tp: 'TROCA DE ULTRA REPETIDOR', re: '1' },         'pend',       true],
    ['Reabertura com vírgula decimal',     { tp: 'PENDÊNCIA', re: '1,0' },                      'reabPend',   false],
    ['Tipo com acento quebrado',           { tp: 'INSTALAÃ‡ÃƒO FIBRA', re: '0' },              'inst',       true]
  ];
  let falhas = 0;
  casos.forEach(c => {
    const r = classificarOS(c[1]);
    const ok = r.cat === c[2] && r.concl === c[3];
    if (!ok) falhas++;
    Logger.log((ok ? 'OK     ' : 'FALHOU ') + c[0] + ' | esperado: ' + c[2] + '/' + c[3] + ' | obtido: ' + r.cat + '/' + r.concl);
  });
  Logger.log(falhas ? 'RESULTADO: ' + falhas + ' caso(s) FALHARAM' : 'RESULTADO: todos os ' + casos.length + ' casos OK');
}

/** Testes das cores (nivelMeta, nivelDia e calcularNivel) com valores fixos. */
function testarNiveis() {
  const M = [3.5, 4.4, 5.5, 6.5];
  const casos = [
    ['nivelMeta 0 com metas',          () => nivelMeta(0, M),    'atencao'],
    ['nivelMeta 2,4 (Meta I - 1,1)',   () => nivelMeta(2.4, M),  'atencao'],
    ['nivelMeta 2,5 (Meta I - 1)',     () => nivelMeta(2.5, M),  'obs'],
    ['nivelMeta 3,4',                  () => nivelMeta(3.4, M),  'obs'],
    ['nivelMeta 3,5 (Meta I)',         () => nivelMeta(3.5, M),  'normal'],
    ['nivelMeta 4,3',                  () => nivelMeta(4.3, M),  'normal'],
    ['nivelMeta 4,4 (Meta II)',        () => nivelMeta(4.4, M),  'acima'],
    ['nivelMeta 9',                    () => nivelMeta(9, M),    'acima'],
    ['nivelDia 0',                     () => nivelDia(0),        'atencao'],
    ['nivelDia 2',                     () => nivelDia(2),        'atencao'],
    ['nivelDia 3',                     () => nivelDia(3),        'obs'],
    ['nivelDia 4',                     () => nivelDia(4),        'normal'],
    ['nivelDia 5',                     () => nivelDia(5),        'normal'],
    ['nivelDia 6',                     () => nivelDia(6),        'acima'],
    ['dia único sem meta, 3 concl.',   () => calcularNivel({ metas: null, diario: true, concl: 3, metaN: 4, metaO: 2 }),   'obs'],
    ['dia único sem meta, 7 concl.',   () => calcularNivel({ metas: null, diario: true, concl: 7, metaN: 4, metaO: 2 }),   'acima'],
    ['período longo sem meta, 5/8/2',  () => calcularNivel({ metas: null, diario: false, concl: 5, metaN: 8, metaO: 2 }),  'obs'],
    ['período longo sem meta, 9/8/2',  () => calcularNivel({ metas: null, diario: false, concl: 9, metaN: 8, metaO: 2 }),  'normal'],
    ['período longo sem meta, 1/8/2',  () => calcularNivel({ metas: null, diario: false, concl: 1, metaN: 8, metaO: 2 }),  'atencao'],
    ['com metas, média 4',             () => calcularNivel({ metas: M, diasMeta: 2, media: 4, concl: 8, diario: true }),  'normal'],
    ['com metas, sem dias produzidos', () => calcularNivel({ metas: M, diasMeta: 0, media: 0, concl: 0, diario: true }),   'atencao']
  ];
  let falhas = 0;
  casos.forEach(c => {
    const obtido = c[1]();
    const ok = obtido === c[2];
    if (!ok) falhas++;
    Logger.log((ok ? 'OK     ' : 'FALHOU ') + c[0] + ' | esperado: ' + c[2] + ' | obtido: ' + obtido);
  });
  Logger.log(falhas ? 'RESULTADO: ' + falhas + ' caso(s) FALHARAM' : 'RESULTADO: todos os ' + casos.length + ' casos OK');
}

/** Diagnóstico: selecione "testar", clique em Executar e abra o "Registro de execução". */
function testar() {
  ['hoje', 'mes', 'tudo'].forEach(per => {
    const r = montar({ periodo: per, login: LOGIN_TESTE.login, senha: LOGIN_TESTE.senha });
    Logger.log('--- ' + per + ': ' + r.periodo.rotulo + ' (' + r.periodo.iniBR + ' a ' + r.periodo.fimBR + ') | TOTAL Concl=' + r.tecnicos.reduce((a, t) => a + t.concl, 0));
  });

  const r = montar({ periodo: 'tudo', login: LOGIN_TESTE.login, senha: LOGIN_TESTE.senha });
  r.tecnicos.forEach(t => Logger.log([t.nome, 'ReabI=' + t.reabInst, 'ReabP=' + t.reabPend, 'Inst=' + t.inst, 'Pend=' + t.pend, 'Concl=' + t.concl].join(' | ')));

  // --- diagnóstico do sincronismo ---
  const s = lerSinc(SpreadsheetApp.getActiveSpreadsheet());
  const fmt = ms => ms ? Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') + ' (há ' + Math.round((Date.now() - ms) / 60000) + ' min)' : 'NÃO LIDO (confira a aba Sincronismo, célula B2/C2)';
  Logger.log('Sincronismo B2 (Encerramentos_Hoje): ' + fmt(s.hoje));
  Logger.log('Sincronismo C2 (Encerramentos): ' + fmt(s.base));

  // --- diagnóstico das abas ---
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [ABA_BASE, ABA_HOJE].forEach(nome => {
    const sh = ss.getSheetByName(nome);
    if (!sh) { Logger.log('Aba ' + nome + ' NÃO encontrada (confira o nome exato).'); return; }
    const v = sh.getDataRange().getValues();
    const cab = v[0].map(chave);
    Logger.log(nome + ': ' + (v.length - 1) + ' linhas | ' + v[0].length + ' colunas | Status na coluna ' + (cab.indexOf('status') + 1) + ' | Atendente na ' + (cab.indexOf('atendente') + 1));
    const iSt = cab.indexOf('status'), cont = {};
    v.slice(1).forEach(l => { const k = String(l[iSt]).slice(0, 25); cont[k] = (cont[k] || 0) + 1; });
    Logger.log(nome + ' - valores de Status: ' + JSON.stringify(cont).slice(0, 400));
  });
}

/** Diagnóstico dos tipos: mostra como cada "Tipo Solicitação" dos encerramentos foi classificado. */
function testarTipos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [ABA_BASE, ABA_HOJE].forEach(nome => {
    const a = lerAba(ss, nome), cont = {};
    a.rows.filter(x => x.st === 'ENCERRAMENTO').forEach(x => {
      const k = JSON.stringify(String(x.tp)) + ' -> ' + (ehInstalacaoFibra(x.tp) ? 'INSTALAÇÃO' : 'PENDÊNCIA');
      cont[k] = (cont[k] || 0) + 1;
    });
    Logger.log('=== ' + nome + ' (tipos dos ENCERRAMENTO) ===');
    Object.keys(cont).sort().forEach(k => Logger.log(cont[k] + 'x  ' + k));
  });
}

/** Diagnóstico do Backlog: mostra o total por empresa x categoria e as OS que caíram em "Outros". */
function testarBacklog() {
  const b = lerBacklog(SpreadsheetApp.getActiveSpreadsheet());
  if (!b.ok) { Logger.log('Backlog indisponível: ' + b.motivo); return; }
  const mat = {}, outros = {};
  b.itens.forEach(x => {
    const k = x.emp + ' | ' + x.cat;
    mat[k] = (mat[k] || 0) + 1;
    if (x.cat === 'outros') outros[x.tipo] = (outros[x.tipo] || 0) + 1;
  });
  Logger.log('OS abertas lidas: ' + b.itens.length + ' | em atraso: ' + b.itens.filter(x => x.atr).length + ' | em play: ' + b.itens.filter(x => x.play).length + ' | na fila: ' + b.itens.filter(x => x.fila).length);
  Object.keys(mat).sort().forEach(k => Logger.log(mat[k] + 'x  ' + k));
  Logger.log('Tipos que caíram em OUTROS: ' + JSON.stringify(outros));
  const s = lerSinc(SpreadsheetApp.getActiveSpreadsheet());
  Logger.log('Sincronismo A2 (Base_Abertos): ' + (s.abertos ? Utilities.formatDate(new Date(s.abertos), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') : 'vazio (opcional)'));
}

/** Diagnóstico do Play: mostra o status de cada técnico e as OS em execução. */
function testarPlay() {
  const r = montar({ periodo: 'hoje', login: LOGIN_TESTE.login, senha: LOGIN_TESTE.senha });
  Logger.log('Base_Abertos lida: ' + (r.abertosOk ? 'SIM' : 'NÃO (aba ausente ou sem colunas responsavel / em_play)'));
  r.tecnicos.forEach(t => {
    Logger.log([t.nome, t.play, 'ativo=' + t.ativo, 'produziu=' + t.produziu, 'agenda=' + t.agenda].concat(t.playItens.map(p => p.tipo + ' #' + p.protocolo + ' ' + p.cliente + ' (' + p.cidade + ')')).join(' | '));
  });
}

/**
 * Diagnóstico das instalações: para cada aba mostra, entre os ENCERRAMENTO de instalação,
 * quais valores existem na coluna Reabertura e para onde cada OS foi (Instalação ou Reab. Inst.).
 * Selecione "testarInstalacoes", clique em Executar e abra o Registro de execução.
 */
function testarInstalacoes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [ABA_BASE, ABA_HOJE].forEach(nome => {
    const a = lerAba(ss, nome);
    const enc = a.rows.filter(x => x.st === 'ENCERRAMENTO');
    const inst = enc.filter(x => ehInstalacaoFibra(x.tp));
    const cont = {};
    inst.forEach(x => { const k = JSON.stringify(x.re); cont[k] = (cont[k] || 0) + 1; });
    Logger.log('=== ' + nome + ': ' + enc.length + ' encerramentos | ' + inst.length + ' de instalação ===');
    Logger.log('Valores da coluna Reabertura nas instalações: ' + JSON.stringify(cont));
    const reab = inst.filter(x => Number(String(x.re).replace(',', '.')) === 1).length;
    Logger.log('-> vão para Instalação: ' + (inst.length - reab) + ' | vão para Reab. Inst.: ' + reab);
  });
}

/**
 * Diagnóstico da aba Encerramentos_Hoje: mostra o cabeçalho, os valores de Status e os
 * Tipos Solicitação (os 25 mais frequentes), com a classificação de cada um.
 */
function testarHoje() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(ABA_HOJE);
  if (!sh || sh.getLastRow() < 2) { Logger.log('Aba ' + ABA_HOJE + ' vazia ou não encontrada.'); return; }
  const v = sh.getDataRange().getValues();
  Logger.log('Cabeçalho: ' + JSON.stringify(v[0]));
  const cab = v[0].map(chave);
  const iSt = cab.indexOf('status'), iTp = cab.indexOf(chave('Tipo Solicitação'));
  Logger.log('Coluna Status = ' + (iSt + 1) + ' | Coluna Tipo Solicitação = ' + (iTp + 1) + ' | linhas = ' + (v.length - 1));
  const st = {}, tp = {};
  v.slice(1).forEach(r => {
    const a = up(r[iSt]); st[a] = (st[a] || 0) + 1;
    const k = JSON.stringify(String(r[iTp])) + ' -> ' + (ehInstalacaoFibra(r[iTp]) ? 'INSTALAÇÃO' : 'PENDÊNCIA');
    tp[k] = (tp[k] || 0) + 1;
  });
  Logger.log('Status: ' + JSON.stringify(st));
  Object.keys(tp).sort((a, b) => tp[b] - tp[a]).slice(0, 25).forEach(k => Logger.log(tp[k] + 'x  ' + k));
}

/** Diagnóstico dos concluídos: mostra as colunas de cliente/cidade/bairro lidas e um exemplo de OS por técnico. */
function testarConcluidos() {
  const r = montar({ periodo: 'hoje', login: LOGIN_TESTE.login, senha: LOGIN_TESTE.senha });
  r.tecnicos.slice(0, 5).forEach(t => {
    Logger.log(t.nome + ' | concl=' + t.concl + ' | itens=' + t.conclItens.length + ' | ex.: ' + JSON.stringify(t.conclItens[0] || null));
  });
}

/** Diagnóstico do login: confira se cada aba de usuários foi lida e quem tem login/senha preenchidos. */
function testarLogin() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [[ABA_COORD, 'coordenador'], [ABA_SUP, 'supervisor'], [ABA_TEC, 'tecnico']].forEach(g => {
    const l = lerUsuarios(ss, g[0]);
    const com = l.filter(u => u.login && u.senha);
    Logger.log(g[0] + ': ' + l.length + ' pessoas | ' + com.length + ' com login e senha | ' + l.filter(u => !u.ativo).length + ' inativas');
    com.forEach(u => Logger.log('   ' + u.login + ' -> ' + u.nome + (u.ativo ? '' : ' (INATIVO)')));
  });
  const r = autenticar(ss, LOGIN_TESTE.login, LOGIN_TESTE.senha);
  Logger.log('Teste com LOGIN_TESTE: ' + (r ? 'OK como ' + r.papel + ' (' + r.nome + ')' : 'FALHOU'));
}

/**
 * Diagnóstico de uma OS: mostra em qual aba ela está e por que entra (ou não) em Concluídos.
 * Troque o protocolo abaixo, selecione "testarProtocolo", clique em Executar e abra o Registro de execução.
 */
const PROTOCOLO_TESTE = '20263949575';
function testarProtocolo() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let achou = 0;
  [ABA_BASE, ABA_HOJE].forEach(nome => {
    const a = lerAba(ss, nome);
    a.rows.filter(x => x.cod.indexOf(PROTOCOLO_TESTE) >= 0).forEach(x => {
      achou++;
      const ehPC = ehPrestacaoContas(x.tp);
      let destino;
      if (x.st !== 'ENCERRAMENTO') destino = 'NÃO CONTA: Status = ' + JSON.stringify(x.st) + ' (precisa ser ENCERRAMENTO)';
      else if (ehReabertura(x)) destino = 'NÃO CONTA em Concluídos: Reabertura = 1 (vai para Reab. ' + (ehPC ? 'prest. contas' : ehInstalacaoFibra(x.tp) ? 'Inst.' : 'Pend.') + ')';
      else if (ehPC) destino = 'NÃO CONTA em Concluídos: tipo é prestação de contas / combustível';
      else destino = 'CONTA em Concluídos como ' + (ehInstalacaoFibra(x.tp) ? 'Instalação' : 'Pendência');
      const tec = lerUsuarios(ss, ABA_TEC).filter(u => nomeKey(u.nome) === nomeKey(x.at));
      Logger.log(nome + ' | Atendente=' + JSON.stringify(x.at) + (tec.length ? ' (encontrado na aba Técnicos)' : ' (NÃO encontrado na aba Técnicos!)') +
        ' | Status=' + JSON.stringify(x.st) + ' | Tipo=' + JSON.stringify(x.tp) + ' | Reabertura=' + JSON.stringify(x.re) +
        ' | Data=' + (x.dt ? br(x.dt) : 'sem data') + '\n   -> ' + destino);
    });
  });
  if (!achou) Logger.log('Protocolo ' + PROTOCOLO_TESTE + ' não encontrado em Encerramentos nem em Encerramentos_Hoje (confira a coluna Código).');
}

/** Diagnóstico das metas: mostra a aba Metas lida e o Tipo/meta de cada técnico. */
function testarMetas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mt = lerMetas(ss);
  Logger.log('Aba Metas lida: ' + (mt.ok ? 'SIM' : 'NÃO (confira o nome da aba e os valores Meta I a IV)'));
  Object.keys(mt.mapa).forEach(k => Logger.log('   ' + k + ' -> ' + mt.mapa[k].join(' / ')));
  const cfg = lerConfig(ss);
  Logger.log('Faixa usada no GAP: Meta ' + cfg.metaGap + ' | meta padrão (sem tipo): ' + cfg.metaPadrao);
  lerUsuarios(ss, ABA_TEC).forEach(u => {
    const m = mt.mapa[chave(u.tipo)];
    Logger.log(u.nome + ' | Tipo=' + JSON.stringify(u.tipo) + ' | ' + (m ? 'metas ' + m.join(' / ') : 'SEM META (tipo vazio ou fora da aba Metas)'));
  });
}

/** Diagnóstico das prioridades: mostra como a aba Prioridades foi lida e a situação de cada pedido (pendente, atendida, cancelada, sem registro). */
function testarPrioridades() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const pm = lerPrioridadesRaw(ss);
  if (!pm.ok) { Logger.log('Aba Prioridades: ' + pm.motivo); return; }
  Logger.log('Pedidos únicos lidos: ' + pm.n);
  const b = lerBacklogRaw(ss), sp = situacaoPrioridades(ss, pm, b, '');
  if (!sp.ok) { Logger.log('Não consegui cruzar com as bases.'); return; }
  const abertas = {}; (b.itens || []).forEach(x => { abertas[digitosOS(x.id)] = 1; });
  Logger.log('Pendentes (no backlog): ' + Object.keys(pm.mapa).filter(k => abertas[k]).length + ' | atendidas (30 dias): ' + sp.atend.length + ' | canceladas: ' + sp.cancel + ' | sem registro: ' + sp.semReg);
  sp.atend.slice(0, 15).forEach(a => Logger.log('  atendida ' + a.iso + ' #' + a.id + ' por ' + a.tec));
  sp.semRegItens.slice(0, 15).forEach(a => Logger.log('  sem registro #' + a.id + ' (' + a.pr.jus + ')'));
}

/** Diagnóstico da aba Controlador: quem tem login, qual equipe enxerga e quantos técnicos ativos há nela. */
function testarControlador() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), tecs = lerUsuarios(ss, ABA_TEC).filter(u => u.ativo);
  lerUsuarios(ss, ABA_CONTR).forEach(u => {
    const n = tecs.filter(t => nomeKey(t.ref) === nomeKey(u.ref)).length;
    Logger.log(u.nome + ' | equipe (supervisor): ' + u.ref + ' | ' + n + ' técnicos ativos' + (u.login && u.senha ? '' : ' | SEM login/senha: não consegue entrar') + (u.ativo ? '' : ' | INATIVO'));
  });
}

/* =====================================================================
 * GRAVAÇÃO SEGURA NO SERVIDOR (Etapas 1 a 5 do roteiro de configurações)
 * ---------------------------------------------------------------------
 * - Login devolve um TOKEN (CacheService, 6 h). As ações de configuração usam o token (POST), não repetem login e senha.
 * - Toda gravação entra por doPost (JSON). A permissão é conferida NO SERVIDOR a cada ação:
 *     coordenador : edita tudo (cadastros, Metas, Config) e envia arquivos
 *     supervisor  : edita só a própria equipe (técnicos e controladores dele), envia arquivos; não vê Metas/Config
 *     técnico / controlador : nenhuma gravação
 * - Toda gravação usa LockService e confere a VERSÃO da linha (hash dos valores). Linha mudou na planilha = recusa e pede para recarregar.
 * - Aba "Log_Alterações": data/hora, login, perfil, ação, aba, chave da linha, valor antigo, valor novo (senhas e código de acesso NUNCA vão para o log).
 * - Depois de gravar: limparCache(). Antes de substituir conteúdo: backup em aba oculta "Backup_<aba>" (só o último) com restauração.
 * - Leitura (doGet), classificação das OS, metas e login atuais não foram alterados.
 * ===================================================================== */
const ABA_LOG = 'Log_Alterações';
const TOKEN_TTL_S = 21600;                 // 6 h (máximo do CacheService)
const LOCK_ESPERA_MS = 25000;
const LOG_COLS = ['Data/hora', 'Login', 'Perfil', 'Ação', 'Aba', 'Chave da linha', 'Valor antigo', 'Valor novo'];
const GRUPOS_USR = [['coordenador', ABA_COORD], ['supervisor', ABA_SUP], ['controlador', ABA_CONTR], ['tecnico', ABA_TEC]];

// erro "de negócio": a mensagem (em português) vai direto para a tela
function ErroApp(msg, extra) { this.message = msg; this.extra = extra || {}; this.name = 'ErroApp'; }
ErroApp.prototype = Object.create(Error.prototype);
function erroResposta(err) {
  if (err instanceof ErroApp) return Object.assign({ ok: false, error: err.message }, err.extra);
  return { ok: false, error: 'Erro inesperado no servidor: ' + String(err && err.message || err) };
}

function doPost(e) {
  try {
    _SINC = null;
    let b = null;
    try { b = JSON.parse((e && e.postData && e.postData.contents) || ''); } catch (x) { b = null; }
    if (!b || typeof b !== 'object') throw new ErroApp('Pedido inválido.');
    return json(despachar(b));
  } catch (err) { return json(erroResposta(err)); }
}

/* ---------- sessão por token ---------- */
function criarToken(login) {
  const tk = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toLowerCase();   // 64 caracteres hexadecimais
  CacheService.getScriptCache().put('tk:' + tk, JSON.stringify({ l: chave(login), t: Date.now() }), TOKEN_TTL_S);
  return tk;
}
// usuário ativo (lido direto da planilha, sem cache) pelo login
function usuarioPorLogin(ss, login) {
  const l = chave(login); if (!l) return null;
  for (let g = 0; g < GRUPOS_USR.length; g++) {
    const lista = lerUsuariosRaw(ss, GRUPOS_USR[g][1]), p = GRUPOS_USR[g][0];
    for (let i = 0; i < lista.length; i++) {
      const u = lista[i];
      if (u.ativo && u.login && chave(u.login) === l) {
        return { papel: p, nome: u.nome, login: u.login,
          supervisor: p === 'tecnico' || p === 'controlador' ? u.ref : p === 'supervisor' ? u.nome : '',
          coordenador: p === 'supervisor' ? u.ref : p === 'coordenador' ? u.nome : '' };
      }
    }
  }
  return null;
}
function sessaoDe(ss, b) {
  const tk = String(b.token || '');
  if (!/^[0-9a-f]{64}$/.test(tk)) throw new ErroApp('Sessão expirada. Entre novamente.', { sessao: true });
  const raw = CacheService.getScriptCache().get('tk:' + tk);
  if (!raw) throw new ErroApp('Sessão expirada. Entre novamente.', { sessao: true });
  let info = null; try { info = JSON.parse(raw); } catch (x) {}
  const usr = info && usuarioPorLogin(ss, info.l);
  if (!usr) throw new ErroApp('Seu acesso foi desativado ou não existe mais.', { sessao: true });
  const cfg = lerConfigRaw(ss);
  if (cfg.codigo && String(b.codigo || '').trim() !== cfg.codigo) throw new ErroApp(b.codigo ? 'Código incorreto.' : 'Informe o código de acesso.', { auth: true });
  return { usr: usr, token: tk };
}
function exigirPerfil(usr, perfis) {
  if (perfis.indexOf(usr.papel) < 0) throw new ErroApp('Você não tem permissão para esta ação.', { permissao: true });
}

/* ---------- trava, versão, log, backup ---------- */
function comTrava(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_ESPERA_MS)) throw new ErroApp('Outra pessoa está gravando agora. Tente de novo em alguns segundos.');
  try { return fn(); } finally { try { lock.releaseLock(); } catch (x) {} }
}
function hex(bytes) { return bytes.map(b => ('0' + (b & 255).toString(16)).slice(-2)).join(''); }
// versão de uma linha (ou de qualquer lista de valores): muda se qualquer célula mudar
function versaoValores(vals) {
  const s = JSON.stringify(vals.map(v => v instanceof Date ? 'D' + v.getTime() : v == null ? '' : v));
  return hex(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8));
}
const MSG_CONFLITO = 'Esta linha foi alterada na planilha desde que a tela a carregou. Recarregue a lista e tente de novo.';
function erroConflito(msg) { return new ErroApp(msg || MSG_CONFLITO, { conflito: true }); }

function garantirLog(ss) {
  let sh = ss.getSheetByName(ABA_LOG);
  if (sh) return sh;
  sh = ss.insertSheet(ABA_LOG);
  sh.getRange(1, 1, 1, LOG_COLS.length).setValues([LOG_COLS]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.getRange('A:A').setNumberFormat('dd/MM/yyyy HH:mm:ss');
  return sh;
}
// texto seguro para o log: limita o tamanho e impede que vire fórmula na planilha
function txtLog(v) {
  let s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (s.length > 1500) s = s.slice(0, 1500) + '…';
  return /^[=+\-@]/.test(s) ? ' ' + s : s;
}
function linhaDeLog(usr, acao, aba, chaveLinha, antigo, novo, quando) {
  return [quando || new Date(), txtLog(usr.login), txtLog(usr.papel), txtLog(acao), txtLog(aba), txtLog(chaveLinha), txtLog(antigo), txtLog(novo)];
}
function registrarLog(ss, usr, acao, aba, chaveLinha, antigo, novo) {
  garantirLog(ss).appendRow(linhaDeLog(usr, acao, aba, chaveLinha, antigo, novo));
}
// descreve só os campos alterados; senha e código de acesso nunca aparecem (só "[alterada]")
const CAMPOS_SECRETOS = { senha: 1, codigo: 1 };
function descreverCampos(reg, campos) {
  return campos.map(k => k + ': ' + (CAMPOS_SECRETOS[k] ? '[oculta]' : reg[k] === true ? 'SIM' : reg[k] === false ? 'NÃO' : (reg[k] == null ? '' : reg[k]))).join('; ');
}

const nomeBackup = aba => 'Backup_' + aba;
/** Copia a aba para uma aba oculta "Backup_<aba>" (só o último backup de cada aba é guardado). */
function fazerBackup(ss, aba, extra) {
  const sh = ss.getSheetByName(aba);
  if (!sh) throw new ErroApp('A aba ' + aba + ' não foi encontrada.');
  const nome = nomeBackup(aba), antigo = ss.getSheetByName(nome);
  if (antigo) ss.deleteSheet(antigo);
  const c = sh.copyTo(ss); c.setName(nome); c.hideSheet();
  try { PropertiesService.getScriptProperties().setProperty('bk:' + aba, JSON.stringify(Object.assign({ t: Date.now() }, extra || {}))); } catch (x) {}
  return c;
}
function infoBackup(ss, aba) {
  if (!ss.getSheetByName(nomeBackup(aba))) return null;
  let m = null; try { m = JSON.parse(PropertiesService.getScriptProperties().getProperty('bk:' + aba) || 'null'); } catch (x) {}
  return { t: m && m.t || null, login: m && m.login || '', acao: m && m.acao || '', modo: m && m.modo || '' };
}
/** Devolve o conteúdo do último backup para a aba (substitui o conteúdo atual). */
function restaurarBackup(ss, aba) {
  const bk = ss.getSheetByName(nomeBackup(aba)), sh = ss.getSheetByName(aba);
  if (!bk) throw new ErroApp('Não há backup da aba ' + aba + '.');
  if (!sh) throw new ErroApp('A aba ' + aba + ' não foi encontrada.');
  const lr = bk.getLastRow(), lc = bk.getLastColumn();
  sh.clearContents();
  if (lr > 0 && lc > 0) bk.getRange(1, 1, lr, lc).copyTo(sh.getRange(1, 1));
}
function garantirTamanho(sh, linhas, colunas) {
  if (linhas > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), linhas - sh.getMaxRows());
  if (colunas > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), colunas - sh.getMaxColumns());
}
// grava texto sem deixar a planilha converter (zeros à esquerda, datas, números, fórmulas)
function gravarTexto(sh, linha, coluna, v) { garantirTamanho(sh, linha, coluna); sh.getRange(linha, coluna).setNumberFormat('@').setValue(String(v == null ? '' : v)); }

/* ---------- despacho das ações (todas por POST) ---------- */
const ACOES = {
  cad_listar:      { perfis: ['coordenador', 'supervisor'], fn: acaoCadListar },
  cad_salvar:      { perfis: ['coordenador', 'supervisor'], fn: acaoCadSalvar, grava: true },
  cad_ativo:       { perfis: ['coordenador', 'supervisor'], fn: acaoCadAtivo, grava: true },
  metas_listar:    { perfis: ['coordenador'], fn: acaoMetasListar },
  metas_salvar:    { perfis: ['coordenador'], fn: acaoMetasSalvar, grava: true },
  metas_remover:   { perfis: ['coordenador'], fn: acaoMetasRemover, grava: true },
  config_ler:      { perfis: ['coordenador'], fn: acaoConfigLer },
  config_salvar:   { perfis: ['coordenador'], fn: acaoConfigSalvar, grava: true },
  envio_info:      { perfis: ['coordenador', 'supervisor'], fn: acaoEnvioInfo },
  envio_iniciar:   { perfis: ['coordenador', 'supervisor'], fn: acaoEnvioIniciar, grava: true, semCache: true },
  envio_lote:      { perfis: ['coordenador', 'supervisor'], fn: acaoEnvioLote, grava: true, semCache: true },
  envio_previa:    { perfis: ['coordenador', 'supervisor'], fn: acaoEnvioPrevia },
  envio_confirmar: { perfis: ['coordenador', 'supervisor'], fn: acaoEnvioConfirmar, grava: true },
  envio_cancelar:  { perfis: ['coordenador', 'supervisor'], fn: acaoEnvioCancelar, grava: true, semCache: true },
  envio_desfazer:  { perfis: ['coordenador', 'supervisor'], fn: acaoEnvioDesfazer, grava: true },
  prio_listar:     { perfis: ['coordenador', 'supervisor'], fn: acaoPrioListar },
  prio_salvar:     { perfis: ['coordenador', 'supervisor'], fn: acaoPrioSalvar, grava: true },
  escala_listar:   { perfis: ['coordenador', 'supervisor'], fn: acaoEscalaListar },
  escala_salvar:   { perfis: ['coordenador', 'supervisor'], fn: acaoEscalaSalvar, grava: true },
  escala_novo:     { perfis: ['coordenador', 'supervisor'], fn: acaoEscalaNovo, grava: true }
};
function despachar(b) {
  const acao = String(b.acao || '');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (acao === 'login') {                                          // entrada por POST: login e senha vão no corpo, não na URL
    const u = autenticar(ss, b.login, b.senha);
    if (!u) return negaLogin();
    registrarAcesso(chave(b.login), true);
    return { ok: true, usuario: usuarioPublico(u), token: criarToken(b.login) };
  }
  if (acao === 'logout') { try { CacheService.getScriptCache().remove('tk:' + String(b.token || '')); } catch (x) {} return { ok: true }; }
  const def = ACOES[acao];
  if (!def) throw new ErroApp('Ação desconhecida.');
  const s = sessaoDe(ss, b);
  exigirPerfil(s.usr, def.perfis);                                 // permissão SEMPRE no servidor, nunca só escondendo botões
  if (!def.grava) return def.fn(ss, s.usr, b);
  try { return comTrava(() => def.fn(ss, s.usr, b)); }
  finally { if (!def.semCache) limparCache(); }                    // a mudança vale na hora
}

/* =====================================================================
 * CADASTROS (Etapa 2): Técnicos, Controladores, Supervisores e Coordenadores
 * ===================================================================== */
const CAD = {
  tecnico:     { aba: ABA_TEC,   rot: 'Técnico',     refRot: 'Supervisor',  refAba: ABA_SUP,   temTipo: true,  nomeCab: ['tecnico', 'tecnicos', 'nome'], refCab: ['supervisor'] },
  controlador: { aba: ABA_CONTR, rot: 'Controlador', refRot: 'Supervisor',  refAba: ABA_SUP,   temTipo: false, nomeCab: ['controlador', 'nome'],         refCab: ['supervisor'] },
  supervisor:  { aba: ABA_SUP,   rot: 'Supervisor',  refRot: 'Coordenador', refAba: ABA_COORD, temTipo: false, nomeCab: ['supervisor', 'nome'],          refCab: ['coordenador'] },
  coordenador: { aba: ABA_COORD, rot: 'Coordenador', refRot: 'CEO',         refAba: '',        temTipo: false, nomeCab: ['coordenador', 'nome'],         refCab: ['ceo'] }
};
function defCad(k) { const d = CAD[String(k || '')]; if (!d) throw new ErroApp('Cadastro desconhecido.'); return d; }
// mesma lógica de colunas de lerUsuariosRaw: pelo nome do cabeçalho, com a posição como alternativa
function colunasCad(def, cab) {
  const k = cab.map(chaveH);
  const ix = (nomes, fb) => { for (let i = 0; i < nomes.length; i++) { const p = k.indexOf(nomes[i]); if (p >= 0) return p; } return fb; };
  return { nome: ix(def.nomeCab, 0), ref: ix(def.refCab, 1), login: ix(['login', 'usuario'], 2), senha: ix(['senha'], 3), ativo: ix(['ativo', 'ativa'], 4), tipo: def.temTipo ? ix(['tipo'], -1) : -1 };
}
const textoCel = v => String(v == null ? '' : v).trim();
function regDe(r, ix) {
  return { nome: corrigeTexto(r[ix.nome]).trim(), ref: corrigeTexto(r[ix.ref]).trim(), tipo: ix.tipo >= 0 ? corrigeTexto(r[ix.tipo]).trim() : '',
           login: textoCel(r[ix.login]), senha: textoCel(r[ix.senha]), ativo: ehAtivo(r[ix.ativo]) };
}
/** Lê a aba de cadastro direto da planilha: [{ linha (1 = cabeçalho), versao, reg }]. */
function lerLinhasCad(ss, cadKey) {
  const def = defCad(cadKey), sh = ss.getSheetByName(def.aba);
  if (!sh) throw new ErroApp('A aba ' + def.aba + ' não foi encontrada.');
  const v = sh.getLastRow() < 1 ? [] : sh.getDataRange().getValues();
  if (!v.length) throw new ErroApp('A aba ' + def.aba + ' está sem cabeçalho.');
  const ix = colunasCad(def, v[0]), linhas = [];
  let ultima = 1;
  for (let i = 1; i < v.length; i++) {
    const reg = regDe(v[i], ix);
    if (!reg.nome) continue;
    ultima = i + 1;
    linhas.push({ linha: i + 1, versao: versaoValores(v[i]), reg: reg });
  }
  return { def: def, sh: sh, ix: ix, largura: v[0].length, linhas: linhas, proxima: ultima + 1 };
}
function nomesAtivos(ss, aba) { return lerUsuariosRaw(ss, aba).filter(u => u.ativo).map(u => u.nome); }
function tiposDeMetas(ss) {
  const sh = ss.getSheetByName(ABA_METAS);
  if (!sh || sh.getLastRow() < 2) return [];
  const vistos = {}, out = [];
  sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(r => { const n = corrigeTexto(r[0]).trim(), k = chave(n); if (n && !vistos[k]) { vistos[k] = 1; out.push(n); } });
  return out;
}

// quem pode ver / editar o quê (testado em testarPermissoes)
function podeVerCad(usr, cadKey) {
  if (usr.papel === 'coordenador') return true;
  return usr.papel === 'supervisor' && (cadKey === 'tecnico' || cadKey === 'controlador');
}
function ehDaEquipe(usr, reg) { return usr.papel === 'supervisor' && !!usr.nome && nomeKey(reg.ref) === nomeKey(usr.nome); }
function podeEditarRegistro(usr, cadKey, reg) {
  if (!podeVerCad(usr, cadKey)) return false;
  if (usr.papel === 'coordenador') return true;
  return !!reg && ehDaEquipe(usr, reg);              // supervisor: só técnicos/controladores vinculados a ele
}
function exigirVerCad(usr, cadKey) { if (!podeVerCad(usr, cadKey)) throw new ErroApp('Você não tem permissão para este cadastro.', { permissao: true }); }

function acaoCadListar(ss, usr, b) {
  const cadKey = String(b.cad || ''), def = defCad(cadKey);
  exigirVerCad(usr, cadKey);
  const L = lerLinhasCad(ss, cadKey);
  const linhas = L.linhas.filter(x => podeEditarRegistro(usr, cadKey, x.reg))
    .map(x => ({ linha: x.linha, versao: x.versao, nome: x.reg.nome, ref: x.reg.ref, tipo: x.reg.tipo, login: x.reg.login, senha: x.reg.senha, ativo: x.reg.ativo }));
  const refs = def.refAba ? (usr.papel === 'supervisor' ? [usr.nome] : nomesAtivos(ss, def.refAba)) : [];
  return { ok: true, cad: cadKey, rot: def.rot, refRot: def.refRot, refLista: def.refAba ? true : false, refs: refs,
           temTipo: def.temTipo && L.ix.tipo >= 0, tipos: def.temTipo ? tiposDeMetas(ss) : [], linhas: linhas, equipeFixa: usr.papel === 'supervisor' ? usr.nome : '' };
}
function normalizarDadosCad(d) {
  d = d || {};
  return { nome: textoCel(d.nome), ref: textoCel(d.ref), tipo: textoCel(d.tipo), login: textoCel(d.login), senha: textoCel(d.senha),
           ativo: d.ativo === false || nomeKey(d.ativo) === 'NAO' ? false : true };
}
function loginEmUso(ss, login, abaIgnorar, linhaIgnorar) {
  const l = chave(login); if (!l) return false;
  for (let g = 0; g < GRUPOS_USR.length; g++) {
    const aba = GRUPOS_USR[g][1], sh = ss.getSheetByName(aba);
    if (!sh || sh.getLastRow() < 2) continue;
    const v = sh.getDataRange().getValues(), cab = v[0].map(chaveH);
    let iLog = cab.indexOf('login'); if (iLog < 0) iLog = cab.indexOf('usuario'); if (iLog < 0) iLog = 2;
    for (let i = 1; i < v.length; i++) {
      if (aba === abaIgnorar && i + 1 === linhaIgnorar) continue;
      if (chave(textoCel(v[i][iLog])) === l) return true;
    }
  }
  return false;
}
/**
 * Núcleo da gravação de cadastro. patch = só os campos a mudar (cad_ativo) ou todos (cad_salvar).
 * Roda dentro da trava. Confere permissão, versão da linha e todas as validações antes de escrever.
 */
function gravarCadastro(ss, usr, cadKey, b, patch, acaoLog) {
  const def = defCad(cadKey);
  exigirVerCad(usr, cadKey);
  const L = lerLinhasCad(ss, cadKey), linha = b.linha ? Number(b.linha) : 0;
  let atual = null;
  if (linha) {
    const x = L.linhas.find(y => y.linha === linha);
    if (!x) throw erroConflito('Esta linha não existe mais na planilha. Recarregue a lista.');
    if (String(b.versao || '') !== x.versao) throw erroConflito();
    if (!podeEditarRegistro(usr, cadKey, x.reg)) throw new ErroApp('Você só pode editar pessoas da sua própria equipe.', { permissao: true });
    atual = x.reg;
  }
  const novo = Object.assign({}, atual || { nome: '', ref: '', tipo: '', login: '', senha: '', ativo: true }, patch);
  if (usr.papel === 'supervisor') {                    // equipe sempre a dele, mesmo que a tela tente outra
    if (!atual && patch.ref && nomeKey(patch.ref) !== nomeKey(usr.nome)) throw new ErroApp('Você só pode cadastrar pessoas na sua própria equipe.', { permissao: true });
    if (atual && patch.ref != null && nomeKey(patch.ref) !== nomeKey(atual.ref)) throw new ErroApp('Você não pode mudar a pessoa para outra equipe.', { permissao: true });
    novo.ref = atual ? atual.ref : usr.nome;
  }
  // ---- validações ----
  if (!nomeKey(novo.nome)) throw new ErroApp('Informe o nome.');
  if (novo.nome.length > 120) throw new ErroApp('O nome está muito longo.');
  if (!atual || nomeKey(novo.nome) !== nomeKey(atual.nome)) {
    if (L.linhas.some(y => y.linha !== linha && nomeKey(y.reg.nome) === nomeKey(novo.nome))) throw new ErroApp('Já existe alguém com esse nome nesta aba.');
  }
  if (/\s/.test(novo.login)) throw new ErroApp('O login não pode ter espaços.');
  if (novo.login.length > 60) throw new ErroApp('O login está muito longo.');
  if (!!novo.login !== !!novo.senha) throw new ErroApp('Preencha login e senha juntos (ou deixe os dois vazios).');
  if (novo.login && (!atual || chave(novo.login) !== chave(atual.login)) && loginEmUso(ss, novo.login, def.aba, linha)) throw new ErroApp('Esse login já está em uso em outra pessoa.');
  if (def.refAba) {
    if (!novo.ref) throw new ErroApp('Escolha o ' + def.refRot.toLowerCase() + '.');
    const mudou = !atual || nomeKey(novo.ref) !== nomeKey(atual.ref);
    if (mudou && !nomesAtivos(ss, def.refAba).some(n => nomeKey(n) === nomeKey(novo.ref))) throw new ErroApp(def.refRot + ' não existe ou está inativo.');
  }
  if (def.temTipo && L.ix.tipo >= 0 && novo.tipo && (!atual || chave(novo.tipo) !== chave(atual.tipo)) && !tiposDeMetas(ss).some(t => chave(t) === chave(novo.tipo))) throw new ErroApp('Tipo inexistente na aba Metas.');
  if (atual && !novo.ativo && atual.ativo && usr.login && chave(atual.login) === chave(usr.login)) throw new ErroApp('Você não pode desativar o seu próprio acesso.');
  // ---- o que mudou ----
  const campos = ['nome', 'ref', 'tipo', 'login', 'senha', 'ativo'].filter(k => k !== 'tipo' || (def.temTipo && L.ix.tipo >= 0));
  const mudados = atual ? campos.filter(k => (k === 'ativo' ? novo.ativo !== atual.ativo : novo[k] !== atual[k])) : campos;
  if (atual && !mudados.length) return { ok: true, semMudanca: true, linha: linha, versao: String(b.versao) };
  // ---- gravação (só as células que mudaram; o resto da linha, colunas extras e fórmulas, fica como está) ----
  garantirLog(ss);
  const alvo = linha || L.proxima;
  const colunaDe = { nome: L.ix.nome, ref: L.ix.ref, tipo: L.ix.tipo, login: L.ix.login, senha: L.ix.senha, ativo: L.ix.ativo };
  mudados.forEach(k => { if (colunaDe[k] >= L.largura && (k === 'ativo' || k === 'login' || k === 'senha')) throw new ErroApp('A aba ' + def.aba + ' não tem a coluna ' + (k === 'ativo' ? 'Ativo' : k === 'login' ? 'Login' : 'Senha') + '.'); });
  mudados.forEach(k => {
    if (k === 'ativo') { garantirTamanho(L.sh, alvo, colunaDe.ativo + 1); L.sh.getRange(alvo, colunaDe.ativo + 1).setValue(novo.ativo ? 'SIM' : 'NÃO'); }
    else gravarTexto(L.sh, alvo, colunaDe[k] + 1, novo[k]);
  });
  const dep = L.sh.getRange(alvo, 1, 1, L.largura).getValues()[0];
  registrarLog(ss, usr, acaoLog || (atual ? 'editar' : 'adicionar'), def.aba, novo.nome + ' (linha ' + alvo + ')', atual ? descreverCampos(atual, mudados) : '', descreverCampos(novo, mudados));
  return { ok: true, linha: alvo, versao: versaoValores(dep), novo: !atual };
}
function acaoCadSalvar(ss, usr, b) {
  const d = normalizarDadosCad(b.dados), cadKey = String(b.cad || ''), def = defCad(cadKey);
  const patch = { nome: d.nome, ref: d.ref, login: d.login, senha: d.senha, ativo: d.ativo };
  if (def.temTipo) patch.tipo = d.tipo;
  return gravarCadastro(ss, usr, cadKey, b, patch, b.linha ? 'editar' : 'adicionar');
}
function acaoCadAtivo(ss, usr, b) {
  if (!b.linha) throw new ErroApp('Linha inválida.');
  const ativo = b.ativo === true || b.ativo === 'true';
  return gravarCadastro(ss, usr, String(b.cad || ''), b, { ativo: ativo }, ativo ? 'ativar' : 'desativar');
}

/* =====================================================================
 * METAS e CONFIG (Etapa 3): só coordenador
 * ===================================================================== */
function acaoMetasListar(ss, usr, b) {
  const sh = ss.getSheetByName(ABA_METAS);
  if (!sh) throw new ErroApp('A aba ' + ABA_METAS + ' não foi encontrada.');
  const v = sh.getLastRow() < 1 ? [] : sh.getDataRange().getValues();
  const tecs = lerUsuariosRaw(ss, ABA_TEC), itens = [];
  for (let i = 1; i < v.length; i++) {
    const tipo = corrigeTexto(v[i][0]).trim(); if (!tipo) continue;
    const usam = tecs.filter(t => chave(t.tipo) === chave(tipo));
    itens.push({ linha: i + 1, versao: versaoValores(v[i]), tipo: tipo, v: [1, 2, 3, 4].map(j => v[i][j] == null ? '' : v[i][j]),
                 usamAtivos: usam.filter(t => t.ativo).length, usamTotal: usam.length });
  }
  return { ok: true, itens: itens, backup: infoBackup(ss, ABA_METAS) };
}
const fmtNumPT = n => String(Math.round(n * 100) / 100).replace('.', ',');
function validarMetaValores(vals, tipo) {
  const out = [];
  for (let j = 0; j < 4; j++) {
    const n = numPT(vals[j]);
    if (n == null || String(vals[j] == null ? '' : vals[j]).trim() === '') throw new ErroApp('Preencha todas as metas de "' + tipo + '".');
    if (n < 0 || n > 1000) throw new ErroApp('Meta fora do intervalo permitido em "' + tipo + '".');
    out.push(Math.round(n * 100) / 100);
  }
  for (let j = 1; j < 4; j++) if (out[j] < out[j - 1]) throw new ErroApp('Em "' + tipo + '" é preciso Meta I ≤ Meta II ≤ Meta III ≤ Meta IV.');
  return out;
}
function acaoMetasSalvar(ss, usr, b) {
  const sh = ss.getSheetByName(ABA_METAS);
  if (!sh) throw new ErroApp('A aba ' + ABA_METAS + ' não foi encontrada.');
  const itens = Array.isArray(b.itens) ? b.itens : [];
  if (!itens.length) throw new ErroApp('Nada para salvar.');
  const v = sh.getLastRow() < 1 ? [] : sh.getDataRange().getValues();
  let ultima = 1; for (let i = 1; i < v.length; i++) if (corrigeTexto(v[i][0]).trim()) ultima = i + 1;
  const tiposAtuais = {}; for (let i = 1; i < v.length; i++) { const t = corrigeTexto(v[i][0]).trim(); if (t) tiposAtuais[chave(t)] = i + 1; }
  const plano = [], novos = {}; let prox = ultima + 1;
  itens.forEach(it => {
    const tipo = corrigeTexto(it.tipo).trim(), k = chave(tipo);
    if (!tipo) throw new ErroApp('Informe o nome do tipo.');
    if (tipo.length > 60) throw new ErroApp('O nome do tipo está muito longo.');
    const vals = validarMetaValores(it.v || [], tipo), linha = it.linha ? Number(it.linha) : 0;
    if (linha) {
      const r = v[linha - 1];
      if (!r || chave(corrigeTexto(r[0])) !== k) throw erroConflito('O tipo "' + tipo + '" mudou na planilha. Recarregue a lista.');
      if (String(it.versao || '') !== versaoValores(r)) throw erroConflito('O tipo "' + tipo + '" foi alterado na planilha. Recarregue a lista e tente de novo.');
      plano.push({ linha: linha, tipo: tipo, vals: vals, antigo: [1, 2, 3, 4].map(j => r[j]), novo: false });
    } else {
      if (tiposAtuais[k] || novos[k]) throw new ErroApp('Já existe o tipo "' + tipo + '".');
      novos[k] = 1;
      plano.push({ linha: prox++, tipo: tipo, vals: vals, antigo: null, novo: true });
    }
  });
  garantirLog(ss);
  plano.forEach(p => {
    if (p.novo) gravarTexto(sh, p.linha, 1, p.tipo);
    garantirTamanho(sh, p.linha, 5);
    sh.getRange(p.linha, 2, 1, 4).setValues([p.vals]);
    registrarLog(ss, usr, p.novo ? 'metas: adicionar tipo' : 'metas: editar', ABA_METAS, p.tipo + ' (linha ' + p.linha + ')',
      p.antigo ? 'I-IV: ' + p.antigo.join(' / ') : '', 'I-IV: ' + p.vals.map(fmtNumPT).join(' / '));
  });
  return { ok: true, gravados: plano.length };
}
function acaoMetasRemover(ss, usr, b) {
  const sh = ss.getSheetByName(ABA_METAS);
  if (!sh) throw new ErroApp('A aba ' + ABA_METAS + ' não foi encontrada.');
  const linha = Number(b.linha) || 0, v = sh.getLastRow() < 1 ? [] : sh.getDataRange().getValues(), r = v[linha - 1];
  if (!linha || linha < 2 || !r || !corrigeTexto(r[0]).trim()) throw erroConflito('O tipo não existe mais na planilha. Recarregue a lista.');
  if (String(b.versao || '') !== versaoValores(r)) throw erroConflito('O tipo foi alterado na planilha. Recarregue a lista e tente de novo.');
  const tipo = corrigeTexto(r[0]).trim();
  const usam = lerUsuariosRaw(ss, ABA_TEC).filter(t => chave(t.tipo) === chave(tipo));
  if (usam.length && !b.confirmo) throw new ErroApp(usam.length + ' técnico(s) usam o tipo "' + tipo + '". Confirme a remoção.', { precisaConfirmar: true, usam: usam.length });
  garantirLog(ss);
  fazerBackup(ss, ABA_METAS, { login: usr.login, acao: 'remover tipo' });
  sh.deleteRow(linha);
  registrarLog(ss, usr, 'metas: remover tipo', ABA_METAS, tipo + ' (linha ' + linha + ')', 'I-IV: ' + [1, 2, 3, 4].map(j => r[j]).join(' / ') + '; técnicos que usavam: ' + usam.length, '');
  return { ok: true, usavam: usam.length };
}

// campos da aba Config (nome | valor). A tela só mexe nestes; qualquer outra linha da aba fica como está.
const CFG_CAMPOS = [
  { k: 'codigo',     nome: 'Código de acesso',          cab: 'codigo de acesso',          tipo: 'texto' },
  { k: 'metaNormal', nome: 'Meta normal (por dia)',     cab: 'meta normal (por dia)',     tipo: 'num' },
  { k: 'metaObs',    nome: 'Meta observação (por dia)', cab: 'meta observacao (por dia)', tipo: 'num' },
  { k: 'metaGap',    nome: 'Meta do gap (1 a 4)',       cab: 'meta do gap (1 a 4)',       tipo: 'gap' },
  { k: 'metaPadrao', nome: 'Meta padrao (por dia)',     cab: 'meta padrao (por dia)',     tipo: 'num' },
  { k: 'titulo',     nome: 'Titulo',                    cab: 'titulo',                    tipo: 'texto' },
  { k: 'subtitulo',  nome: 'Subtitulo',                 cab: 'subtitulo',                 tipo: 'texto' },
  { k: 'expedIni',   nome: 'Inicio expediente',         cab: 'inicio expediente',         tipo: 'hora' },
  { k: 'expedFim',   nome: 'Fim expediente',            cab: 'fim expediente',            tipo: 'hora' }
];
function lerConfigSheet(ss) {
  const sh = ss.getSheetByName(ABA_CFG);
  if (!sh) throw new ErroApp('A aba ' + ABA_CFG + ' não foi encontrada.');
  const v = sh.getLastRow() < 1 ? [] : sh.getRange(1, 1, sh.getLastRow(), 2).getValues();
  const linhas = {}; let ultima = 1;
  for (let i = 1; i < v.length; i++) { const k = chave(v[i][0]); if (k) { if (!linhas[k]) linhas[k] = i + 1; ultima = i + 1; } else if (v[i][1] !== '') ultima = i + 1; }
  return { sh: sh, v: v, linhas: linhas, proxima: ultima + 1, versao: versaoValores([].concat.apply([], v)) };
}
function valorCfgTela(ss, c, bruto) {
  if (bruto == null) return '';
  if (c.tipo === 'hora') return horaCfg(ss, bruto, '');
  return bruto instanceof Date ? '' : String(bruto).trim();
}
function acaoConfigLer(ss, usr, b) {
  const C = lerConfigSheet(ss), campos = CFG_CAMPOS.map(c => {
    const l = C.linhas[c.cab];
    return { k: c.k, nome: c.nome, tipo: c.tipo, existe: !!l, valor: l ? valorCfgTela(ss, c, C.v[l - 1][1]) : '' };
  });
  return { ok: true, versao: C.versao, campos: campos };
}
function validarCfgValor(c, valor) {
  const t = String(valor == null ? '' : valor).trim();
  if (c.tipo === 'texto') { if (c.k === 'titulo' && !t) throw new ErroApp('Informe o título.'); if (t.length > 200) throw new ErroApp('Texto muito longo em "' + c.nome + '".'); return t; }
  if (c.tipo === 'hora') {
    const m = t.match(/^(\d{1,2}):(\d{2})$/);
    if (!m || +m[1] > 23 || +m[2] > 59) throw new ErroApp('Horário inválido em "' + c.nome + '". Use HH:MM (ex.: 08:00).');
    return ('0' + m[1]).slice(-2) + ':' + m[2];
  }
  const n = numPT(t);
  if (n == null || t === '') throw new ErroApp('Informe um número válido em "' + c.nome + '".');
  if (c.tipo === 'gap') { if (n !== Math.round(n) || n < 1 || n > 4) throw new ErroApp('"' + c.nome + '" precisa ser 1, 2, 3 ou 4.'); return n; }
  if (n < 0 || n > 1000) throw new ErroApp('Valor fora do intervalo em "' + c.nome + '".');
  return Math.round(n * 100) / 100;
}
function acaoConfigSalvar(ss, usr, b) {
  const C = lerConfigSheet(ss);
  if (String(b.versao || '') !== C.versao) throw erroConflito('A aba Config foi alterada na planilha desde que a tela a carregou. Recarregue e tente de novo.');
  const val = b.valores || {}, mudancas = [];
  CFG_CAMPOS.forEach(c => {
    if (!(c.k in val)) return;
    const novo = validarCfgValor(c, val[c.k]), l = C.linhas[c.cab];
    const antigo = l ? valorCfgTela(ss, c, C.v[l - 1][1]) : '';
    const igual = c.tipo === 'num' || c.tipo === 'gap' ? (antigo !== '' && numPT(antigo) === novo) : String(novo) === antigo;
    if (!igual) mudancas.push({ c: c, novo: novo, antigo: antigo, linha: l || 0 });
  });
  const cfgDe = k => CFG_CAMPOS.find(c => c.k === k);
  const final = k => { const m = mudancas.find(x => x.c.k === k); if (m) return m.novo; const l = C.linhas[cfgDe(k).cab]; return l ? valorCfgTela(ss, cfgDe(k), C.v[l - 1][1]) : ''; };
  if ((final('expedIni') || '08:00') >= (final('expedFim') || '18:00')) throw new ErroApp('O início do expediente precisa ser antes do fim.');
  if (mudancas.some(m => m.c.k === 'codigo') && !b.confirmoCodigo) throw new ErroApp('Mudar o código de acesso exige confirmação: todos precisarão do novo código.', { precisaConfirmar: true });
  if (!mudancas.length) return { ok: true, semMudanca: true, versao: C.versao };
  garantirLog(ss);
  let prox = C.proxima;
  mudancas.forEach(m => {
    const l = m.linha || prox++;
    if (!m.linha) gravarTexto(C.sh, l, 1, m.c.nome);
    if (m.c.tipo === 'texto' || m.c.tipo === 'hora') gravarTexto(C.sh, l, 2, m.novo);
    else { garantirTamanho(C.sh, l, 2); C.sh.getRange(l, 2).setValue(m.novo); }
    const seg = m.c.k === 'codigo';
    registrarLog(ss, usr, 'config: editar', ABA_CFG, m.c.nome, seg ? '[oculto]' : m.antigo, seg ? '[alterado]' : m.novo);
  });
  const nova = lerConfigSheet(ss);
  return { ok: true, versao: nova.versao, gravados: mudancas.length };
}

/* =====================================================================
 * ENVIO DE ARQUIVOS (Etapa 4): Encerramentos, Encerramentos_Hoje e Base_Abertos
 * ---------------------------------------------------------------------
 * Fluxo (tudo por POST, em lotes):  envio_iniciar -> envio_lote (vários) -> envio_previa -> envio_confirmar  (ou envio_cancelar)
 *  - Os lotes vão para a aba temporária oculta "Temp_Envio_<aba>". A aba verdadeira só é tocada em envio_confirmar,
 *    quando TODOS os lotes chegaram certos. Se a conexão cair antes, a aba atual fica intacta.
 *  - No confirmar: backup automático (aba oculta Backup_<aba>), troca do conteúdo, carimbo do Sincronismo, log e limpeza do cache.
 *    Se a gravação falhar no meio, o backup é restaurado sozinho. "Desfazer último envio" restaura o backup.
 *  - Protocolo: comparado só pelos dígitos (sem espaços, sem zeros à esquerda). Notação científica ou sem dígitos = inválido.
 *  - Colunas com FÓRMULA na linha 2 da aba são preservadas: o envio não escreve nelas e repete a fórmula nas linhas novas.
 *  - Datas: a coluna de destino manda. Se a aba guarda data de verdade, grava data; se guarda texto, grava texto.
 * ===================================================================== */
const OBRIG_ENC = ['Atendente', 'Status', 'Tipo Solicitação', 'Reabertura', 'Código'];
const ENVIO = {};
ENVIO[ABA_BASE]    = { obrig: OBRIG_ENC, prot: 'Código', modos: ['acrescentar', 'substituir'], padrao: 'acrescentar', carimbo: 'C2' };
ENVIO[ABA_HOJE]    = { obrig: OBRIG_ENC, prot: 'Código', modos: ['substituir', 'acrescentar', 'mesclar'], padrao: 'substituir', carimbo: 'B2' };
ENVIO[ABA_ABERTOS] = { obrig: ['responsavel', 'tipo_solicitacao', 'protocolo_novo', 'em_atraso'], prot: 'protocolo_novo', modos: ['substituir', 'acrescentar', 'mesclar'], padrao: 'substituir', carimbo: 'A2' };
const ENVIO_MAX_LINHAS = 100000;
const ENVIO_TTL_S = 21600;
const tempNome = aba => 'Temp_Envio_' + aba;

function envioDef(aba) { const d = ENVIO[String(aba || '')]; if (!d) throw new ErroApp('Aba inválida para envio.'); return d; }
function colDe(cab, nome) { return cab.map(chaveH).indexOf(chaveH(nome)); }

/** Protocolo -> { ok, key (só dígitos, sem zeros à esquerda), motivo }. */
function normalizarProtocolo(v) {
  if (v == null || v === '') return { ok: false, motivo: 'sem dígitos' };
  if (v instanceof Date) return { ok: false, motivo: 'sem dígitos' };
  if (typeof v === 'number') {
    if (Number.isInteger(v) && v > 0 && v < 1e15) return { ok: true, key: String(v) };
    return { ok: false, motivo: 'notação científica' };
  }
  const s = String(v).replace(/\u00A0/g, ' ').trim();
  if (/^[+-]?\d+([.,]\d+)?\s*[eE]\s*[+-]?\d+$/.test(s)) return { ok: false, motivo: 'notação científica' };
  const t = s.replace(/^(\d+)[.,]0+$/, '$1');                  // "123.0" -> "123"
  const key = t.replace(/\D/g, '').replace(/^0+/, '');
  return key ? { ok: true, key: key } : { ok: false, motivo: 'sem dígitos' };
}
/**
 * Classifica as linhas do arquivo. prots = protocolo de cada linha (na ordem do arquivo); existKeys = chave de cada linha já na aba ('' = sem protocolo válido).
 * Devolve índices (posição no arquivo): entram, inval [idx, motivo], rep (repetido no arquivo), dup (já existe na aba; só no modo acrescentar).
 */
function classificarEnvio(prots, modo, existKeys) {
  const mapa = {}; existKeys.forEach(k => { if (k) mapa[k] = 1; });
  const visto = {}, r = { entram: [], inval: [], rep: [], dup: [], novas: 0, atualizadas: 0, removidas: 0, semProtocolo: 0 };
  prots.forEach((p, i) => {
    const n = normalizarProtocolo(p);
    if (!n.ok) { r.inval.push([i, n.motivo]); return; }
    if (visto[n.key]) { r.rep.push(i); return; }                // repetido no arquivo: vale a primeira ocorrência
    visto[n.key] = 1;
    if (modo === 'acrescentar' && mapa[n.key]) { r.dup.push(i); return; }   // já existe na aba: mantém a da planilha
    r.entram.push(i);
    if (modo === 'mesclar' && mapa[n.key]) r.atualizadas++; else r.novas++;
  });
  if (modo === 'mesclar') existKeys.forEach(k => { if (!k) r.semProtocolo++; else if (!visto[k]) r.removidas++; });
  return r;
}

const pareceData = s => /^\d{4}-\d{2}-\d{2}([T\s]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?)?$/.test(s) || /^\d{1,2}\/\d{1,2}\/\d{4}([\s,-]+\d{1,2}:\d{2}(:\d{2})?)?$/.test(s);
/** Converte uma célula do arquivo para o tipo que a coluna de destino guarda ('data' | 'num' | 'texto' | 'vazio'). */
function converterCelula(v, tipo, ehProt) {
  if (v == null || v === '') return '';
  if (ehProt) {
    const s = typeof v === 'number' ? (Number.isInteger(v) && v < 1e15 ? String(v) : v.toExponential()) : corrigeTexto(v).replace(/\u00A0/g, ' ').trim();
    const n = normalizarProtocolo(s);
    if (!n.ok) return s;                                        // inválido: guarda como veio (vai para o relatório)
    if (tipo === 'num' && /^[1-9]\d{0,14}$/.test(s)) return Number(s);
    return s;                                                    // texto: não perde zeros nem vira notação científica
  }
  if (typeof v === 'object') {                                   // data de célula de data do Excel: { d: "aaaa-mm-dd HH:mm:ss" }
    const d = String(v.d || ''), ms = msDataHora(d);
    if (tipo === 'texto') return d.replace(/ 00:00:00$/, '');
    return ms == null ? d : new Date(ms);
  }
  if (typeof v === 'number') return tipo === 'texto' ? String(v) : v;
  const s = corrigeTexto(v).trim();
  if (!s) return '';
  if (tipo === 'data' && pareceData(s)) { const ms = msDataHora(s); if (ms != null) return new Date(ms); }
  if (tipo === 'num' && /^-?(0|[1-9]\d{0,14})([.,]\d+)?$/.test(s)) return Number(s.replace(',', '.'));
  return s;
}
function tipoDeValores(vals) {
  let d = 0, n = 0, t = 0;
  vals.forEach(v => { if (v === '' || v == null) return; if (v instanceof Date) d++; else if (typeof v === 'number') n++; else t++; });
  const tot = d + n + t;
  if (!tot) return 'vazio';
  return d * 2 >= tot ? 'data' : n * 2 >= tot ? 'num' : 'texto';
}
function perfilAba(sh, nCols) {
  const lr = sh.getLastRow(), amostra = lr > 1 ? sh.getRange(2, 1, Math.min(200, lr - 1), nCols).getValues() : [];
  const tipos = [], fmts = [];
  for (let j = 0; j < nCols; j++) {
    const t = tipoDeValores(amostra.map(r => r[j]));
    tipos.push(t);
    let f = ''; if (lr > 1 && (t === 'data' || t === 'num')) { try { f = sh.getRange(2, j + 1).getNumberFormat(); } catch (x) {} }
    fmts.push(f);
  }
  let formulas = [];
  if (lr > 1) { const f = sh.getRange(2, 1, 1, nCols).getFormulasR1C1()[0]; formulas = f.map((x, j) => /^=/.test(x) ? [j, x] : null).filter(Boolean); }
  return { tipos: tipos, fmts: fmts, formulas: formulas };
}
function cabecalhoAba(sh) {
  const lc = sh.getLastColumn();
  if (sh.getLastRow() < 1 || lc < 1) return [];
  return sh.getRange(1, 1, 1, lc).getValues()[0].map(c => String(c == null ? '' : c).trim());
}
const hashCab = cab => cab.map(chaveH).join('|');

/** Linhas atuais da aba (chave do protocolo de cada uma; '' = sem protocolo válido). */
function lerExistentes(sh, iProt) {
  const lr = sh.getLastRow(); if (lr < 2) return { n: 0, keys: [] };
  const col = sh.getRange(2, iProt + 1, lr - 1, 1).getValues(), keys = []; let n = 0;
  col.forEach(r => {
    const vazio = r[0] === '' || r[0] == null;
    if (vazio) return;
    n++;
    const k = normalizarProtocolo(r[0]); keys.push(k.ok ? k.key : '');
  });
  return { n: n, keys: keys };
}
function ultimaLinhaCol(sh, j) {
  const lr = sh.getLastRow(); if (lr < 2) return 1;
  const col = sh.getRange(2, j + 1, lr - 1, 1).getValues();
  for (let i = col.length - 1; i >= 0; i--) if (col[i][0] !== '' && col[i][0] != null) return i + 2;
  return 1;
}

/* ---- estado do envio (CacheService) ---- */
function jobLer(b, usr) {
  const id = String(b.id || '');
  if (!/^[0-9a-f]{32}$/.test(id)) throw new ErroApp('Envio inválido. Comece de novo.');
  const raw = CacheService.getScriptCache().get('env:' + id);
  if (!raw) throw new ErroApp('O envio expirou ou foi cancelado. Comece de novo.');
  const job = JSON.parse(raw);
  if (chave(job.login) !== chave(usr.login)) throw new ErroApp('Este envio pertence a outro usuário.', { permissao: true });
  return job;
}
function jobGravar(job) {
  const c = CacheService.getScriptCache();
  c.put('env:' + job.id, JSON.stringify(job), ENVIO_TTL_S);
  c.put('envlock:' + job.aba, JSON.stringify({ login: job.login, id: job.id, t: Date.now() }), 1800);
}
function jobLiberar(ss, job) {
  try { const c = CacheService.getScriptCache(); c.remove('env:' + job.id); c.remove('envlock:' + job.aba); } catch (x) {}
  const t = ss.getSheetByName(tempNome(job.aba)); if (t) ss.deleteSheet(t);
}

function acaoEnvioInfo(ss, usr, b) {
  const aba = String(b.aba || ''), def = envioDef(aba), sh = ss.getSheetByName(aba);
  if (!sh) throw new ErroApp('A aba ' + aba + ' não foi encontrada.');
  const cab = cabecalhoAba(sh), iProt = colDe(cab, def.prot);
  const faltam = def.obrig.filter(n => colDe(cab, n) < 0);
  let linhas = 0, formulas = [], ocupado = null;
  if (cab.length && iProt >= 0) { linhas = lerExistentes(sh, iProt).n; formulas = perfilAba(sh, cab.length).formulas.map(f => cab[f[0]]); }
  try { const lk = JSON.parse(CacheService.getScriptCache().get('envlock:' + aba) || 'null'); if (lk && chave(lk.login) !== chave(usr.login)) ocupado = lk.login; } catch (x) {}
  return { ok: true, aba: aba, cabecalho: cab, obrigatorias: def.obrig, protocolo: def.prot, modos: def.modos, padrao: def.padrao, linhas: linhas,
           colunasFormula: formulas, faltamNaAba: faltam, backup: infoBackup(ss, aba), ocupadoPor: ocupado, maxLinhas: ENVIO_MAX_LINHAS };
}

function acaoEnvioIniciar(ss, usr, b) {
  const aba = String(b.aba || ''), def = envioDef(aba), modo = String(b.modo || '');
  if (def.modos.indexOf(modo) < 0) throw new ErroApp('Modo de envio não permitido para esta aba.');
  const sh = ss.getSheetByName(aba);
  if (!sh) throw new ErroApp('A aba ' + aba + ' não foi encontrada.');
  const total = Math.floor(Number(b.total));
  if (!(total >= 1)) throw new ErroApp('O arquivo não tem linhas de dados.');
  if (total > ENVIO_MAX_LINHAS) throw new ErroApp('O arquivo tem linhas demais (máximo ' + ENVIO_MAX_LINHAS + ').');
  const cab = cabecalhoAba(sh);
  if (!cab.length) throw new ErroApp('A aba ' + aba + ' está sem cabeçalho na linha 1.');
  if (hashCab(cab) !== hashCab((b.cabecalhoAba || []).map(String))) throw new ErroApp('O cabeçalho da aba mudou. Recarregue a tela e tente de novo.', { conflito: true });
  const pres = (b.presentes || []).map(chaveH);
  const semAba = def.obrig.filter(n => colDe(cab, n) < 0);
  if (semAba.length) throw new ErroApp('A aba ' + aba + ' não tem a(s) coluna(s): ' + semAba.join(', ') + '.');
  const semArq = def.obrig.filter(n => pres.indexOf(chaveH(n)) < 0);
  if (semArq.length) throw new ErroApp('Faltam colunas obrigatórias no arquivo: ' + semArq.join(', ') + '.');
  const c = CacheService.getScriptCache();
  let lk = null; try { lk = JSON.parse(c.get('envlock:' + aba) || 'null'); } catch (x) {}
  if (lk && chave(lk.login) !== chave(usr.login)) throw new ErroApp('Já há um envio em andamento para ' + aba + ' (' + lk.login + '). Aguarde alguns minutos.');
  const velho = ss.getSheetByName(tempNome(aba)); if (velho) ss.deleteSheet(velho);
  const nCols = cab.length, perfil = perfilAba(sh, nCols), iProt = colDe(cab, def.prot);
  const tmp = ss.insertSheet(tempNome(aba)); tmp.hideSheet();
  garantirTamanho(tmp, total + 1, nCols);
  tmp.getRange(1, 1, 1, nCols).setNumberFormat('@').setValues([cab]);
  const job = { id: Utilities.getUuid().replace(/-/g, '').toLowerCase(), login: usr.login, aba: aba, modo: modo, total: total, nCols: nCols, iProt: iProt, cab: hashCab(cab),
                tipos: perfil.tipos, fmts: perfil.fmts, formulas: perfil.formulas, presentes: cab.map(n => pres.indexOf(chaveH(n)) >= 0), recebidos: {}, nome: String(b.nomeArquivo || '').slice(0, 120) };
  jobGravar(job);
  return { ok: true, id: job.id, colunasFormula: perfil.formulas.map(f => cab[f[0]]) };
}

// escreve valores já convertidos respeitando o tipo de cada coluna (texto não é convertido pela planilha)
function escreverTipado(sh, linhaIni, matriz, job) {
  const n = matriz.length; if (!n) return;
  garantirTamanho(sh, linhaIni + n - 1, job.nCols);
  for (let j = 0; j < job.nCols; j++) {
    const t = job.tipos[j], r = sh.getRange(linhaIni, j + 1, n, 1);
    if (t === 'texto' || (j === job.iProt && t !== 'num') || t === 'vazio') r.setNumberFormat('@');
    else {
      if (job.fmts[j]) r.setNumberFormat(job.fmts[j]);
      // coluna numérica/data: texto que a planilha converteria sozinho (ex.: protocolo 0012 virando 12) fica como texto, só nessas células
      const risco = [];
      for (let i = 0; i < n; i++) { const v = matriz[i][j]; if (typeof v === 'string' && v !== '' && (/^-?\d+([.,]\d+)?$/.test(v.trim()) || /^=/.test(v) || pareceData(v.trim()))) risco.push(i); }
      if (risco.length > 50) r.setNumberFormat('@');
      else risco.forEach(i => sh.getRange(linhaIni + i, j + 1).setNumberFormat('@'));
    }
  }
  for (let i = 0; i < n; i += 5000) { const parte = matriz.slice(i, i + 5000); sh.getRange(linhaIni + i, 1, parte.length, job.nCols).setValues(parte); }
}
function acaoEnvioLote(ss, usr, b) {
  const job = jobLer(b, usr), ini = Math.floor(Number(b.ini)), linhas = Array.isArray(b.linhas) ? b.linhas : [];
  if (!(ini >= 0) || ini + linhas.length > job.total || !linhas.length) throw new ErroApp('Lote inválido. Comece o envio de novo.');
  const tmp = ss.getSheetByName(tempNome(job.aba));
  if (!tmp) throw new ErroApp('A área temporária do envio não existe mais. Comece de novo.');
  const m = linhas.map(r => {
    const out = [];
    for (let j = 0; j < job.nCols; j++) out.push(converterCelula(Array.isArray(r) ? r[j] : null, job.tipos[j], j === job.iProt));
    return out;
  });
  // colunas com fórmula na aba não recebem valores do arquivo
  m.forEach(r => job.formulas.forEach(f => { r[f[0]] = ''; }));
  escreverTipado(tmp, 2 + ini, m, job);
  job.recebidos[ini] = linhas.length;
  jobGravar(job);
  return { ok: true, recebidas: Object.keys(job.recebidos).reduce((a, k) => a + job.recebidos[k], 0), total: job.total };
}
function conferirLotes(job) {
  const soma = Object.keys(job.recebidos).reduce((a, k) => a + job.recebidos[k], 0);
  if (soma !== job.total) throw new ErroApp('Chegaram ' + soma + ' de ' + job.total + ' linhas. Envie o arquivo de novo.');
  let esperado = 0; const ks = Object.keys(job.recebidos).map(Number).sort((a, b) => a - b);
  for (let i = 0; i < ks.length; i++) { if (ks[i] !== esperado) throw new ErroApp('Faltou um pedaço do arquivo. Envie de novo.'); esperado += job.recebidos[ks[i]]; }
}
const fmtCelulaPrevia = v => v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') : v == null ? '' : String(v).slice(0, 60);
/** Recalcula tudo a partir da aba temporária e da aba atual (usado na prévia e de novo no confirmar). */
function calcularEnvio(ss, job) {
  conferirLotes(job);
  const sh = ss.getSheetByName(job.aba), tmp = ss.getSheetByName(tempNome(job.aba));
  if (!sh || !tmp) throw new ErroApp('A aba ou a área temporária não existe mais. Comece de novo.');
  const cab = cabecalhoAba(sh);
  if (hashCab(cab) !== job.cab) throw new ErroApp('O cabeçalho da aba mudou durante o envio. Comece de novo.', { conflito: true });
  if (tmp.getLastRow() < job.total + 1) throw new ErroApp('A área temporária está incompleta. Envie de novo.');
  const dados = tmp.getRange(2, 1, job.total, job.nCols).getValues();
  const ex = lerExistentes(sh, job.iProt);
  const cls = classificarEnvio(dados.map(r => r[job.iProt]), job.modo, ex.keys);
  const alertaForte = ex.n > 0 && ((job.modo === 'substituir' && job.total * 2 < ex.n) || (job.modo === 'mesclar' && cls.removidas * 2 > ex.n));
  return { dados: dados, ex: ex, cls: cls, cab: cab, alertaForte: alertaForte };
}
function resumoEnvio(job, calc) {
  const c = calc.cls;
  const ign = c.inval.map(x => [x[0], 'inv', x[1]]).concat(c.rep.map(i => [i, 'rep', 'repetido no arquivo'])).concat(c.dup.map(i => [i, 'dup', 'já existe na aba']));
  ign.sort((a, b) => a[0] - b[0]);
  return { ok: true, aba: job.aba, modo: job.modo, linhasAtuais: calc.ex.n, linhasArquivo: job.total, entram: c.entram.length, novas: c.novas, atualizadas: c.atualizadas, removidas: c.removidas,
           duplicadas: c.dup.length, repetidas: c.rep.length, invalidas: c.inval.length, semProtocolo: c.semProtocolo, alertaForte: calc.alertaForte,
           confirmarComNome: calc.alertaForte ? job.aba : '', cabecalho: calc.cab, primeiras: c.entram.slice(0, 10).map(i => calc.dados[i].map(fmtCelulaPrevia)),
           ignoradas: ign, colunasFormula: job.formulas.map(f => calc.cab[f[0]]) };
}
function acaoEnvioPrevia(ss, usr, b) { const job = jobLer(b, usr); return resumoEnvio(job, calcularEnvio(ss, job)); }
function acaoEnvioCancelar(ss, usr, b) {
  let job = null; try { job = jobLer(b, usr); } catch (e) { return { ok: true }; }
  jobLiberar(ss, job); return { ok: true };
}

function limparDadosAba(sh, nCols) { const lr = sh.getLastRow(); if (lr > 1) sh.getRange(2, 1, lr - 1, nCols).clearContent(); }
function aplicarFormulas(sh, linhaIni, n, job) { if (n > 0) job.formulas.forEach(f => sh.getRange(linhaIni, f[0] + 1, n, 1).setFormulaR1C1(f[1])); }
function aplicarEnvio(sh, job, calc) {
  const c = calc.cls, dados = calc.dados, fset = {}; job.formulas.forEach(f => { fset[f[0]] = 1; });
  if (job.modo === 'substituir') {
    const out = c.entram.map(i => dados[i]);
    limparDadosAba(sh, job.nCols); escreverTipado(sh, 2, out, job); aplicarFormulas(sh, 2, out.length, job);
  } else if (job.modo === 'acrescentar') {
    const out = c.entram.map(i => dados[i]), ini = ultimaLinhaCol(sh, job.iProt) + 1;
    escreverTipado(sh, ini, out, job); aplicarFormulas(sh, ini, out.length, job);
  } else {                                                          // mesclar: atualiza as existentes, adiciona as novas, remove as que não vieram
    const lr = sh.getLastRow(), atuais = lr > 1 ? sh.getRange(2, 1, lr - 1, job.nCols).getValues() : [];
    const porKey = {}; c.entram.forEach(i => { porKey[normalizarProtocolo(dados[i][job.iProt]).key] = dados[i]; });
    const usados = {}, out = [];
    atuais.forEach(r => {
      const k = r[job.iProt] === '' ? '' : (normalizarProtocolo(r[job.iProt]).key || '');
      if (!k) { if (r.some(x => x !== '' && x != null)) out.push(r); return; }          // sem protocolo válido: mantém como está
      const n = porKey[k]; if (!n) return;                                              // não veio no arquivo: sai
      usados[k] = 1;
      out.push(r.map((x, j) => job.presentes[j] && !fset[j] ? n[j] : x));              // só as colunas que vieram no arquivo
    });
    c.entram.forEach(i => { const k = normalizarProtocolo(dados[i][job.iProt]).key; if (!usados[k]) out.push(dados[i]); });
    limparDadosAba(sh, job.nCols); escreverTipado(sh, 2, out, job); aplicarFormulas(sh, 2, out.length, job);
  }
  SpreadsheetApp.flush();
}
function lerCarimbo(ss, aba) {
  const sh = ss.getSheetByName(ABA_SINC); if (!sh) return null;
  const v = sh.getRange(ENVIO[aba].carimbo).getValue();
  return v instanceof Date ? v.getTime() : v === '' ? null : String(v);
}
function acaoEnvioConfirmar(ss, usr, b) {
  const job = jobLer(b, usr), calc = calcularEnvio(ss, job), sh = ss.getSheetByName(job.aba);
  if (!calc.cls.entram.length) throw new ErroApp('O arquivo não tem nenhuma linha válida (protocolos). Nada foi gravado.');   // nunca esvazia a aba por engano
  if (calc.alertaForte && String(b.confirmacao || '').trim() !== job.aba) throw new ErroApp('Para confirmar, digite o nome da aba: ' + job.aba + '.', { precisaConfirmar: true });
  garantirLog(ss);
  const antes = calc.ex.n, ant = lerCarimbo(ss, job.aba);
  fazerBackup(ss, job.aba, { login: usr.login, acao: 'envio', modo: job.modo, carimboAnt: ant });
  try { aplicarEnvio(sh, job, calc); }
  catch (err) {
    try { restaurarBackup(ss, job.aba); } catch (e2) {}
    throw new ErroApp('Não foi possível gravar (' + String(err && err.message || err) + '). A aba foi restaurada ao estado anterior.');
  }
  let carimbo = false;
  const sinc = ss.getSheetByName(ABA_SINC);
  if (sinc) { sinc.getRange(ENVIO[job.aba].carimbo).setValue(new Date()); carimbo = true; }     // só esta célula do Sincronismo
  const c = calc.cls;
  jobLiberar(ss, job);
  registrarLog(ss, usr, 'envio de arquivo', job.aba, 'modo=' + job.modo + (job.nome ? '; arquivo=' + job.nome : ''), 'linhas antes: ' + antes,
    'novas: ' + c.novas + (job.modo === 'mesclar' ? '; atualizadas: ' + c.atualizadas + '; removidas: ' + c.removidas : '') + '; duplicadas ignoradas: ' + c.dup.length + '; repetidas no arquivo: ' + c.rep.length + '; inválidas: ' + c.inval.length);
  const r = resumoEnvio(job, calc); r.carimbo = carimbo; r.backup = infoBackup(ss, job.aba);
  r.avisoSinc = carimbo ? '' : 'A aba Sincronismo não foi encontrada: o carimbo não foi atualizado.';
  return r;
}
function acaoEnvioDesfazer(ss, usr, b) {
  const aba = String(b.aba || ''); envioDef(aba);
  const inf = infoBackup(ss, aba);
  if (!inf) throw new ErroApp('Não há envio anterior para desfazer nesta aba.');
  let meta = null; try { meta = JSON.parse(PropertiesService.getScriptProperties().getProperty('bk:' + aba) || 'null'); } catch (x) {}
  garantirLog(ss);
  restaurarBackup(ss, aba);
  const sinc = ss.getSheetByName(ABA_SINC);
  if (sinc && meta && 'carimboAnt' in meta) {                      // devolve o carimbo antigo (só a célula desta aba)
    const cel = sinc.getRange(ENVIO[aba].carimbo);
    if (meta.carimboAnt == null) cel.clearContent(); else cel.setValue(typeof meta.carimboAnt === 'number' ? new Date(meta.carimboAnt) : meta.carimboAnt);
  }
  registrarLog(ss, usr, 'desfazer envio', aba, 'backup de ' + (inf.t ? Utilities.formatDate(new Date(inf.t), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') : '?'), '', 'conteúdo anterior restaurado');
  return { ok: true };
}

/* =====================================================================
 * PRIORIDADES e ESCALA_FDS (Etapa 5): edição segura
 * ---------------------------------------------------------------------
 * Prioridades: só ADICIONAR e EDITAR (apagar linha faria a prioridade deixar de ser contada). Protocolo só com dígitos (8 ou mais).
 * Escala_FDS: edita o código de cada célula (colaborador x data) usando só os códigos que a aba já usa; colaboradores precisam existir na aba Técnicos.
 * Supervisor: só a escala dos técnicos da própria equipe. Backup antes de cada gravação.
 * ===================================================================== */
function colunasPrio(v) {                                          // mesma leitura de lerPrioridadesRaw
  let h = -1;
  for (let i = 0; i < Math.min(v.length, 15) && h < 0; i++) { if (v[i].some(c => chaveH(c) === 'solicitante')) h = i; }
  if (h < 0) h = 0;
  const ncol = (v[h] || []).length, cols = [];
  for (let j = 0; j < ncol; j++) cols.push(chaveH(v[h][j]) || (h > 0 ? chaveH(v[h - 1][j]) : ''));
  const exato = nomes => { for (let i = 0; i < nomes.length; i++) { const k = cols.indexOf(nomes[i]); if (k >= 0) return k; } return -1; };
  const contem = ws => { for (let j = 0; j < cols.length; j++) { if (cols[j] && ws.some(w => cols[j].indexOf(w) >= 0)) return j; } return -1; };
  let iProt = exato(['protocolo', 'protocolo novo', 'protocolo os', 'os', 'codigo']);
  if (iProt < 0) {
    let melhor = 0;
    for (let j = 0; j < ncol; j++) { let n = 0; for (let i = h + 1; i < Math.min(v.length, h + 60); i++) { if (/^\d{8,}$/.test(String(v[i][j]).trim())) n++; } if (n > melhor) { melhor = n; iProt = j; } }
  }
  if (iProt < 0) return null;
  return { h: h, iProt: iProt, iSol: exato(['solicitante']), iSet: contem(['setor']), iJus: exato(['justificativa', 'motivo']), iRel: contem(['relato']), iDt: contem(['requis', 'data solicitacao', 'dt solicitacao']) };
}
function lerPrio(ss) {
  const sh = ss.getSheetByName(ABA_PRIO);
  if (!sh) throw new ErroApp('A aba ' + ABA_PRIO + ' não foi encontrada.');
  const v = sh.getLastRow() < 1 ? [] : sh.getDataRange().getValues();
  const C = v.length ? colunasPrio(v) : null;
  if (!C) throw new ErroApp('Não achei a coluna do protocolo na aba ' + ABA_PRIO + '.');
  return { sh: sh, v: v, C: C, largura: v[C.h].length };
}
function dtIso(v) { const d = v instanceof Date ? v : null; if (d && !isNaN(d)) return isoDia(d); const ms = msPrio(v); return ms == null ? '' : isoDia(new Date(ms)); }
function acaoPrioListar(ss, usr, b) {
  const P = lerPrio(ss), C = P.C, busca = String(b.busca || '').trim(), dig = busca.replace(/\D/g, ''), nb = nomeKey(busca), todas = [];
  for (let i = C.h + 1; i < P.v.length; i++) {
    const r = P.v[i], prot = String(r[C.iProt] == null ? '' : r[C.iProt]).trim();
    const txt = j => j < 0 ? '' : corrigeTexto(r[j]).trim();
    if (!prot && !txt(C.iSol) && !txt(C.iJus)) continue;
    todas.push({ linha: i + 1, versao: versaoValores(r), protocolo: prot, solicitante: txt(C.iSol), setor: txt(C.iSet), justificativa: txt(C.iJus), relato: txt(C.iRel), dt: C.iDt < 0 ? '' : dtIso(r[C.iDt]) });
  }
  let lista = todas;
  if (busca) lista = todas.filter(x => (dig.length >= 3 && x.protocolo.replace(/\D/g, '').indexOf(dig) >= 0) || nomeKey(x.solicitante + ' ' + x.setor + ' ' + x.justificativa).indexOf(nb) >= 0);
  const total = lista.length; lista = lista.slice(-200).reverse();
  return { ok: true, total: total, mostrando: lista.length, itens: lista, backup: infoBackup(ss, ABA_PRIO), colunas: { solicitante: C.iSol >= 0, setor: C.iSet >= 0, justificativa: C.iJus >= 0, relato: C.iRel >= 0, dt: C.iDt >= 0 } };
}
function tipoColuna(sh, j, de) {
  const lr = sh.getLastRow(); if (lr <= de) return 'vazio';
  const col = sh.getRange(de + 1, j + 1, Math.min(100, lr - de), 1).getValues().map(r => r[0]).filter(x => !(typeof x === 'string' && /^#/.test(x)));
  return tipoDeValores(col);
}
function acaoPrioSalvar(ss, usr, b) {
  const P = lerPrio(ss), C = P.C, d = b.dados || {}, linha = b.linha ? Number(b.linha) : 0;
  const prot = String(d.protocolo == null ? '' : d.protocolo).trim();
  if (!/^\d{8,25}$/.test(prot)) throw new ErroApp('O protocolo deve ter só dígitos (8 ou mais).');
  const dt = String(d.dt || '').trim();
  if (dt && !/^\d{4}-\d{2}-\d{2}$/.test(dt)) throw new ErroApp('Data inválida.');
  let atual = null;
  if (linha) {
    atual = P.v[linha - 1];
    if (!atual || linha <= C.h + 1) throw erroConflito('Esta linha não existe mais na planilha. Recarregue a lista.');
    if (String(b.versao || '') !== versaoValores(atual)) throw erroConflito();
  }
  const campos = [['solicitante', C.iSol], ['setor', C.iSet], ['justificativa', C.iJus], ['relato', C.iRel]];
  campos.forEach(c => { if (c[1] < 0 && String(d[c[0]] || '').trim()) throw new ErroApp('A aba Prioridades não tem a coluna de ' + c[0] + '.'); });
  if (dt && C.iDt < 0) throw new ErroApp('A aba Prioridades não tem a coluna de data.');
  garantirLog(ss);
  let alvo = linha;
  if (!alvo) { alvo = C.h + 2; for (let i = P.v.length - 1; i > C.h; i--) { if ([C.iProt, C.iSol, C.iJus].some(j => j >= 0 && P.v[i][j] !== '' && P.v[i][j] != null)) { alvo = i + 2; break; } } }
  fazerBackup(ss, ABA_PRIO, { login: usr.login, acao: linha ? 'editar' : 'adicionar' });
  const tProt = tipoColuna(P.sh, C.iProt, C.h + 1), tDt = C.iDt >= 0 ? tipoColuna(P.sh, C.iDt, C.h + 1) : 'texto';
  garantirTamanho(P.sh, alvo, P.largura);
  if (tProt === 'num' && /^[1-9]\d{0,14}$/.test(prot)) P.sh.getRange(alvo, C.iProt + 1).setValue(Number(prot)); else gravarTexto(P.sh, alvo, C.iProt + 1, prot);
  campos.forEach(c => { if (c[1] >= 0) gravarTexto(P.sh, alvo, c[1] + 1, String(d[c[0]] || '').trim()); });
  if (C.iDt >= 0) {
    if (!dt) P.sh.getRange(alvo, C.iDt + 1).clearContent();
    else if (tDt === 'data') P.sh.getRange(alvo, C.iDt + 1).setValue(new Date(+dt.slice(0, 4), +dt.slice(5, 7) - 1, +dt.slice(8, 10)));
    else gravarTexto(P.sh, alvo, C.iDt + 1, dt.slice(8, 10) + '/' + dt.slice(5, 7) + '/' + dt.slice(0, 4));
  }
  const dep = P.sh.getRange(alvo, 1, 1, P.largura).getValues()[0];
  registrarLog(ss, usr, linha ? 'prioridade: editar' : 'prioridade: adicionar', ABA_PRIO, 'protocolo ' + prot + ' (linha ' + alvo + ')',
    atual ? 'protocolo ' + textoCel(atual[C.iProt]) + '; solicitante ' + (C.iSol >= 0 ? textoCel(atual[C.iSol]) : '') : '', 'solicitante ' + String(d.solicitante || '').trim() + '; justificativa ' + String(d.justificativa || '').trim());
  return { ok: true, linha: alvo, versao: versaoValores(dep) };
}

function lerGradeEscala(ss) {
  const sh = ss.getSheetByName(ABA_ESC);
  if (!sh) throw new ErroApp('A aba ' + ABA_ESC + ' não foi encontrada.');
  const v = sh.getLastRow() < 1 ? [] : sh.getDataRange().getValues();
  let h = -1, iCol = -1;
  for (let i = 0; i < Math.min(v.length, 10) && h < 0; i++) { const k = v[i].findIndex(c => chaveH(c) === 'colaborador'); if (k >= 0) { h = i; iCol = k; } }
  if (h < 0) throw new ErroApp('Não achei a coluna COLABORADOR na aba ' + ABA_ESC + '.');
  const cols = [];
  for (let j = iCol + 1; j < v[h].length; j++) { const iso = isoDataEscala(v[h][j]); if (iso) cols.push({ j: j, iso: iso }); }
  const linhas = []; let ultima = h + 1;
  for (let i = h + 1; i < v.length; i++) {
    const nome = corrigeTexto(v[i][iCol]).replace(/\s+/g, ' ').trim();
    if (!nome) continue;
    ultima = i + 1;
    const cods = {}; cols.forEach(c => { cods[c.iso] = corrigeTexto(v[i][c.j]).replace(/\s+/g, ' ').trim(); });
    linhas.push({ linha: i + 1, versao: versaoValores(v[i]), nome: nome, cods: cods });
  }
  const freq = {}; linhas.forEach(l => cols.forEach(c => { const x = l.cods[c.iso]; if (x) freq[x] = (freq[x] || 0) + 1; }));
  const codigos = Object.keys(freq).sort((a, b) => freq[b] - freq[a] || a.localeCompare(b, 'pt-BR'));
  return { sh: sh, v: v, h: h, iCol: iCol, cols: cols, linhas: linhas, proxima: ultima + 1, codigos: codigos, largura: v[h].length };
}
function equipeTecnicos(ss, usr) {                                  // nomes (chave) que o usuário pode mexer na escala; null = todos
  if (usr.papel === 'coordenador') return null;
  const m = {}; lerUsuariosRaw(ss, ABA_TEC).forEach(u => { if (nomeKey(u.ref) === nomeKey(usr.nome)) m[nomeKey(u.nome)] = 1; });
  return m;
}
function acaoEscalaListar(ss, usr, b) {
  const G = lerGradeEscala(ss), eq = equipeTecnicos(ss, usr), todosTec = {};
  lerUsuariosRaw(ss, ABA_TEC).forEach(u => { todosTec[nomeKey(u.nome)] = 1; });
  const naGrade = {}; G.linhas.forEach(l => { naGrade[nomeKey(l.nome)] = 1; });
  const linhas = G.linhas.filter(l => !eq || eq[nomeKey(l.nome)]).map(l => ({ linha: l.linha, versao: l.versao, nome: l.nome, cods: l.cods, semTecnico: !todosTec[nomeKey(l.nome)] }));
  const novos = lerUsuariosRaw(ss, ABA_TEC).filter(u => u.ativo && (!eq || eq[nomeKey(u.nome)]) && !naGrade[nomeKey(u.nome)]).map(u => u.nome);
  return { ok: true, backup: infoBackup(ss, ABA_ESC), datas: G.cols.map(c => c.iso), codigos: G.codigos, linhas: linhas, podeAdicionar: novos };
}
function acaoEscalaSalvar(ss, usr, b) {
  const G = lerGradeEscala(ss), eq = equipeTecnicos(ss, usr), alts = Array.isArray(b.alteracoes) ? b.alteracoes : [];
  if (!alts.length) throw new ErroApp('Nada para salvar.');
  const permitidos = {}; G.codigos.forEach(c => { permitidos[c] = 1; });
  const colPorIso = {}; G.cols.forEach(c => { colPorIso[c.iso] = c.j; });
  const plano = [];
  alts.forEach(a => {
    const l = G.linhas.find(x => x.linha === Number(a.linha));
    if (!l) throw erroConflito('Um colaborador mudou de lugar na planilha. Recarregue a escala.');
    if (String(a.versao || '') !== l.versao) throw erroConflito('A linha de ' + l.nome + ' foi alterada na planilha. Recarregue a escala e tente de novo.');
    if (eq && !eq[nomeKey(l.nome)]) throw new ErroApp('Você só pode editar a escala da sua equipe.', { permissao: true });
    Object.keys(a.celulas || {}).forEach(iso => {
      if (colPorIso[iso] == null) throw new ErroApp('Data inexistente na escala: ' + iso + '.');
      const cod = String(a.celulas[iso] == null ? '' : a.celulas[iso]).replace(/\s+/g, ' ').trim();
      if (cod && !permitidos[cod]) throw new ErroApp('Código "' + cod + '" não é usado na escala. Use um código que já existe na aba.');
      if (cod !== l.cods[iso]) plano.push({ l: l, iso: iso, cod: cod, antes: l.cods[iso] });
    });
  });
  if (!plano.length) return { ok: true, semMudanca: true };
  garantirLog(ss); fazerBackup(ss, ABA_ESC, { login: usr.login, acao: 'editar' });
  plano.forEach(p => gravarTexto(G.sh, p.l.linha, colPorIso[p.iso] + 1, p.cod));
  const porLinha = {}; plano.forEach(p => { (porLinha[p.l.nome] = porLinha[p.l.nome] || []).push(p); });
  Object.keys(porLinha).forEach(n => registrarLog(ss, usr, 'escala: editar', ABA_ESC, n,
    porLinha[n].map(p => p.iso + ': ' + (p.antes || '(vazio)')).join('; '), porLinha[n].map(p => p.iso + ': ' + (p.cod || '(vazio)')).join('; ')));
  return { ok: true, gravados: plano.length };
}
function acaoEscalaNovo(ss, usr, b) {
  const G = lerGradeEscala(ss), eq = equipeTecnicos(ss, usr), nome = corrigeTexto(b.nome).replace(/\s+/g, ' ').trim();
  const t = lerUsuariosRaw(ss, ABA_TEC).find(u => nomeKey(u.nome) === nomeKey(nome));
  if (!t) throw new ErroApp('O nome precisa ser igual ao da aba Técnicos.');
  if (eq && !eq[nomeKey(t.nome)]) throw new ErroApp('Você só pode editar a escala da sua equipe.', { permissao: true });
  if (G.linhas.some(l => nomeKey(l.nome) === nomeKey(t.nome))) throw new ErroApp('Esse colaborador já está na escala.');
  garantirLog(ss); fazerBackup(ss, ABA_ESC, { login: usr.login, acao: 'adicionar colaborador' });
  gravarTexto(G.sh, G.proxima, G.iCol + 1, t.nome);
  registrarLog(ss, usr, 'escala: adicionar colaborador', ABA_ESC, t.nome + ' (linha ' + G.proxima + ')', '', 'linha criada sem códigos');
  return { ok: true, linha: G.proxima };
}

// restaura o último backup de uma aba que o sistema alterou (só coordenador; envio de arquivos tem o "Desfazer" próprio)
const ABAS_COM_BACKUP = [ABA_METAS, ABA_ESC, ABA_PRIO];
ACOES.backup_restaurar = { perfis: ['coordenador'], fn: function (ss, usr, b) {
  const aba = String(b.aba || '');
  if (ABAS_COM_BACKUP.indexOf(aba) < 0) throw new ErroApp('Aba inválida para restauração.');
  if (!infoBackup(ss, aba)) throw new ErroApp('Não há backup desta aba.');
  garantirLog(ss); restaurarBackup(ss, aba);
  registrarLog(ss, usr, 'restaurar backup', aba, '', '', 'conteúdo do último backup restaurado');
  return { ok: true };
}, grava: true };

/* =====================================================================
 * TESTES das etapas novas (rodam no editor, só com dados de exemplo: NÃO leem nem gravam a planilha real)
 * Selecione a função, Executar, e abra o "Registro de execução".
 * ===================================================================== */
function _conferir(casos) {
  let falhas = 0;
  casos.forEach(c => {
    let obtido; try { obtido = c[1](); } catch (e) { obtido = 'ERRO: ' + (e && e.message); }
    const ok = JSON.stringify(obtido) === JSON.stringify(c[2]);
    if (!ok) falhas++;
    Logger.log((ok ? 'OK     ' : 'FALHOU ') + c[0] + ' | esperado: ' + JSON.stringify(c[2]) + ' | obtido: ' + JSON.stringify(obtido));
  });
  Logger.log(falhas ? 'RESULTADO: ' + falhas + ' caso(s) FALHARAM' : 'RESULTADO: todos os ' + casos.length + ' casos OK');
}
/** Permissões: quem vê e quem edita cada cadastro (funções puras, sem planilha). */
function testarPermissoes() {
  const coord = { papel: 'coordenador', nome: 'Ana', login: 'ana' }, sup = { papel: 'supervisor', nome: 'Bruno Lima', login: 'bruno' };
  const tec = { papel: 'tecnico', nome: 'Caio', login: 'caio' }, ctr = { papel: 'controlador', nome: 'Dani', login: 'dani', supervisor: 'Bruno Lima' };
  const daEquipe = { ref: 'bruno lima' }, deOutro = { ref: 'Carla Souza' };
  const quemPode = (u, cad, reg) => { try { exigirVerCad(u, cad); } catch (e) { return false; } return podeEditarRegistro(u, cad, reg); };
  const perfil = (u, lista) => { try { exigirPerfil(u, lista); return true; } catch (e) { return false; } };
  _conferir([
    ['coordenador vê os 4 cadastros',                 () => ['tecnico', 'controlador', 'supervisor', 'coordenador'].map(c => podeVerCad(coord, c)), [true, true, true, true]],
    ['supervisor vê só técnicos e controladores',     () => ['tecnico', 'controlador', 'supervisor', 'coordenador'].map(c => podeVerCad(sup, c)), [true, true, false, false]],
    ['técnico e controlador não veem nada',           () => ['tecnico', 'controlador', 'supervisor', 'coordenador'].map(c => podeVerCad(tec, c) || podeVerCad(ctr, c)), [false, false, false, false]],
    ['coordenador edita qualquer linha',              () => quemPode(coord, 'supervisor', deOutro), true],
    ['supervisor edita técnico da própria equipe',    () => quemPode(sup, 'tecnico', daEquipe), true],
    ['supervisor edita controlador da equipe',        () => quemPode(sup, 'controlador', daEquipe), true],
    ['supervisor NÃO edita técnico de outra equipe',  () => quemPode(sup, 'tecnico', deOutro), false],
    ['supervisor NÃO edita outro supervisor',         () => quemPode(sup, 'supervisor', daEquipe), false],
    ['supervisor NÃO edita coordenador',              () => quemPode(sup, 'coordenador', daEquipe), false],
    ['técnico NÃO edita nada',                        () => quemPode(tec, 'tecnico', daEquipe), false],
    ['controlador NÃO edita nada',                    () => quemPode(ctr, 'tecnico', daEquipe), false],
    ['Metas/Config/Config só coordenador',            () => [perfil(coord, ACOES.metas_salvar.perfis), perfil(sup, ACOES.metas_salvar.perfis), perfil(sup, ACOES.config_salvar.perfis), perfil(tec, ACOES.config_ler.perfis)], [true, false, false, false]],
    ['envio: coordenador e supervisor, não técnico',  () => [perfil(coord, ACOES.envio_confirmar.perfis), perfil(sup, ACOES.envio_confirmar.perfis), perfil(tec, ACOES.envio_confirmar.perfis), perfil(ctr, ACOES.envio_confirmar.perfis)], [true, true, false, false]],
    ['toda ação de gravação exige perfil (nenhuma aberta)', () => Object.keys(ACOES).filter(k => ACOES[k].grava && (!ACOES[k].perfis || !ACOES[k].perfis.length || ACOES[k].perfis.indexOf('tecnico') >= 0 || ACOES[k].perfis.indexOf('controlador') >= 0)), []],
    ['versão da linha muda quando a linha muda',      () => versaoValores(['a', 1, '']) !== versaoValores(['a', 2, '']) && versaoValores(['a', 1]) === versaoValores(['a', 1]), true]
  ]);
}
/** Log: formato da linha, texto seguro e senha/código NUNCA aparecem. */
function testarLog() {
  const usr = { login: 'ana', papel: 'coordenador' };
  const antigo = { senha: 'SEGREDO1', login: 'x', ativo: true }, novo = { senha: 'SEGREDO2', login: 'y', ativo: false };
  const dAnt = descreverCampos(antigo, ['login', 'senha', 'ativo']), dNov = descreverCampos(novo, ['login', 'senha', 'ativo']);
  const lin = linhaDeLog(usr, 'editar', 'Técnicos', 'Fulano (linha 5)', dAnt, dNov, new Date(2026, 0, 2, 3, 4, 5));
  _conferir([
    ['a linha do log tem as 8 colunas',               () => lin.length === LOG_COLS.length, true],
    ['colunas do log',                                () => LOG_COLS.join('|'), 'Data/hora|Login|Perfil|Ação|Aba|Chave da linha|Valor antigo|Valor novo'],
    ['senha antiga fora do log',                      () => JSON.stringify(lin).indexOf('SEGREDO1') < 0, true],
    ['senha nova fora do log',                        () => JSON.stringify(lin).indexOf('SEGREDO2') < 0, true],
    ['mudança de senha aparece como [oculta]',        () => dNov.indexOf('senha: [oculta]') >= 0, true],
    ['login e ativo aparecem',                        () => dNov.indexOf('login: y') >= 0 && dNov.indexOf('ativo: NÃO') >= 0, true],
    ['código de acesso também fica oculto',           () => descreverCampos({ codigo: '1234' }, ['codigo']), 'codigo: [oculta]'],
    ['texto que começa com = não vira fórmula',       () => txtLog('=1+1').charAt(0), ' '],
    ['texto muito longo é cortado',                   () => txtLog('x'.repeat(5000)).length <= 1501, true],
    ['nome da aba de log',                            () => ABA_LOG, 'Log_Alterações'],
    ['nome da aba de backup',                         () => nomeBackup('Metas'), 'Backup_Metas']
  ]);
}
/** Envio: protocolos, duplicados, inválidos e modos (funções puras com dados de exemplo). */
function testarEnvio() {
  const cls = (prots, modo, ex) => { const r = classificarEnvio(prots, modo, ex || []); return { e: r.entram, i: r.inval.map(x => x[0]), r: r.rep, d: r.dup, n: r.novas, a: r.atualizadas, x: r.removidas }; };
  _conferir([
    ['só dígitos, sem espaços e zeros à esquerda',    () => normalizarProtocolo(' 00123 456 ').key, '123456'],
    ['número vira chave',                             () => normalizarProtocolo(20263949575).key, '20263949575'],
    ['"123.0" vira 123',                              () => normalizarProtocolo('123.0').key, '123'],
    ['notação científica é inválida',                 () => normalizarProtocolo('1,23E+10').motivo, 'notação científica'],
    ['número grande (precisão perdida) é inválido',   () => normalizarProtocolo(1.23e19).ok, false],
    ['sem dígitos é inválido',                        () => normalizarProtocolo('abc').ok, false],
    ['só zeros é inválido',                           () => normalizarProtocolo('000').ok, false],
    ['vazio é inválido',                              () => normalizarProtocolo('').ok, false],
    ['repetido no arquivo: entra a 1ª',               () => cls(['10', '10', '11']), { e: [0, 2], i: [], r: [1], d: [], n: 2, a: 0, x: 0 }],
    ['10 e 0010 são o mesmo protocolo',               () => cls(['10', '0010']), { e: [0], i: [], r: [1], d: [], n: 1, a: 0, x: 0 }],
    ['inválidos não entram',                          () => cls(['10', '1,5E+9', 'x']), { e: [0], i: [1, 2], r: [], d: [], n: 1, a: 0, x: 0 }],
    ['acrescentar ignora o que já existe',            () => cls(['10', '11', '12'], 'acrescentar', ['11']), { e: [0, 2], i: [], r: [], d: [1], n: 2, a: 0, x: 0 }],
    ['substituir não olha o que existe',              () => cls(['10', '11'], 'substituir', ['11']), { e: [0, 1], i: [], r: [], d: [], n: 2, a: 0, x: 0 }],
    ['mesclar: atualiza, adiciona e remove',          () => cls(['10', '11'], 'mesclar', ['11', '12', '13']), { e: [0, 1], i: [], r: [], d: [], n: 1, a: 1, x: 2 }],
    ['mesclar mantém linha sem protocolo',            () => classificarEnvio(['10'], 'mesclar', ['', '10']).semProtocolo, 1],
    ['data do Excel vira data se a coluna é data',    () => converterCelula({ d: '2026-11-23 10:30:00' }, 'data', false) instanceof Date, true],
    ['data do Excel vira texto se a coluna é texto',  () => converterCelula({ d: '2026-11-23 10:30:00' }, 'texto', false), '2026-11-23 10:30:00'],
    ['texto dd/mm/aaaa vira data em coluna de data',  () => { const d = converterCelula('23/11/2026 10:30', 'data', false); return d instanceof Date && d.getMonth() === 10 && d.getHours() === 10; }, true],
    ['protocolo com zeros fica texto',                () => converterCelula('0012345', 'num', true), '0012345'],
    ['protocolo limpo em coluna numérica vira número',() => converterCelula('20263949575', 'num', true), 20263949575],
    ['protocolo em coluna de texto fica texto',       () => converterCelula(20263949575, 'texto', true), '20263949575'],
    ['acento quebrado é consertado',                  () => converterCelula('INSTALAÃ‡ÃƒO FIBRA', 'texto', false), 'INSTALAÇÃO FIBRA'],
    ['Reabertura "1" vira número em coluna numérica', () => converterCelula('1', 'num', false), 1],
    ['modos por aba',                                 () => [ENVIO[ABA_BASE].padrao, ENVIO[ABA_HOJE].padrao, ENVIO[ABA_ABERTOS].padrao, ENVIO[ABA_BASE].modos.indexOf('mesclar')], ['acrescentar', 'substituir', 'substituir', -1]],
    ['carimbos do Sincronismo',                       () => [ENVIO[ABA_ABERTOS].carimbo, ENVIO[ABA_HOJE].carimbo, ENVIO[ABA_BASE].carimbo], ['A2', 'B2', 'C2']]
  ]);
}

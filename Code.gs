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
  return u ? { ok: true, usuario: usuarioPublico(u) } : negaLogin();
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

/* ============ CONFIGURAÇÃO ============ */
// URL do app da web (termina em /exec), gerada ao implantar o Apps Script
const URL_PADRAO = 'https://script.google.com/macros/s/AKfycbzjGvrEjdWzpigLFrAdKCvhOv2DbqUrVWyoFYhtYs-aHTH90EK7y6cYBeSox3gpvFaymw/exec';
// Opcional: link CSV da aba "URL" publicada na web (assim você troca a URL só na planilha)
const URL_CSV = 'https://script.google.com/macros/s/AKfycbzjGvrEjdWzpigLFrAdKCvhOv2DbqUrVWyoFYhtYs-aHTH90EK7y6cYBeSox3gpvFaymw/exec';
// Atualização automática (minutos)
const AUTO_MIN = 5;
// Modo TV: tempo por tela (segundos), rotação automática entre Produção e Backlog e rolagem da lista
const TV_CFG = {
  rotacao: true,            // true = alterna Produção e Backlog; false = fica na tela atual
  segundosPorTela: 30,      // tempo de cada tela antes de alternar
  rolagemPxPorSegundo: 28,  // velocidade da rolagem automática da Produção quando a lista passa do tamanho da tela
  pausaTopoMs: 4000,        // pausa no começo da lista
  pausaFimMs: 4000          // pausa no fim da lista, antes de voltar ao topo
};
/* ====================================== */

const $ = id => document.getElementById(id);
const ic = n => '<svg class="i" aria-hidden="true"><use href="#i-' + n + '"/></svg>';
/* ----- rodapé: um único componente reaproveitado ----- */
document.querySelectorAll('[data-rodape]').forEach(n => n.replaceWith($('tplRodape').content.cloneNode(true)));
function fmtStamp(v) {
  if (v == null || v === '') return null;
  const t = String(v);
  const d = /^\d{10,}$/.test(t) ? new Date(Number(t)) : /^\d{4}-\d\d-\d\dT/.test(t) ? new Date(t) : null;
  if (d && !isNaN(d)) {
    const p = {}; new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).forEach(x => p[x.type] = x.value);
    return p.day + '/' + p.month + ' ' + p.hour + ':' + p.minute;
  }
  return t;
}
const store = {
  get(k, fb) { try { const v = localStorage.getItem(k); return v === null ? fb : JSON.parse(v); } catch (_) { return fb; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} }
};
const K = { filtros: 'dp_filtros_v4', codigo: 'dp_codigo', url: 'dp_url', view: 'dp_view', cred: 'dp_cred', auto: 'dp_auto', sess: 'dp_sessao' };

/* ----- modo de visualização automático -----
   Desktop = tela larga (>= 900px) com mouse/trackpad, ou com altura >= 620px (tablets e notebooks touch).
   Celular (inclusive deitado) e tablet em pé estreito ficam em Mobile. */
const mqDesk = window.matchMedia('(min-width: 900px) and (pointer: fine), (min-width: 900px) and (min-height: 620px)');
function aplicarModo() {
  document.body.classList.toggle('m-desk', mqDesk.matches);
  document.body.classList.toggle('m-mob', !mqDesk.matches);
}
aplicarModo();
if (mqDesk.addEventListener) mqDesk.addEventListener('change', aplicarModo); else mqDesk.addListener(aplicarModo);

let SCRIPT_URL = URL_PADRAO;
const urlValida = u => u.startsWith('https://script.google.com/macros/s/') && u.endsWith('/exec');

const state = Object.assign(
  { periodo: 'hoje', ini: '', fim: '', cal: { dias: [], meses: [] }, ordem: 'sup' },
  store.get(K.filtros, {})
);
state.busca = '';
state.dir = state.dir === 'asc' || state.dir === 'desc' ? state.dir : '';   // sentido da ordenação pelo cabeçalho ('' = o padrão da coluna)
state.grpFechado = new Set();       // equipes recolhidas na tabela (só na tela)
state.cmpModo = 'ontem';            // comparativo do KPI Concluídos: 'ontem' | 'sem'
state.codigo = store.get(K.codigo, '');
/* credenciais da sessão: sessionStorage (vale até fechar a aba) ou, se "Salvar credenciais" estiver ativo, o aparelho lembra e entra direto */
function lerCredenciais() {
  try { const o = JSON.parse(sessionStorage.getItem(K.sess) || 'null'); if (o && o.login && o.senha) return o; } catch (_) {}
  const c = store.get(K.cred, null);
  return c && c.login && c.senha && store.get(K.auto, true) ? { login: c.login, senha: c.senha } : null;
}
state.cred = lerCredenciais();     // { login, senha } ou null
state.user = null;                 // { papel: tecnico | supervisor | coordenador, nome, supervisor, coordenador }
state.sups = [];                   // equipes marcadas no filtro (chaves sem acento); vazio = todas
document.body.classList.toggle('sem-login', !state.cred);
if (state.periodo === 'cal' && !((state.cal.dias || []).length + (state.cal.meses || []).length)) state.periodo = 'hoje';
state.dados = null;
state.ultimaCarga = 0;
let carregando = false;

/* ----- tema claro / escuro / automático (Etapa 18) ----- */
const TEMA_K = 'dp_tema';
const mqClaro = window.matchMedia('(prefers-color-scheme: light)');
function temaEscolhido() { try { const v = localStorage.getItem(TEMA_K); return v === 'claro' || v === 'escuro' ? v : 'auto'; } catch (_) { return 'auto'; } }
function aplicarTema() {
  const e = temaEscolhido(), claro = e === 'claro' || (e === 'auto' && mqClaro.matches);
  document.documentElement.setAttribute('data-theme', claro ? 'light' : 'dark');
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', claro ? '#eef3fb' : '#0a111f');
  document.querySelectorAll('.tema-btn').forEach(b => {
    b.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-' + (claro ? 'sun' : 'moon') + '"/></svg>';
    b.setAttribute('aria-label', 'Tema: ' + (e === 'auto' ? 'automático' : e) + '. Escolher');
  });
  document.querySelectorAll('#temaMenu button').forEach(b => { const on = b.dataset.t === e; b.setAttribute('aria-checked', String(on)); b.classList.toggle('on', on); });
}
if (mqClaro.addEventListener) mqClaro.addEventListener('change', aplicarTema); else mqClaro.addListener(aplicarTema);
(function () {
  const menu = document.getElementById('temaMenu'); let aberto = null;
  const fechar = () => { menu.hidden = true; if (aberto) { aberto.setAttribute('aria-expanded', 'false'); aberto = null; } };
  document.querySelectorAll('.tema-btn').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    if (aberto === b) { fechar(); return; }
    fechar(); aberto = b; b.setAttribute('aria-expanded', 'true'); menu.hidden = false;
    const r = b.getBoundingClientRect();
    menu.style.top = Math.round(r.bottom + 6) + 'px'; menu.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px';
    const on = menu.querySelector('button.on') || menu.querySelector('button'); on.focus();
  }));
  menu.querySelectorAll('button').forEach(x => x.addEventListener('click', () => {
    try { localStorage.setItem(TEMA_K, x.dataset.t); } catch (_) {}
    aplicarTema(); const b = aberto; fechar(); if (b) b.focus();
  }));
  menu.addEventListener('keydown', e => {
    const bs = Array.from(menu.querySelectorAll('button')), i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i + bs.length - 1) % bs.length].focus(); }
    else if (e.key === 'Escape') { e.stopPropagation(); const b = aberto; fechar(); if (b) b.focus(); }
    else if (e.key === 'Tab') fechar();
  });
  document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) fechar(); });
})();

/* ----- utilidades ----- */
// abre um diálogo: o foco vai para o título e volta para quem abriu ao fechar (Esc fecha, nativo do <dialog>)
function abrirDlg(d, opener) {
  const de = opener || document.activeElement;
  d._opener = de && de !== document.body && de !== document.documentElement ? de : null;
  if (!d.open) d.showModal();
  document.body.classList.add('dlg-aberto');
  const t = d.querySelector('h2, h1');
  if (t && !d.querySelector('[autofocus]')) { t.tabIndex = -1; try { t.focus({ preventScroll: true }); } catch (_) {} }
}
document.querySelectorAll('dialog').forEach(d => d.addEventListener('close', () => {
  if (!document.querySelector('dialog[open]')) document.body.classList.remove('dlg-aberto');
  const o = d._opener; d._opener = null;
  if (o && document.contains(o)) { try { o.focus({ preventScroll: true }); } catch (_) {} }
}));
const semAcento = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const nk = s => semAcento(s).trim().replace(/\s+/g, ' ');
const MIN = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
const papel = () => (state.user && state.user.papel) || '';
const ehTec = () => papel() === 'tecnico';
const PAPEL_N = { tecnico: 'Técnico', supervisor: 'Supervisor', coordenador: 'Coordenador' };
const supsPadrao = () => papel() === 'supervisor' && state.user.supervisor ? [nk(state.user.supervisor)] : [];
const mesmoSet = (a, b) => a.length === b.length && a.slice().sort().join('|') === b.slice().sort().join('|');
const supKey = () => 'dp_sups_' + nk(state.cred ? state.cred.login : '');
// nomes bonitos a partir das chaves selecionadas
function supResumo(chaves, lista) {
  const nomes = (chaves || []).map(k => { const f = (lista || []).find(n => nk(n) === k); return tc(f || k); });
  return nomes.length <= 2 ? nomes.join(', ') : nomes.length + ' equipes';
}
function definirUsuario(u) {
  if (!u) return;
  const ant = state.user, mudou = !ant || ant.nome !== u.nome || ant.papel !== u.papel;
  state.user = u;
  ['p-tec', 'p-sup', 'p-coord'].forEach(c => document.body.classList.remove(c));
  document.body.classList.add({ tecnico: 'p-tec', supervisor: 'p-sup', coordenador: 'p-coord' }[u.papel] || 'p-sup');
  if (!mudou) return;
  const sv = store.get(supKey(), null);
  state.sups = u.papel === 'tecnico' ? [] : (Array.isArray(sv) ? sv : supsPadrao());
  if (ant || u.papel === 'tecnico') bl.f.sup = '';
  if (ant) { bl.dados = null; bl.itens = []; }
}
const tc = s => String(s || '').toLowerCase().replace(/(^|\s)(\S)(\S*)/g, (m, a, b, c) => a + (a && MIN.has(b + c) ? b + c : b.toUpperCase() + c));
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

async function pedir(url, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 45000);
  try { const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' }); return await r.json(); }
  finally { clearTimeout(t); }
}

async function resolverUrl() {
  // se o link CSV é o próprio endereço do app (nada a resolver), não faz um pedido extra ao Apps Script a cada chamada
  if (URL_CSV === URL_PADRAO) { if (urlValida(URL_PADRAO)) SCRIPT_URL = URL_PADRAO; return; }
  if (!URL_CSV.startsWith('https://')) { if (urlValida(URL_PADRAO)) SCRIPT_URL = URL_PADRAO; return; }
  try {
    const r = await fetch(URL_CSV + (URL_CSV.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
    const linha = (await r.text()).split('\n')[1] || '';
    const u = linha.split(',')[0].split('"').join('').trim();
    if (urlValida(u)) { SCRIPT_URL = u; store.set(K.url, u); return; }
  } catch (_) {}
  const salvo = store.get(K.url, '');
  if (urlValida(salvo)) SCRIPT_URL = salvo;
}

/* ----- parâmetros de pedido ----- */
function qPeriodo(q) {
  q.set('periodo', state.periodo);
  if (state.periodo === 'custom' && state.ini && state.fim) { q.set('ini', state.ini); q.set('fim', state.fim); }
  if (state.periodo === 'cal') { q.set('dias', state.cal.dias.join(',')); q.set('meses', state.cal.meses.join(',')); }
  return q;
}
function qAuth(q) {
  if (state.codigo) q.set('codigo', state.codigo);
  q.set('login', state.cred.login); q.set('senha', state.cred.senha);
  return q;
}
async function buscarServidor(q, ms) {
  await resolverUrl();
  if (!urlValida(SCRIPT_URL)) throw new Error('Falta configurar a URL do Apps Script no arquivo app.js.');
  const j = await pedir(SCRIPT_URL + '?' + q.toString(), ms || 45000);
  if (j && j.login) { sair('Sessão inválida. Entre novamente.'); throw new Error('Sessão inválida.'); }
  if (j && j.auth) { pedirCodigo(j.error); throw new Error(j.error || 'Código de acesso necessário.'); }
  if (!j || !j.ok) throw new Error((j && j.error) || 'Resposta inválida.');
  return j;
}
const msgErro = e => e && e.name === 'AbortError' ? 'A conexão demorou demais.' : (e && e.message && e.message !== 'Failed to fetch' ? e.message : 'Sem conexão. Não foi possível carregar.');

/* ----- "Carregando..." com erro e "Tentar de novo" (detalhes sob demanda) ----- */
// fn(ativo) busca e desenha; ativo() diz se este pedido ainda é o mais recente daquele quadro (evita preencher o diálogo errado)
async function comCarregando(box, fn) {
  const tok = box._tok = (box._tok || 0) + 1, ativo = () => box._tok === tok;
  box.innerHTML = '';
  const c = el('div', 'pload'); c.setAttribute('role', 'status'); c.appendChild(el('span', 'spin')); c.appendChild(document.createTextNode('Carregando...')); box.appendChild(c);
  try {
    await fn(ativo);
    if (ativo() && c.parentNode === box) box.removeChild(c);
  } catch (e) {
    if (!ativo()) return;
    box.innerHTML = '';
    const m = el('div', 'perro'); m.setAttribute('role', 'alert');
    m.appendChild(el('p', '', msgErro(e)));
    const b = el('button', 'btn', 'Tentar de novo'); b.type = 'button'; b.onclick = () => comCarregando(box, fn); m.appendChild(b);
    box.appendChild(m);
  }
}
// lista de OS de um técnico: usa a que já veio (Code.gs antigo) ou busca no servidor (lista = concl | play | agenda)
const CAMPO_LISTA = { concl: 'conclItens', play: 'playItens', agenda: 'agendaItens' };
async function detalheLista(t, lista) {
  const campo = CAMPO_LISTA[lista];
  if (Array.isArray(t[campo])) return t[campo];
  const q = qAuth(qPeriodo(new URLSearchParams({ acao: 'detalhe', tec: t.nome, lista: lista })));
  const j = await buscarServidor(q);
  t[campo] = Array.isArray(j.itens) ? j.itens : [];
  return t[campo];
}
const nPlay = t => t.playN != null ? t.playN : (t.playItens || []).length;

/* ----- cache local da última resposta (Etapa 9) -----
   Guarda só a resposta do servidor (sem login e sem senha), por usuário e por filtro de período. Não é PWA: só localStorage. */
const LC = 'dp_c1:';
const hash36 = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };
const lcUser = () => nk(state.cred ? state.cred.login : '');
const lcSig = () => hash36(JSON.stringify([state.periodo, state.ini, state.fim, state.cal]));
const lcKeyProd = () => LC + lcUser() + ':prod:' + lcSig();
const lcKeyBlk = () => LC + lcUser() + ':blk';
function lcLer(k, ehProducao) {
  try {
    const o = JSON.parse(localStorage.getItem(k) || 'null');
    if (!o || !o.d || !o.d.ok || !o.d.usuario || !(ehProducao ? Array.isArray(o.d.tecnicos) : Array.isArray(o.d.itens))) return null;
    return o;
  } catch (_) { return null; }
}
function lcApagar(prefixo, manter) {
  try { Object.keys(localStorage).filter(k => k.indexOf(prefixo) === 0 && k !== manter).forEach(k => localStorage.removeItem(k)); } catch (_) {}
}
function lcGravar(k, d, prefixoLimpar) {
  const gravar = () => localStorage.setItem(k, JSON.stringify({ t: Date.now(), d: d }));
  try { gravar(); }
  catch (_) {                                              // cheio: tira o que é do próprio painel e tenta uma vez; se não couber, ignora sem erro
    try { lcApagar(LC, k); gravar(); } catch (__) {}
  }
  if (prefixoLimpar) lcApagar(prefixoLimpar, k);           // um só filtro guardado por usuário (evita acumular)
}
const lcLimpa = login => lcApagar(LC + nk(login || '') + ':');
const hhmm = ms => { const p = {}; new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).forEach(x => p[x.type] = x.value); return p.hour + ':' + p.minute; };
const fmtIdade = m => m < 1 ? '<1 min' : m < 60 ? Math.floor(m) + ' min' : Math.floor(m / 60) + 'h' + String(Math.floor(m % 60)).padStart(2, '0');
// "dados de há X min" (mesma régua de cores da sincronização: até 30 min verde, 31 a 60 laranja, acima de 60 vermelho)
function pintarFrescor(box, dadosEm, doCache, atualizando) {
  if (!box) return;
  if (!dadosEm) { box.hidden = true; return; }
  const idade = (Date.now() - dadosEm) / 60000;
  box.hidden = false;
  box.className = 'frescor ' + (idade <= 30 ? 'f-ok' : idade <= 60 ? 'f-warn' : 'f-bad');
  box.textContent = doCache && atualizando ? 'Dados de ' + hhmm(dadosEm) + ', atualizando...' : 'Dados de há ' + fmtIdade(idade);
}
// "ao vivo" = dado novo vindo do servidor; guardado ou sem conexão não pulsa (indicador "Hoje" e Play)
function semVivo(v) { document.body.classList.toggle('sem-vivo', !!v); }
const mostrarFrescor = () => { pintarFrescor($('frescor'), state.dadosEm, state.doCache, carregando); if (!emBacklog()) semVivo(state.doCache || state.offline); };
const blFrescor = () => { pintarFrescor($('bFrescor'), bl.dadosEm, bl.doCache, bl.carregando); if (emBacklog()) semVivo(bl.doCache || bl.offline); };

/* ----- alertas dentro do painel (Etapa 16): sem push e sem PWA, só com a página aberta ----- */
function alertaSync() {
  const box = $('alertaSync'); if (!box) return;
  let ms = null;
  if (emBacklog()) ms = bl.dados && bl.dados.abertosAtualizadoMs;
  else if (state.dados && state.periodo === 'hoje') ms = state.dados.hojeAtualizadoMs;
  const idade = ms ? (Date.now() - Number(ms)) / 60000 : null;
  if (idade == null || isNaN(idade) || idade <= 60) { box.hidden = true; box.textContent = ''; document.body.classList.remove('com-alerta'); return; }
  box.textContent = 'Dados sem atualizar há ' + fmtIdade(idade) + '. Avise o responsável pela planilha';
  box.hidden = false; document.body.classList.add('com-alerta');
}
function tituloAba() {
  const n = bl.dados ? bl.itens.filter(vence4).length : 0;
  document.title = (n ? '(' + n + ') ' : '') + (emBacklog() ? 'Backlog' : 'Produção Parcial');
}
const NOTIF_K = 'dp_notif';
function notificarVencimentos() {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !bl.dados) return;
  try {
    let vistos = []; try { vistos = JSON.parse(localStorage.getItem(NOTIF_K) || '[]'); } catch (_) {}
    const novos = bl.itens.filter(vence4).filter(x => vistos.indexOf(x.id + ':' + x.pz) < 0);
    novos.slice(0, 5).forEach(x => { try { new Notification('OS perto do vencimento', { body: '#' + x.id + ' · ' + (x.cli ? tc(x.cli) : 'cliente') + ' · vence às ' + fmtDH(x.pz).slice(11), tag: 'os-' + x.id }); } catch (_) {} });
    if (novos.length) { vistos = vistos.concat(novos.map(x => x.id + ':' + x.pz)).slice(-300); localStorage.setItem(NOTIF_K, JSON.stringify(vistos)); }
  } catch (_) {}
}
function botaoNotif() {
  const b = $('bNotif'); if (!b) return;
  b.hidden = !('Notification' in window) || Notification.permission !== 'default';
}
$('bNotif').onclick = () => {
  try { const r = Notification.requestPermission(); const fim = () => { botaoNotif(); notificarVencimentos(); }; if (r && r.then) r.then(fim, fim); else fim(); } catch (_) { botaoNotif(); }
};

/* ----- aviso ----- */
function aviso(msg, tipo, retry) {
  const box = $('aviso');
  box.innerHTML = '';
  if (!msg) return;
  const b = el('div', 'banner' + (tipo === 'info' ? ' info' : ''), msg);
  b.setAttribute('role', 'alert');
  if (retry) { const bt = el('button', '', 'Tentar de novo'); bt.type = 'button'; bt.onclick = () => carregar(); b.appendChild(bt); }
  box.appendChild(b);
}

/* ----- carregamento ----- */
function esqueleto() {
  const r = $('rows'); r.innerHTML = '';
  for (let i = 0; i < 8; i++) r.appendChild(el('div', 'skel'));
}

async function carregar() {
  if (carregando || !state.cred) return;
  carregando = true;
  document.body.classList.add('loading');
  // mostra na hora o que ficou guardado (mesmo usuário e mesmo filtro); o esqueleto só aparece quando não há nada guardado
  if (!state.dados || state.dadosSig !== lcSig()) {
    const g = lcLer(lcKeyProd(), true);
    if (g) { definirUsuario(g.d.usuario); state.dados = g.d; state.dadosEm = g.t; state.doCache = true; state.dadosSig = lcSig(); render(); }
    else if (!state.dados) esqueleto();
  }
  aviso('');
  mostrarFrescor();

  await resolverUrl();
  if (!urlValida(SCRIPT_URL)) {
    carregando = false; document.body.classList.remove('loading');
    $('rows').innerHTML = '';
    aviso('Falta configurar a URL do Apps Script no arquivo index.html.');
    return;
  }

  const q = qAuth(qPeriodo(new URLSearchParams()));
  q.set('leve', '1');     // resposta leve: contadores no lugar das listas de OS (Code.gs antigo ignora e manda tudo)

  try {
    const j = await pedir(SCRIPT_URL + '?' + q.toString());
    if (j && j.login) { carregando = false; document.body.classList.remove('loading'); sair('Sessão inválida. Entre novamente.'); return; }
    if (j && j.auth) { carregando = false; document.body.classList.remove('loading'); pedirCodigo(j.error); return; }
    if (!j || !j.ok) throw new Error((j && j.error) || 'Resposta inválida.');
    if (!j.usuario) throw new Error('O Apps Script ainda está na versão antiga. Cole o novo Code.gs e publique uma nova versão da implantação.');
    definirUsuario(j.usuario);
    state.dados = j;
    state.ultimaCarga = Date.now();
    state.offline = false; state.dadosEm = state.ultimaCarga; state.doCache = false; state.dadosSig = lcSig();
    lcGravar(lcKeyProd(), j, LC + lcUser() + ':prod:');
    render();
  } catch (e) {
    $('rows').innerHTML = state.dados ? $('rows').innerHTML : '';
    const abortou = e && e.name === 'AbortError';
    const rede = abortou || !e || !e.message || e.message === 'Failed to fetch';
    state.offline = !!(state.dados && rede);
    if (state.dados && rede) aviso('Sem conexão, mostrando dados de ' + hhmm(state.dadosEm) + '.', 'info', true);   // os dados guardados continuam na tela
    else aviso(abortou ? 'A conexão demorou demais.'
      : (e && e.message && e.message !== 'Failed to fetch' ? e.message : 'Não foi possível carregar os dados.'),
      'erro', true);
  } finally {
    carregando = false;
    document.body.classList.remove('loading');
    mostrarFrescor();
  }
}

/* ----- código de acesso ----- */
function pedirCodigo(msg) {
  $('cMsg').textContent = msg || 'Digite o código para ver o painel.';
  $('cInput').value = '';
  const d = $('dlgCodigo');
  abrirDlg(d);
  setTimeout(() => $('cInput').focus(), 50);
}
$('cForm').addEventListener('submit', () => {
  state.codigo = $('cInput').value.trim();
  store.set(K.codigo, state.codigo);
  setTimeout(() => (emBacklog() ? carregarBacklog() : carregar()), 0);
});

/* ----- ordenação: menu "Ordenar por" e cabeçalho da tabela (sincronizados) ----- */
const COL_ORD = ['reabInst', 'reabPend', 'inst', 'pend', 'concl', 'play', 'nome'];
const ORD_VALIDAS = COL_ORD.concat(['sup', 'atencao', 'reab']);
const dirPadrao = k => (k === 'nome' || k === 'play') ? 'asc' : 'desc';
const dirAtual = () => state.dir || dirPadrao(state.ordem);
if (ORD_VALIDAS.indexOf(state.ordem) < 0) state.ordem = 'sup';
function salvarFiltros() { store.set(K.filtros, { periodo: state.periodo, ini: state.ini, fim: state.fim, cal: state.cal, ordem: state.ordem, dir: state.dir }); }
function ordenarPor(k) {
  if (state.ordem === k) state.dir = dirAtual() === 'asc' ? 'desc' : 'asc';     // clicar de novo inverte
  else { state.ordem = k; state.dir = ''; }
  salvarFiltros(); render();
}
function pintarCabecalho() {
  document.querySelectorAll('.thead [data-k].th, .thead .th').forEach(b => {
    const k = b.dataset.k, on = state.ordem === k, cel = b.parentElement;
    b.classList.toggle('on', on);
    const s = b.querySelector('.seta'); if (s) s.remove();
    if (on) { const x = el('i', 'seta', dirAtual() === 'asc' ? '▲' : '▼'); x.setAttribute('aria-hidden', 'true'); b.appendChild(x); }
    cel.setAttribute('aria-sort', on ? (dirAtual() === 'asc' ? 'ascending' : 'descending') : 'none');
    b.title = on ? 'Ordenado ' + (dirAtual() === 'asc' ? 'do menor para o maior' : 'do maior para o menor') + '. Clique para inverter.' : 'Ordenar por esta coluna';
  });
}
document.querySelectorAll('.thead .th').forEach(b => { b.addEventListener('click', () => ordenarPor(b.dataset.k)); });

/* ----- cálculo do que aparece ----- */
function listaVisivel() {
  const d = state.dados; if (!d) return [];
  const b = semAcento(state.busca).trim();
  let l = d.tecnicos.filter(t =>
    (!b || semAcento(t.nome).includes(b)) && (ehTec() || !state.sups.length || state.sups.includes(nk(t.supervisor))));
  const ordNivel = { atencao: 0, obs: 1, normal: 2, acima: 3 };
  const nm = (a, c) => a.nome.localeCompare(c.nome, 'pt-BR');
  const o = state.ordem;
  const sp = (a, c) => {
    const x = a.supervisor || '', y = c.supervisor || '';
    if (!x !== !y) return x ? -1 : 1;            // sem supervisor vai para o fim
    return x.localeCompare(y, 'pt-BR');
  };
  // Play: agrupa por situação (▶ em play, ■ agendado, ⏳ terminou, 👻 fantasma) e, dentro de cada grupo, A a Z
  const ordPlay = { play: 0, parado: 1, fim: 2, vazio: 3, na: 4 };
  const sg = dirAtual() === dirPadrao(o) ? 1 : -1;   // 1 = sentido padrão da coluna, -1 = invertido
  const num = k => (a, c) => (sg === 1 ? (Number(c[k]) || 0) - (Number(a[k]) || 0) : (Number(a[k]) || 0) - (Number(c[k]) || 0)) || nm(a, c);
  l = l.slice().sort(COL_ORD.indexOf(o) >= 0 && ['reabInst', 'reabPend', 'inst', 'pend'].indexOf(o) >= 0 ? num(o) : (a, c) =>
    o === 'play' ? sg * ((ordPlay[a.play] ?? 9) - (ordPlay[c.play] ?? 9)) || nm(a, c) :
    o === 'sup' ? sp(a, c) || (c.concl - a.concl) || nm(a, c) :
    o === 'nome' ? (sg === 1 ? nm(a, c) : nm(c, a)) :
    o === 'atencao' ? (ordNivel[a.nivel] - ordNivel[c.nivel]) || (a.concl - c.concl) || nm(a, c) :
    o === 'reab' ? ((c.reabInst + c.reabPend) - (a.reabInst + a.reabPend)) || (c.concl - a.concl) || nm(a, c) :
    (sg === 1 ? c.concl - a.concl : a.concl - c.concl) || nm(a, c));
  return l;
}

/* ----- medalhas (Etapa 11): 1º, 2º e 3º com mais concluídos na lista visível; empate recebe a mesma medalha ----- */
function medalhas(lista) {
  const r = new Map();
  if (lista.length < 3) return r;
  const top = Math.max.apply(null, lista.map(t => t.concl));
  if (top < 1) return r;
  lista.forEach(t => {
    if (!(t.concl >= 1)) return;
    const pos = 1 + lista.filter(o => o.concl > t.concl).length;     // 1 + quantos têm mais
    if (pos <= 3) r.set(t, pos);
  });
  return r;
}
const NIVEL_EXT = { atencao: 'atenção', obs: 'observação', normal: 'normal', acima: 'acima da meta' };
const NIVEL_SIM = { atencao: '▼', obs: '●', normal: '✔', acima: '▲' };
const MEDALHA_N = { 1: 'Ouro (1º lugar)', 2: 'Prata (2º lugar)', 3: 'Bronze (3º lugar)' };
const fmtN2 = n => (Math.round(n * 100) / 100).toString().replace('.', ',');

/* linha de cabeçalho da equipe (ordenação por supervisor): técnicos ativos, concluídos, meta e Gap do grupo (mesma conta do Gap geral) */
function linhaEquipe(gk, membros, temMeta, diario) {
  const nome = gk === '_sem' ? 'Sem supervisor' : tc(membros[0].supervisor);
  const ativos = membros.filter(t => t.ativo !== false).length;
  const concl = membros.reduce((s, t) => s + t.concl, 0);
  const meta = temMeta ? membros.reduce((s, t) => s + (Number(t.metaPer) || 0), 0) : ativos * 5;
  const fechado = state.grpFechado.has(gk);
  const r = el('div', 'grp' + (fechado ? ' fechado' : '')); r.setAttribute('role', 'row');
  const b = el('button', 'grp-btn'); b.type = 'button'; b.setAttribute('aria-expanded', String(!fechado));
  b.setAttribute('aria-label', 'Equipe ' + nome + ': ' + (fechado ? 'expandir' : 'recolher'));
  b.innerHTML = ic('chev'); b.appendChild(el('b', '', nome));
  b.onclick = () => { if (state.grpFechado.has(gk)) state.grpFechado.delete(gk); else state.grpFechado.add(gk); render(); };
  r.appendChild(b);
  const st = el('div', 'grp-i');
  const it = (k, v, cls) => { const s = el('span', cls || ''); s.appendChild(document.createTextNode(k + ' ')); s.appendChild(el('b', '', String(v))); st.appendChild(s); };
  it('Ativos', ativos); it('Concl.', concl);
  if ((diario || temMeta) && meta) {
    const g = Math.round((concl - meta) * 100) / 100;
    it('Meta', fmtN2(meta)); it('Gap', (g > 0 ? '+' : '') + fmtN2(g), g > 0 ? 'pos' : g < 0 ? 'neg' : '');
  } else { it('Meta', '--'); it('Gap', '--'); }
  r.appendChild(st);
  return r;
}

function celula(valor, extra) {
  const c = el('div', 'c' + (extra ? ' ' + extra : '') + (valor === 0 && !extra ? ' zero' : ''), String(valor));
  c.setAttribute('role', 'cell');
  return c;
}

/* ----- Play (aba Base_Abertos) ----- */
// ▶ em execução · ■ agendado, ainda não iniciou · ⏳ sem agenda mas já concluiu · 👻 sem agenda e sem conclusão
const PLAY_TXT = { parado: 'Agendado, ainda não iniciou', fim: 'Agenda concluída', vazio: 'Nada agendado para este técnico', na: 'Base de abertos indisponível' };
function celulaPlay(t) {
  const c = el('div', 'pl'); c.setAttribute('role', 'cell');
  if (t.play === 'play' || t.play === 'parado' || t.play === 'fim' || t.play === 'vazio') {
    const rot = { play: 'Em execução: ver atividade', parado: 'Ver clientes agendados', fim: 'Agenda concluída', vazio: 'Sem agendamentos e sem conclusões' }[t.play];
    const b = el('button', 'pl-btn ' + t.play); b.type = 'button';
    b.innerHTML = ic({ play: 'play', fim: 'hourglass', vazio: 'ghost' }[t.play] || 'stop');
    b.title = rot;
    b.setAttribute('aria-label', tc(t.nome) + ': ' + rot);
    b.addEventListener('click', e => { e.stopPropagation(); abrirPlay(t); });
    b.addEventListener('keydown', e => e.stopPropagation());
    c.appendChild(b);
  } else {
    const s = el('span', 'pl-ic na', '–'); s.title = PLAY_TXT.na; c.appendChild(s);
  }
  return c;
}
// Selo vermelho "Em atraso" (tem texto e ícone, não depende só da cor). base = 'pchip' (cartões do Play) ou 'tag' (Backlog)
function seloAtraso(base) {
  const s = el('span', base + ' bad selo-atr');
  s.title = 'OS em atraso';
  s.innerHTML = ic('alert');
  s.appendChild(document.createTextNode('Em atraso'));
  return s;
}
function cartaoOS(p, rotulo, extra) {
  const card = el('div', 'pcard' + (extra ? ' ' + extra : ''));
  // cabeçalho: situação (Em execução / Agendado / Concluído) + empresa + status da OS (igual ao Backlog)
  const hd = el('div', 'pc-head');
  const lv = el('div', 'live'); lv.appendChild(el('i')); lv.appendChild(document.createTextNode(rotulo)); hd.appendChild(lv);
  if (p.emp) { const e = el('span', 'pchip', p.emp); e.title = 'Empresa'; e.style.setProperty('--h', empH(p.emp)); hd.appendChild(e); }
  if (p.status) { const st = el('span', 'pchip', p.status); st.title = 'Status da OS'; st.style.setProperty('--h', hueDe(p.status, ST_H)); hd.appendChild(st); }
  if (p.atr) hd.appendChild(seloAtraso('pchip'));
  card.appendChild(hd);
  [['Tipo', p.tipo], ['Protocolo', p.protocolo], ['Cliente', p.cliente], ['Cidade', p.cidade], ['Bairro', p.bairro]].concat(p.tecnico ? [['Técnico', tc(p.tecnico)]] : []).forEach(([k, v]) => {
    const f = el('div', 'pf'); f.appendChild(el('span', '', k)); f.appendChild(el('b', '', v || '—')); card.appendChild(f);
  });
  return card;
}
function abrirPlay(t) {
  const sup = t.supervisor ? 'Supervisor: ' + tc(t.supervisor) + ' · ' : '';
  const box = $('pLista'); box.innerHTML = '';
  $('pNome').textContent = tc(t.nome);
  const desenhar = (pl, ag) => {
    box.innerHTML = '';
    if (t.play === 'play') {
      $('pSub').textContent = sup + 'Em execução: ' + pl.length + ' · Agendadas: ' + ag.length;
      pl.forEach(p => box.appendChild(cartaoOS(p, 'Em execução')));
      ag.forEach(p => box.appendChild(cartaoOS(p, 'Agendado', 'ag')));
    } else if (t.play === 'parado') {
      $('pSub').textContent = sup + 'Sem play · ' + ag.length + (ag.length === 1 ? ' agendado' : ' agendados');
      ag.forEach(p => box.appendChild(cartaoOS(p, 'Agendado', 'ag')));
    } else if (t.play === 'fim') {
      $('pSub').textContent = sup + 'Concluídos: ' + (t.concl || 0);
      const v = el('div', 'pvazio'); v.innerHTML = ic('hourglass');
      v.appendChild(el('b', '', 'Agenda concluída'));
      v.appendChild(el('p', '', 'Já encerrou OS e não tem mais nada agendado.'));
      box.appendChild(v);
    } else {
      $('pSub').textContent = sup + 'Sem demanda';
      const v = el('div', 'pvazio'); v.innerHTML = ic('ghost');
      v.appendChild(el('b', '', 'Sem agendamentos'));
      v.appendChild(el('p', '', 'Sem nada agendado e nenhuma OS concluída.'));
      box.appendChild(v);
    }
  };
  abrirDlg($('dlgPlay'));
  if (t.play !== 'play' && t.play !== 'parado') { desenhar([], []); return; }
  const prontas = (t.play !== 'play' || Array.isArray(t.playItens)) && Array.isArray(t.agendaItens);
  if (prontas) { desenhar(t.play === 'play' ? t.playItens : [], t.agendaItens); return; }
  $('pSub').textContent = sup + 'Carregando...';
  comCarregando(box, async ativo => {
    const pl = t.play === 'play' ? await detalheLista(t, 'play') : [];
    const ag = await detalheLista(t, 'agenda');
    if (ativo()) desenhar(pl, ag);
  });
}
// clique no valor de Concluídos: lista as OS concluídas do técnico no mesmo padrão dos cartões do Play
function abrirConcluidos(t, opener) {
  const sup = t.supervisor ? 'Supervisor: ' + tc(t.supervisor) + ' · ' : '';
  const box = $('pLista'); box.innerHTML = '';
  $('pNome').textContent = tc(t.nome);
  const n = Number(t.concl) || 0;
  const desenhar = l => {
    box.innerHTML = '';
    $('pSub').textContent = sup + 'Concluídos: ' + n + (l.length < n ? ' (mostrando ' + l.length + ')' : '');
    if (!l.length) {
      const v = el('div', 'pvazio'); v.innerHTML = ic('check');
      v.appendChild(el('b', '', 'Nenhuma OS concluída'));
      v.appendChild(el('p', '', 'Este técnico ainda não concluiu nenhuma OS no período.'));
      box.appendChild(v);
    } else l.forEach(p => box.appendChild(cartaoOS(p, 'Concluído', 'cc')));
  };
  abrirDlg($('dlgPlay'), opener);
  if (Array.isArray(t.conclItens)) { desenhar(t.conclItens); return; }
  if (!n) { desenhar([]); return; }
  $('pSub').textContent = sup + 'Carregando...';
  comCarregando(box, async ativo => { const l = await detalheLista(t, 'concl'); if (ativo()) desenhar(l); });
}
$('pFechar').onclick = () => $('dlgPlay').close();

/* ----- faixa de contexto ----- */
const NOME_P = { tudo: 'todo o período', ontem: 'ontem', ultimo: 'último dia com dados', '7d': 'últimos 7 dias', mes: 'mês atual', custom: 'período personalizado', cal: 'produção mensal' };
function mostrarModo() {
  const m = $('modo'), p = state.periodo, hoje = p === 'hoje';
  // cor do alerta conforme a idade da última sincronização (Sincronismo!B2): até 30 min verde, 31–60 laranja, >60 vermelho
  const ms = state.dados && state.dados.hojeAtualizadoMs, idade = ms ? (Date.now() - Number(ms)) / 60000 : null;
  const nivel = idade == null || isNaN(idade) ? '' : idade <= 30 ? '' : idade <= 60 ? ' sync-warn' : ' sync-bad';
  m.innerHTML = ''; m.className = 'modo ' + (hoje ? 'hoje' : 'hist') + (hoje ? nivel : '');
  m.appendChild(el('span', 'dot'));
  const mi = el('span', 'mi'); mi.innerHTML = ic('calcheck'); m.appendChild(mi);
  const t = el('div', 'mt');
  t.appendChild(el('b', '', hoje ? 'Produção de hoje' : 'Filtro: ' + (p === 'cal' && state.dados && state.dados.periodo ? state.dados.periodo.rotulo : (NOME_P[p] || p))));
  const dd = state.dados || {};
  const up = el('span', 'up');
  up.appendChild(document.createTextNode('Atualizado em '));
  up.appendChild(el('em', '', fmtStamp(dd.hojeAtualizadoMs || dd.hojeAtualizado) || dd.atualizado || '--'));
  t.appendChild(up);
  m.appendChild(t);
  if (hoje) { const v = el('span', 'live'); v.innerHTML = ic('refresh') + (idade != null && !isNaN(idade) ? 'há ' + (idade < 1 ? '<1' : idade < 60 ? Math.floor(idade) : Math.floor(idade / 60) + 'h' + String(Math.floor(idade % 60)).padStart(2, '0')) + (idade < 60 ? ' min' : '') : 'Ao vivo'); m.appendChild(v); return; }
  const b = el('button', '', 'Voltar para hoje'); b.type = 'button';
  b.onclick = () => { state.periodo = 'hoje'; state.ini = ''; state.fim = ''; salvarFiltros(); carregar(); };
  m.appendChild(b);
}

/* ----- desenho ----- */
// cores dos concluídos (produção diária): até 2 vermelho · 3 laranja · 4 e 5 verde · acima de 5 azul
// reserva para Code.gs ANTIGO (sem o campo "expediente"): o servidor novo já devolve o nível pronto
const nivelDiaReserva = c => c <= 2 ? 'atencao' : c === 3 ? 'obs' : c <= 5 ? 'normal' : 'acima';
function render() {
  const d = state.dados; if (!d) return;
  const diario = state.periodo === 'hoje' || state.periodo === 'ontem' || !!(d.periodo && d.periodo.ini && d.periodo.ini === d.periodo.fim);
  // nível (cor): regra única no servidor. Só recalcula aqui se o Code.gs ainda for o antigo.
  if (!d.expediente) (d.tecnicos || []).forEach(t => { if (t.nivelBase === undefined) t.nivelBase = t.nivel; t.nivel = t.metasTipo ? t.nivelBase : diario ? nivelDiaReserva(Number(t.concl) || 0) : t.nivelBase; });
  // data/hora = última alteração da base de encerrados de hoje (campo hojeAtualizado); cai para d.atualizado se o script ainda não envia
  $('subtitulo').textContent = d.periodo
    ? (d.periodo.ini === d.periodo.fim ? d.periodo.rotulo : d.periodo.rotulo + ' (' + d.periodo.iniBR + ' a ' + d.periodo.fimBR + ')')
    : '';

  // identificação de quem está logado (+ equipes em exibição, quando não for só a própria)
  if (state.user) {
    const existentes = (d.supervisores || []).map(nk);
    if (existentes.length) state.sups = state.sups.filter(k => existentes.includes(k));
    let sub = PAPEL_N[state.user.papel] + ': ' + tc(state.user.nome);
    if (!ehTec()) {
      if (!state.sups.length) sub += ' · Todas as equipes';
      else if (!mesmoSet(state.sups, supsPadrao())) sub += ' · ' + supResumo(state.sups, d.supervisores);
    }
    $('subtitulo').textContent = sub;
  }

  mostrarModo();
  mostrarFrescor();
  alertaSync(); tituloAba();

  if (d.baseVazia) aviso('A aba Encerramentos ainda não tem dados. Importe o relatório de encerrados.', 'info');
  else aviso('');

  const lista = listaVisivel();
  const rows = $('rows'); rows.innerHTML = '';
  if (!lista.length) {
    const filtrado = state.busca || state.sups.length;
    const v = el('div', 'vazio', filtrado ? 'Nenhum técnico encontrado.' : 'Nenhum técnico cadastrado.');
    if (filtrado) { const b = el('button', 'btn vz-btn', 'Limpar busca e filtros'); b.type = 'button'; b.onclick = limparBuscaFiltros; v.appendChild(b); }
    rows.appendChild(v);
  }
  // linhas de equipe só na ordenação por supervisor (a padrão); recolher não altera os KPIs, que somam a lista inteira
  const agrupar = state.ordem === 'sup' && lista.length > 0;
  const temMetaL = lista.some(t => t.metaPer !== undefined);
  const medal = medalhas(lista);
  let grpAtual = null;
  lista.forEach(t => {
    if (agrupar) {
      const gk = nk(t.supervisor) || '_sem';
      if (gk !== grpAtual) { grpAtual = gk; rows.appendChild(linhaEquipe(gk, lista.filter(o => (nk(o.supervisor) || '_sem') === gk), temMetaL, diario)); }
      if (state.grpFechado.has(gk)) return;
    }
    const r = el('div', 'grid row ' + t.nivel);
    r.setAttribute('role', 'row');
    r.setAttribute('aria-label', tc(t.nome) + ': ' + t.concl + ' concluídos, nível ' + (NIVEL_EXT[t.nivel] || t.nivel));
    r.appendChild(celula(t.reabInst, t.reabInst > 0 ? 'red' : ''));
    r.appendChild(celula(t.reabPend, t.reabPend > 0 ? 'red' : ''));
    r.appendChild(celula(t.inst));
    r.appendChild(celula(t.pend));
    const cc = celula('', t.nivel + ' clk');
    const cb = el('button', 'c-btn'); cb.type = 'button';
    cb.appendChild(document.createTextNode(String(t.concl)));
    // a cor não é a única pista: símbolo do nível (▼ atenção, ● observação, ✔ normal, ▲ acima) e nível por extenso para leitor de tela
    const sy = el('span', 'nv', NIVEL_SIM[t.nivel] || ''); sy.setAttribute('aria-hidden', 'true'); cb.appendChild(sy);
    cb.title = 'Ver OS concluídas · nível ' + (NIVEL_EXT[t.nivel] || t.nivel);
    cb.setAttribute('aria-label', tc(t.nome) + ': ' + t.concl + ' concluídos, nível ' + (NIVEL_EXT[t.nivel] || t.nivel) + '. Ver as OS concluídas');
    cb.addEventListener('click', e => { e.stopPropagation(); abrirConcluidos(t, cb); });
    cc.appendChild(cb);
    r.appendChild(cc);
    r.appendChild(celulaPlay(t));
    const n = el('div', 'nome'); n.setAttribute('role', 'cell');
    const nb = el('button', 'tec-btn'); nb.type = 'button'; nb.setAttribute('aria-label', 'Abrir detalhes de ' + tc(t.nome));
    nb.addEventListener('click', e => { e.stopPropagation(); abrirTecnico(t, nb); });
    if (medal.has(t)) { const m = el('span', 'medal m' + medal.get(t), String(medal.get(t))); m.title = MEDALHA_N[medal.get(t)]; m.setAttribute('role', 'img'); m.setAttribute('aria-label', MEDALHA_N[medal.get(t)]); nb.appendChild(m); }
    nb.appendChild(document.createTextNode(tc(t.nome)));
    n.appendChild(nb);
    if (t.semBase) n.appendChild(el('small', '', 'nome não aparece na base'));
    r.appendChild(n);
    const cv = el('div', 'chev'); cv.setAttribute('aria-hidden', 'true'); cv.innerHTML = ic('chev'); r.appendChild(cv);
    r.addEventListener('click', () => abrirTecnico(t));          // clique na linha: para quem usa mouse; no teclado o controle é o nome do técnico
    rows.appendChild(r);
  });

  // cartões e detalhes (seguem busca e filtro)
  const s = lista.reduce((a, t) => {
    a.concl += t.concl; a.inst += t.inst; a.pend += t.pend; a.outros += t.outros;
    a.reabI += t.reabInst; a.reabP += t.reabPend; a.reabO += t.reabOutros;
    a.canc += t.cancel; a.atraso += t.atraso;
    a[t.nivel] = (a[t.nivel] || 0) + 1; return a;
  }, { concl: 0, inst: 0, pend: 0, outros: 0, reabI: 0, reabP: 0, reabO: 0, canc: 0, atraso: 0, atencao: 0, obs: 0, normal: 0, acima: 0 });

  // técnicos ativos: com OS agendada (Hoje) ou que já encerraram alguma OS; ausentes não entram na contagem nem na meta
  const nAtivos = lista.filter(t => t.ativo !== false).length;
  $('kTec').textContent = nAtivos;
  $('kPend').textContent = s.pend;
  $('kInst').textContent = s.inst;
  // atividades em play agora (OS com em_play = Sim dos técnicos visíveis)
  $('kPlay').textContent = lista.reduce((a, t) => a + nPlay(t), 0);
  $('kConcl').textContent = s.concl;
  // Meta = soma da meta de cada técnico (Meta I..IV do Tipo x dias produzidos). Servidor antigo (sem metaPer): técnicos ativos x 5
  const temMeta = lista.some(t => t.metaPer !== undefined);
  const kc = $('kConcl').parentElement;
  const meta = temMeta ? lista.reduce((a, t) => a + (Number(t.metaPer) || 0), 0) : nAtivos * 5;
  const fmtN = n => (Math.round(n * 100) / 100).toString().replace('.', ',');
  kc.classList.toggle('prog', state.periodo === 'hoje');
  // Gap: começa em -meta vermelho cheio; esvazia para preto conforme os concluídos sobem; na meta = 0; acima = +excedente com troféu
  const gc = $('kGapCard'), gv = $('kGap');
  if ((diario || temMeta) && meta) {
    const g = Math.round((s.concl - meta) * 100) / 100;
    gv.textContent = g > 0 ? '+' + fmtN(g) : fmtN(g);
    gc.style.setProperty('--gf', Math.max(0, 100 - s.concl / meta * 100).toFixed(1) + '%');
    gc.classList.toggle('trofeu', g > 0);
    $('kGapIcon').innerHTML = '<use href="#i-' + (g > 0 ? 'trophy' : 'gap') + '"/>';
  } else {
    gv.textContent = '--'; gc.style.setProperty('--gf', '0%'); gc.classList.remove('trofeu');
    $('kGapIcon').innerHTML = '<use href="#i-gap"/>';
  }
  kc.style.setProperty('--fill', (state.periodo === 'hoje' && meta ? Math.min(100, s.concl / meta * 100) : 0).toFixed(1) + '%');

  const dg = $('dgrid'); dg.innerHTML = '';
  const itens = [
    ['Instalação', s.inst], ['Reab. Inst.', s.reabI], ['Prest. de contas', s.outros], ['Reab. prest. contas', s.reabO],
    ['Cancelados', s.canc], ['Em atraso (SLA)', s.atraso],
    ['Em play agora', lista.filter(t => t.play === 'play').length],
    ['Agendados sem play', lista.filter(t => t.play === 'parado').length],
    ['Agenda concluída', lista.filter(t => t.play === 'fim').length],
    ['Sem agenda e sem conclusão', lista.filter(t => t.play === 'vazio').length],
    ['Técnicos ativos / total', nAtivos + ' / ' + lista.length],
    ['Em atenção', s.atencao], ['Em observação', s.obs], ['Normal', s.normal], ['Acima', s.acima],
    ['Média por técnico ativo', nAtivos ? (s.concl / nAtivos).toFixed(1).replace('.', ',') : '0'],
    temMeta ? ['Meta do período (Meta ' + (ROMANOS[(d.metaGap || 1) - 1] || 'I') + ')', fmtN(meta)] : ['Meta Normal (período)', d.metas ? String(d.metas.normal).replace('.', ',') : '-'],
    temMeta ? ['Gap do período', (s.concl - meta > 0 ? '+' : '') + fmtN(s.concl - meta)] : ['Meta Observação (período)', d.metas ? String(d.metas.obs).replace('.', ',') : '-']
  ];
  const frT = fracExpediente();
  if (frT) itens.push(['Projeção do dia (estimativa linear)', fmtProj(s.concl / frT)]);
  itens.forEach(([k, v]) => { const x = el('div'); x.appendChild(el('span', '', k)); x.appendChild(el('b', '', String(v))); dg.appendChild(x); });

  $('filtroBtn').classList.toggle('on', state.periodo !== 'hoje' || !mesmoSet(state.sups, supsPadrao()) || state.ordem !== 'sup');
  pintarCabecalho();
  comparativoKpi(lista);
}

/* ----- comparativo no KPI Concluídos e projeção do dia (Etapa 13) ----- */
function comparativoKpi(lista) {
  const b = $('kCmp'), d = state.dados;
  const cmp = d && d.comparativo;
  if (!cmp || (state.periodo !== 'hoje' && state.periodo !== 'ontem')) { b.hidden = true; return; }
  // soma dos técnicos visíveis (respeita busca e equipes); sem os campos por técnico, usa o total do servidor
  const porTec = lista.length && lista.every(t => t.cmpOntem !== undefined);
  const refAnt = porTec ? lista.reduce((s, t) => s + t.cmpOntem, 0) : cmp.ontem;
  const refSem = porTec ? lista.reduce((s, t) => s + t.cmpSemana, 0) : cmp.mesmoDiaSemanaPassada;
  const sem = state.cmpModo === 'sem', ref = sem ? refSem : refAnt;
  const rot = sem ? 'vs sem. passada' : (cmp.base === 'ontem' ? 'vs dia anterior' : 'vs ontem');
  const atual = lista.reduce((s, t) => s + t.concl, 0);
  b.hidden = false;
  b.className = 'kcmp';
  if (!ref) { b.textContent = 'sem base ' + rot.replace('vs ', 'p/ '); b.classList.add('neutro'); }
  else {
    const p = Math.round((atual - ref) / ref * 100);
    b.textContent = (p > 0 ? '▲ +' : p < 0 ? '▼ ' : '= ') + p + '% ' + rot;
    b.classList.add(p > 0 ? 'up' : p < 0 ? 'down' : 'neutro');
  }
  b.title = 'Comparando ' + atual + ' concluídos com ' + ref + ' (' + rot.replace('vs ', '') + '). Toque para alternar.';
  b.setAttribute('aria-label', b.textContent + '. Toque para alternar a comparação.');
  b.onclick = () => { state.cmpModo = sem ? 'ontem' : 'sem'; comparativoKpi(lista); };
}
// projeção do dia por ritmo linear = concluídos / fração do expediente já passada. Só no filtro Hoje, depois de 1 hora de expediente e antes do fim.
function fracExpediente() {
  const d = state.dados;
  if (!d || state.periodo !== 'hoje' || !d.expediente) return null;
  const mm = s => { const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/); return m ? (+m[1]) * 60 + (+m[2]) : null; };
  const ini = mm(d.expediente.ini), fim = mm(d.expediente.fim);
  if (ini == null || fim == null || fim <= ini) return null;
  const p = {}; new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).forEach(x => p[x.type] = x.value);
  const agora = (+p.hour) * 60 + (+p.minute);
  if (agora - ini < 60 || agora >= fim) return null;
  return (agora - ini) / (fim - ini);
}
const fmtProj = v => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');

/* ----- gráfico de evolução por dia (Etapa 12) ----- */
const NIVEL_COR = { atencao: 'atencao', obs: 'obs', normal: 'normal', acima: 'acima' };
function graficoDias(t, largura) {
  const dias = (t.dias || []).slice();
  if (dias.length < 2) return null;
  const NS = 'http://www.w3.org/2000/svg', Wd = Math.max(240, Math.round(largura || 320)), H = 160, pl = 6, pr = 22, pt = 18, pb = 20;
  const metas = Array.isArray(t.metasTipo) ? t.metasTipo.map(Number) : [];
  const maxV = Math.max.apply(null, [1].concat(dias.map(x => x.concl), metas)) * 1.12;
  const bw = (Wd - pl - pr) / dias.length, gp = Math.min(8, bw * .25);
  const y = v => pt + (H - pt - pb) * (1 - v / maxV);
  const mk = (n, at, txt) => { const e = document.createElementNS(NS, n); Object.keys(at || {}).forEach(k => e.setAttribute(k, at[k])); if (txt != null) e.textContent = txt; return e; };
  const svg = mk('svg', { viewBox: '0 0 ' + Wd + ' ' + H, width: '100%', height: H, class: 'gr-svg', role: 'img' });
  const melhor = dias.reduce((m, x) => x.concl > m.concl ? x : m, dias[0]);
  const media = dias.reduce((s, x) => s + x.concl, 0) / dias.length;
  svg.setAttribute('aria-label', 'Gráfico de barras: concluídos por dia, ' + dias.length + ' dias, de ' + dias[0].d + ' a ' + dias[dias.length - 1].d + '. Melhor dia ' + melhor.d + ' com ' + melhor.concl + '. Média ' + fmtN2(media) + ' por dia.' + (metas.length ? ' Metas: ' + metas.map(fmtN2).join(', ') + '.' : ''));
  const wrap = el('div', 'gr'); wrap.appendChild(el('h3', '', 'Evolução por dia'));
  const cap = el('div', 'gr-cap', 'Toque numa barra para ver o dia e o valor.'); cap.setAttribute('aria-live', 'polite');
  // linhas de meta (Meta I a IV)
  metas.forEach((m, i) => {
    svg.appendChild(mk('line', { x1: pl, x2: Wd - pr, y1: y(m), y2: y(m), class: 'gr-meta', 'stroke-dasharray': '3 4' }));
    svg.appendChild(mk('text', { x: Wd - pr + 3, y: y(m) + 3, class: 'gr-mt' }, ROMANOS[i] || ''));
  });
  const passo = Math.max(1, Math.ceil(30 / bw));
  dias.forEach((x, i) => {
    const bx = pl + i * bw + gp / 2, w = Math.max(2, bw - gp), top = y(x.concl);
    const g = mk('g', { class: 'gr-g', tabindex: '0', role: 'img', 'aria-label': x.d + ': ' + x.concl + (x.concl === 1 ? ' concluída' : ' concluídas') });
    g.appendChild(mk('title', {}, x.d + ': ' + x.concl + (x.concl === 1 ? ' concluída' : ' concluídas')));
    g.appendChild(mk('rect', { x: pl + i * bw, y: pt - 10, width: bw, height: H - pt - pb + 10, class: 'gr-hit' }));
    g.appendChild(mk('rect', { x: bx, y: top, width: w, height: Math.max(1, H - pb - top), rx: Math.min(4, w / 3), class: 'gr-b ' + (NIVEL_COR[x.nivel] || 'neutro') }));
    if (bw >= 18) g.appendChild(mk('text', { x: bx + w / 2, y: top - 4, class: 'gr-v', 'text-anchor': 'middle' }, String(x.concl)));
    if (i % passo === 0) g.appendChild(mk('text', { x: bx + w / 2, y: H - 5, class: 'gr-x', 'text-anchor': 'middle' }, String(x.d).slice(0, 5)));
    const mostrar = () => { cap.textContent = x.d + ' · ' + x.concl + (x.concl === 1 ? ' concluída' : ' concluídas') + (x.faixa > 0 ? ' (Meta ' + ROMANOS[x.faixa - 1] + ')' : ''); };
    g.addEventListener('click', mostrar); g.addEventListener('focus', mostrar);
    svg.appendChild(g);
  });
  wrap.appendChild(svg); wrap.appendChild(cap);
  return wrap;
}

/* ----- detalhe do técnico ----- */
const ROMANOS = ['I', 'II', 'III', 'IV'];
function abrirTecnico(t, opener) {
  $('tNome').textContent = tc(t.nome);
  $('tSup').textContent = t.supervisor ? 'Supervisor: ' + tc(t.supervisor) : '';
  const ch = $('tChip');
  ch.className = 'chip ' + t.nivel;
  ch.textContent = t.nivel === 'acima' ? 'Acima' : t.nivel === 'normal' ? 'Normal' : t.nivel === 'obs' ? 'Observação' : 'Atenção';
  const dl = $('tDet'); dl.innerHTML = '';
  [['Concluídos', t.concl], ['Instalação', t.inst], ['Pendência', t.pend], ['Prest. de contas', t.outros],
   ['Reab. Instalação', t.reabInst], ['Reab. Pendência', t.reabPend], ['Reab. prest. contas', t.reabOutros],
   ['Cancelados', t.cancel], ['Concluídos em atraso', t.atraso],
   ['Na agenda (abertos)', t.play === 'na' ? '-' : (t.agenda || 0)]]
    .forEach(([k, v]) => { dl.appendChild(el('dt', '', k)); dl.appendChild(el('dd', '', String(v))); });
  const fr = fracExpediente();
  if (fr) { dl.appendChild(el('dt', '', 'Projeção')); dl.appendChild(el('dd', '', fmtProj((Number(t.concl) || 0) / fr) + ' (estimativa linear)')); }
  const fN = n => (Math.round(n * 100) / 100).toString().replace('.', ',');
  const bx = $('tDias'); bx.innerHTML = '';
  if (t.metasTipo) {
    [['Tipo', t.tipo || '-'],
     ['Metas I / II / III / IV', t.metasTipo.map(fN).join(' / ')],
     ['Dias produzidos', t.diasProd],
     ['Média por dia', fN(t.media || 0)],
     ['Meta do período (Meta ' + ROMANOS[((state.dados && state.dados.metaGap) || 1) - 1] + ')', fN(t.metaPer || 0)],
     ['Gap', (t.gap > 0 ? '+' : '') + fN(t.gap || 0)]]
      .forEach(([k, v]) => { dl.appendChild(el('dt', '', k)); dl.appendChild(el('dd', '', String(v))); });
    // produção dia a dia: cada dia produzido com a meta que alcançou
    if ((t.dias || []).length) {
      bx.appendChild(el('h3', '', 'Dias produzidos'));
      const ls = el('div', 'tdlist');
      t.dias.slice().reverse().forEach(x => {
        const r = el('div', 'tdia');
        r.appendChild(el('span', '', x.d));
        r.appendChild(el('b', '', x.concl + (x.concl === 1 ? ' concluída' : ' concluídas')));
        const c = el('span', 'chip ' + x.nivel, x.faixa > 0 ? 'Meta ' + ROMANOS[x.faixa - 1] : 'Abaixo da meta');
        r.appendChild(c); ls.appendChild(r);
      });
      bx.appendChild(ls);
    }
  } else {
    dl.appendChild(el('dt', '', 'Tipo / meta'));
    dl.appendChild(el('dd', '', t.tipo ? t.tipo + ' (não está na aba Metas)' : 'Sem Tipo na aba Técnicos'));
    if (t.metaPer !== undefined) { dl.appendChild(el('dt', '', 'Meta do período (padrão)')); dl.appendChild(el('dd', '', fN(t.metaPer))); dl.appendChild(el('dt', '', 'Gap')); dl.appendChild(el('dd', '', (t.gap > 0 ? '+' : '') + fN(t.gap || 0))); }
  }
  abrirDlg($('dlgTec'), opener);
  const gr = graficoDias(t, bx.clientWidth);        // depois de abrir, para medir a largura real do diálogo
  if (gr) bx.insertBefore(gr, bx.firstChild);
}
$('tFechar').onclick = () => $('dlgTec').close();

/* ----- exportar (Etapa 14): CSV para Excel em português (; + UTF-8 com BOM + vírgula decimal) e impressão ----- */
function csvCel(v) {
  if (typeof v === 'number') return String(Math.round(v * 100) / 100).replace('.', ',');
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;                      // evita que o Excel trate texto como fórmula
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvTexto(cab, linhas) { return [cab].concat(linhas).map(l => l.map(csvCel).join(';')).join('\r\n') + '\r\n'; }
function dataHoje() { const p = {}; new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).forEach(x => p[x.type] = x.value); return p.year + '-' + p.month + '-' + p.day; }
function baixarCSV(nome, texto) {
  const blob = new Blob(['\ufeff' + texto], { type: 'text/csv;charset=utf-8' });
  const u = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = u; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}
const PLAY_CSV = { play: 'Em execução', parado: 'Agendado, ainda não iniciou', fim: 'Agenda concluída', vazio: 'Nada agendado', na: 'Base de abertos indisponível' };
// linhas da tabela como estão na tela (busca, filtros e ordem)
function csvProducao() {
  const cab = ['Técnico', 'Supervisor', 'Reab. Inst.', 'Reab. Pend.', 'Instalação', 'Pendência', 'Concluídos', 'Play', 'Meta do período', 'Gap'];
  const l = listaVisivel().map(t => [tc(t.nome), t.supervisor ? tc(t.supervisor) : '', t.reabInst, t.reabPend, t.inst, t.pend, t.concl, PLAY_CSV[t.play] || '',
    t.metaPer !== undefined ? Number(t.metaPer) || 0 : '', t.metaPer !== undefined ? Number(t.gap) || 0 : '']);
  return csvTexto(cab, l);
}
$('fCsv').onclick = () => { baixarCSV('producao-' + dataHoje() + '.csv', csvProducao()); };
$('fPrint').onclick = () => { $('dlgFiltro').close(); setTimeout(() => window.print(), 200); };

/* ----- limpar busca e filtros (estado vazio) ----- */
function limparBuscaFiltros() {
  state.busca = ''; $('busca').value = '';
  state.sups = []; if (!ehTec()) store.set(supKey(), []);     // vazio = todas as equipes
  render();
}

/* ----- busca ----- */
$('busca').addEventListener('input', e => { state.busca = e.target.value; render(); });

/* ----- Produção mensal (calendário: dias, meses ou ano inteiro) ----- */
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const pad2 = n => String(n).padStart(2, '0');
const isoD = (y, m, d) => y + '-' + pad2(m + 1) + '-' + pad2(d);      // m = 0..11
const mesKey = (y, m) => y + '-' + pad2(m + 1);
const _hj = new Date(), HY = _hj.getFullYear(), HM = _hj.getMonth(), HD = _hj.getDate();
const diasNoMes = (y, m) => new Date(y, m + 1, 0).getDate();
const futuroMes = (y, m) => y * 12 + m > HY * 12 + HM;
const cal = { aberto: false, tab: 'dias', y: HY, m: HM, dias: new Set(), meses: new Set() };

function diasDoMes(y, m) {                       // dias do mês até hoje (não existe produção no futuro)
  const n = (y === HY && m === HM) ? HD : diasNoMes(y, m), r = [];
  for (let d = 1; d <= n; d++) r.push(isoD(y, m, d));
  return r;
}
const mesesDoAno = y => { const r = []; for (let m = 0; m < 12; m++) if (!futuroMes(y, m)) r.push(m); return r; };
const diaSel = (y, m, d) => cal.dias.has(isoD(y, m, d)) || cal.meses.has(mesKey(y, m));

function toggleDia(y, m, d) {
  const k = mesKey(y, m);
  if (cal.meses.has(k)) { cal.meses.delete(k); diasDoMes(y, m).forEach(i => cal.dias.add(i)); }   // abre o mês em dias para tirar só um
  const i = isoD(y, m, d);
  if (cal.dias.has(i)) cal.dias.delete(i); else cal.dias.add(i);
}
function setMes(y, m, on) {
  const k = mesKey(y, m);
  if (on) { cal.meses.add(k); diasDoMes(y, m).forEach(i => cal.dias.delete(i)); } else cal.meses.delete(k);
}
function toggleMes(y, m) { setMes(y, m, !cal.meses.has(mesKey(y, m))); }
function toggleAno(y) {
  const ms = mesesDoAno(y), todos = ms.every(m => cal.meses.has(mesKey(y, m)));
  ms.forEach(m => setMes(y, m, !todos));
}
const calVazio = () => !cal.dias.size && !cal.meses.size;
function calSerial() { return { dias: Array.from(cal.dias).sort(), meses: Array.from(cal.meses).sort() }; }

function calResumo() {
  const c = calSerial();
  const avulsos = c.dias.filter(i => !c.meses.includes(i.slice(0, 7))).length;
  const nm = c.meses.length, partes = [];
  if (nm === 1) { const [y, m] = c.meses[0].split('-'); partes.push(MESES[+m - 1] + ' de ' + y); }
  else if (nm > 1) {
    const anos = Array.from(new Set(c.meses.map(k => k.slice(0, 4))));
    partes.push(anos.length === 1 && nm === mesesDoAno(+anos[0]).length ? 'Ano ' + anos[0] : nm + ' meses');
  }
  if (avulsos) partes.push(avulsos + (avulsos === 1 ? ' dia' : ' dias'));
  return partes.length ? partes.join(' + ') : 'Nenhuma seleção';
}

function calAtualiza() {
  $('fPeriodo').value = 'cal';
  calDesenhar();
}
function calDesenhar() {
  $('calRes').textContent = calResumo();
  $('calToggle').textContent = cal.aberto ? 'Fechar' : 'Abrir calendário';
  const box = $('calBody'); box.hidden = !cal.aberto; box.innerHTML = '';
  if (!cal.aberto) return;
  const btn = (cls, txt, fn) => { const b = el('button', cls, txt); b.type = 'button'; b.onclick = fn; return b; };

  const tabs = el('div', 'cal-tabs');
  [['dias', 'Dias'], ['meses', 'Meses / Ano']].forEach(([k, t]) => tabs.appendChild(btn('cal-tab' + (cal.tab === k ? ' on' : ''), t, () => { cal.tab = k; calDesenhar(); })));
  box.appendChild(tabs);

  const dias = cal.tab === 'dias';
  const nav = el('div', 'cal-nav');
  const prev = btn('cal-n', '‹', () => { if (dias) { cal.m--; if (cal.m < 0) { cal.m = 11; cal.y--; } } else cal.y--; calDesenhar(); });
  const next = btn('cal-n', '›', () => { if (dias) { cal.m++; if (cal.m > 11) { cal.m = 0; cal.y++; } } else cal.y++; calDesenhar(); });
  prev.setAttribute('aria-label', 'Anterior'); next.setAttribute('aria-label', 'Próximo');
  next.disabled = dias ? cal.y * 12 + cal.m >= HY * 12 + HM : cal.y >= HY;
  nav.appendChild(prev); nav.appendChild(el('b', '', dias ? MESES[cal.m] + ' ' + cal.y : String(cal.y))); nav.appendChild(next);
  box.appendChild(nav);

  if (dias) {
    const g = el('div', 'cal-grid');
    ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].forEach(s => g.appendChild(el('span', 'cal-w', s)));
    const ini = new Date(cal.y, cal.m, 1).getDay();
    for (let i = 0; i < ini; i++) g.appendChild(el('span', 'cal-v'));
    for (let d = 1; d <= diasNoMes(cal.y, cal.m); d++) {
      const fut = futuroMes(cal.y, cal.m) || (cal.y === HY && cal.m === HM && d > HD);
      const b = btn('cal-d' + (diaSel(cal.y, cal.m, d) ? ' on' : '') + (cal.y === HY && cal.m === HM && d === HD ? ' hj' : ''), String(d), () => { toggleDia(cal.y, cal.m, d); calAtualiza(); });
      b.disabled = fut; g.appendChild(b);
    }
    box.appendChild(g);
  } else {
    const g = el('div', 'cal-meses');
    for (let m = 0; m < 12; m++) {
      const b = btn('cal-m' + (cal.meses.has(mesKey(cal.y, m)) ? ' on' : ''), MESES[m].slice(0, 3), () => { toggleMes(cal.y, m); calAtualiza(); });
      b.title = MESES[m]; b.disabled = futuroMes(cal.y, m); g.appendChild(b);
    }
    box.appendChild(g);
  }

  const ac = el('div', 'cal-ac');
  ac.appendChild(btn('cal-q', dias ? 'Mês inteiro' : 'Ano inteiro', () => { if (dias) toggleMes(cal.y, cal.m); else toggleAno(cal.y); calAtualiza(); }));
  ac.appendChild(btn('cal-q', 'Limpar seleção', () => { cal.dias.clear(); cal.meses.clear(); calDesenhar(); }));
  box.appendChild(ac);
  box.appendChild(el('p', 'cal-dica', dias ? 'Toque nos dias para marcar vários. Navegue pelos meses para juntar dias de meses diferentes.' : 'Toque nos meses para marcar vários. Use as setas para trocar de ano.'));
}
$('calToggle').onclick = () => { cal.aberto = !cal.aberto; calDesenhar(); };

/* ----- seleção múltipla de equipes (vazio = todas) ----- */
function mselDesenhar(box, lista, sel) {
  box.innerHTML = '';
  const opt = (txt, on, fn, cls) => {
    const b = el('button', 'mopt' + (on ? ' on' : '') + (cls ? ' ' + cls : '')); b.type = 'button';
    b.setAttribute('role', 'checkbox'); b.setAttribute('aria-checked', String(on));
    const bx = el('span', 'mbox'); bx.innerHTML = ic('tick'); b.appendChild(bx);
    b.appendChild(el('span', '', txt));
    b.onclick = () => { fn(); mselDesenhar(box, lista, sel); };
    return b;
  };
  box.appendChild(opt('Todos', !sel.size, () => sel.clear(), 'todos'));
  lista.forEach(n => {
    const k = nk(n);
    box.appendChild(opt(tc(n), sel.has(k), () => {
      if (sel.has(k)) sel.delete(k); else sel.add(k);
      if (sel.size >= lista.length) sel.clear();
    }));
  });
}
let fSupSel = new Set(), bfSel = new Set();
const listaSups = () => ((state.dados && state.dados.supervisores) || []).slice().sort((a, b) => a.localeCompare(b, 'pt-BR'));

/* ----- filtros ----- */
function abrirFiltro() {
  $('fPeriodo').value = state.periodo;
  $('fIni').value = state.ini; $('fFim').value = state.fim;
  $('fCustom').hidden = state.periodo !== 'custom';
  cal.dias = new Set((state.cal && state.cal.dias) || []); cal.meses = new Set((state.cal && state.cal.meses) || []);
  cal.y = HY; cal.m = HM; cal.aberto = state.periodo === 'cal'; calDesenhar();
  $('fSupWrap').hidden = ehTec();
  fSupSel = new Set(state.sups); mselDesenhar($('fSupBox'), listaSups(), fSupSel);
  $('fOrd').value = state.ordem;
  abrirDlg($('dlgFiltro'));
}
$('filtroBtn').onclick = abrirFiltro;
$('fFechar').onclick = () => $('dlgFiltro').close();
$('fPeriodo').onchange = () => { $('fCustom').hidden = $('fPeriodo').value !== 'custom'; if ($('fPeriodo').value === 'cal' && !cal.aberto) { cal.aberto = true; calDesenhar(); } };
$('fLimpar').onclick = () => {
  $('fPeriodo').value = 'hoje'; $('fOrd').value = 'sup';
  fSupSel = new Set(supsPadrao()); mselDesenhar($('fSupBox'), listaSups(), fSupSel);
  $('fCustom').hidden = true; $('fIni').value = ''; $('fFim').value = '';
  cal.dias.clear(); cal.meses.clear(); cal.aberto = false; calDesenhar();
};
$('fForm').addEventListener('submit', () => {
  const sig = () => state.periodo + state.ini + state.fim + (state.periodo === 'cal' ? JSON.stringify(state.cal) : '');
  const antes = sig();
  state.periodo = $('fPeriodo').value;
  state.ini = $('fIni').value; state.fim = $('fFim').value;
  if (state.periodo === 'custom' && (!state.ini || !state.fim)) state.periodo = 'hoje';
  state.cal = calSerial();
  if (state.periodo === 'cal' && calVazio()) state.periodo = 'hoje';
  if (!ehTec()) { state.sups = Array.from(fSupSel); store.set(supKey(), state.sups); }
  if (state.ordem !== $('fOrd').value) state.dir = '';
  state.ordem = $('fOrd').value;
  salvarFiltros();
  if (antes !== sig()) setTimeout(carregar, 0); else render();
});

/* ----- mais detalhes e atualizar ----- */
$('maisBtn').onclick = () => {
  const d = $('detalhes'); d.hidden = !d.hidden;
  $('maisBtn').setAttribute('aria-expanded', String(!d.hidden));
  if (!d.hidden) d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};
$('refBtn').onclick = () => carregar();

/* ----- login (usuário + senha) ----- */
let lembrar = false;   // botão "Salvar credenciais"
function loginMsg(msg, tipo) { const m = $('lgMsg'); m.className = 'lg-msg' + (tipo ? ' ' + tipo : ''); m.textContent = msg || ''; }
function loginAtualizar() {
  const b = $('lgSave');
  b.classList.toggle('on', lembrar); b.setAttribute('aria-pressed', String(lembrar));
  b.querySelector('use').setAttribute('href', lembrar ? '#i-check' : '#i-save');
  $('lgBtn').disabled = !($('lgUser').value.trim() && $('lgPass').value);
}
function loginPreencher() {
  const c = store.get(K.cred, null);
  $('lgUser').value = c ? c.login : ''; $('lgPass').value = c ? c.senha : '';
  lembrar = !!(c && c.login && c.senha);
  loginAtualizar();
}
['lgUser', 'lgPass'].forEach(id => $(id).addEventListener('input', loginAtualizar));
$('lgEye').onclick = () => {
  const p = $('lgPass'), ver = p.type === 'password';
  p.type = ver ? 'text' : 'password';
  $('lgEye').classList.toggle('on', ver);
  $('lgEye').querySelector('use').setAttribute('href', ver ? '#i-eyeoff' : '#i-eye');
  $('lgEye').setAttribute('aria-label', ver ? 'Ocultar senha' : 'Mostrar senha');
};
$('lgSave').onclick = () => {
  if (lembrar) {
    lembrar = false; store.del(K.cred); loginAtualizar();
    loginMsg('Credenciais removidas deste aparelho.');
    return;
  }
  const login = $('lgUser').value.trim(), senha = $('lgPass').value;
  if (!login || !senha) { loginMsg('Preencha login e senha para salvar.', 'erro'); return; }
  lembrar = true; store.set(K.cred, { login, senha }); store.set(K.auto, true); loginAtualizar();
  loginMsg('Credenciais salvas neste aparelho.', 'ok');
};
function entrar(cred, usuario) {
  state.cred = cred;
  try { sessionStorage.setItem(K.sess, JSON.stringify(cred)); } catch (_) {}
  if (lembrar) { store.set(K.cred, cred); store.set(K.auto, true); }
  definirUsuario(usuario);
  loginMsg('');
  document.body.classList.remove('sem-login');
  window.scrollTo(0, 0);
  carregar();
}
$('lgForm').addEventListener('submit', async e => {
  e.preventDefault();
  const login = $('lgUser').value.trim(), senha = $('lgPass').value;
  if (!login || !senha) return;
  $('lgBtn').disabled = true; loginMsg('Verificando…');
  try {
    await resolverUrl();
    if (!urlValida(SCRIPT_URL)) throw new Error('Falta configurar a URL do Apps Script no arquivo index.html.');
    const j = await pedir(SCRIPT_URL + '?' + new URLSearchParams({ acao: 'login', login: login, senha: senha }).toString(), 30000);
    if (!j || !j.ok) {
      if (lembrar) { lembrar = false; store.del(K.cred); }   // não deixa guardada uma credencial recusada
      loginMsg((j && j.error) || 'Login ou senha inválidos.', 'erro'); return;
    }
    if (!j.usuario) throw new Error('O Apps Script ainda está na versão antiga. Cole o novo Code.gs e publique uma nova versão da implantação.');
    entrar({ login: login, senha: senha }, j.usuario);
  } catch (err) {
    const abortou = err && err.name === 'AbortError';
    loginMsg(abortou ? 'A conexão demorou demais. Tente de novo.' : (err && err.message && err.message !== 'Failed to fetch' ? err.message : 'Não foi possível conectar. Tente de novo.'), 'erro');
  } finally { loginAtualizar(); }
});
function sair(msg) {
  if (state.cred) lcLimpa(state.cred.login);          // apaga os dados guardados deste usuário neste aparelho
  state.dadosEm = 0; state.doCache = false; state.dadosSig = ''; bl.dadosEm = 0; bl.doCache = false; mostrarFrescor(); blFrescor();
  try { sessionStorage.removeItem(K.sess); } catch (_) {}
  store.set(K.auto, false);            // não entra sozinho de novo; se houver credenciais salvas, elas voltam preenchidas
  state.cred = null; state.user = null; state.dados = null; state.sups = [];
  state.busca = ''; $('busca').value = ''; $('rows').innerHTML = ''; aviso('');
  bl.dados = null; bl.itens = []; bl.f = {}; bl.busca = '';
  ['v-blk', 'p-tec', 'p-sup', 'p-coord'].forEach(c => document.body.classList.remove(c));
  store.set(K.view, '');
  document.body.classList.add('sem-login');
  loginPreencher();
  if (msg) loginMsg(msg, 'erro');
  window.scrollTo(0, 0);
}
$('sairBtn').onclick = () => sair();

/* ============ BACKLOG (aba Base_Abertos) ============ */
const BL_K = 'dp_blk_v1';
const EMP_H = { GERAL: 265, INFOLINK: 215, DNET: 28, GIGANET: 160, JEBNET: 330, EMX: 190 };
const EMP_BASE = ['GERAL', 'INFOLINK', 'DNET', 'GIGANET', 'JEBNET'];
const CATS = [
  { k: 'pend',   n: 'Pendências',        s: 'Pend.',   i: 'clock',  h: 35 },
  { k: 'inst',   n: 'Instalações',       s: 'Inst.',   i: 'bars',   h: 215 },
  { k: 'transf', n: 'Transferências',    s: 'Transf.', i: 'swap',   h: 280 },
  { k: 'retrab', n: 'Retrabalhos',       s: 'Retrab.', i: 'redo',   h: 350 },
  { k: 'serv',   n: 'Serviço',           s: 'Serviço', i: 'wrench', h: 170 },
  { k: 'reativ', n: 'Reativação',        s: 'Reativ.', i: 'power',  h: 130 },
  { k: 'troca',  n: 'Troca de roteador', s: 'Troca',   i: 'wifi',   h: 195 },
  { k: 'repet',  n: 'Repetidor',         s: 'Repet.',  i: 'signal', h: 50 },
  { k: 'outros', n: 'Outros',            s: 'Outros',  i: 'dots',   h: 225 }
];
const catDe = k => CATS.find(c => c.k === k) || CATS[CATS.length - 1];
const AGB = [{ n: 'Até 1 dia', h: 48 }, { n: '1 a 3 dias', h: 30 }, { n: '3 a 6 dias', h: 12 }, { n: 'Mais de 6 dias', h: 350 }];
const SIT_N = { atraso: 'Em atraso', play: 'Em play', fila: 'Sem técnico', venc4: 'Vencem em 4h' };
const ST_H = { 'abertura': 215, 'andamento': 160, 'agendado': 190, 'reagendado': 38, 'remarcacao': 18, 'tratamento infra': 280, 'inviabilidade tecnica': 350 };

const bl = Object.assign({ emp: 'GERAL', ordem: 'atraso' }, store.get(BL_K, {}));
Object.assign(bl, { f: {}, busca: '', limite: 30, verCid: false, verTec: false, dados: null, itens: [], cidN: {}, ultima: 0, carregando: false, now: Date.now() });
const blSalvar = () => store.set(BL_K, { emp: bl.emp, ordem: bl.ordem, sup: bl.f.sup || '' });
{ const sv = store.get(BL_K, {}).sup; if (Array.isArray(sv) && sv.length) bl.f.sup = sv; }
const emBacklog = () => document.body.classList.contains('v-blk');
const pct1 = n => n.toFixed(1).replace('.', ',') + '%';
const hueDe = (s, mapa) => { const k = semAcento(s); if (mapa && mapa[k] != null) return mapa[k]; let h = 0; for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return (h * 47) % 360; };
const empH = e => EMP_H[e] != null ? EMP_H[e] : hueDe(e);
const empNome = e => e === 'GERAL' ? 'Geral' : e;

function dur(ms) {
  const m = Math.max(1, Math.floor(Math.abs(ms) / 60000));
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h' + (m % 60 ? String(m % 60).padStart(2, '0') : '');
  const d = Math.floor(h / 24);
  return d + 'd' + (h % 24 ? ' ' + (h % 24) + 'h' : '');
}
function fmtFull(ms) {
  if (!ms) return '—';
  const p = {};
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).forEach(x => p[x.type] = x.value);
  return p.day + '/' + p.month + '/' + p.year + ' ' + p.hour + ':' + p.minute;
}

// OS com prazo nas próximas 4 horas e ainda não atrasada
const vence4 = x => !x.atr && !!x.pz && x.pz > bl.now && x.pz - bl.now <= 4 * 3600e3;
function blPrep(x) {
  x.cidK = semAcento(x.cid).trim() || '_sem';
  x.cidN = x.cid ? tc(x.cid) : 'Sem cidade';
  x.stN = x.st || 'Sem status';
  x.tecK = x.fila ? '_fila' : (nk(x.resp) || '_fila');                  // chave do bloco Por técnico (fila = sem técnico)
  x.tecNome = x.fila ? 'Sem técnico' : (x.resp ? tc(x.resp) : 'Sem técnico');
  x.resp = x.resp || '';
  x._s = semAcento([x.id, x.cli, x.tipo, x.cid, x.bai, x.end, x.resp, x.emp, x.st, x.at, x.orig].join(' ')) + ' ' + (String(x.t1 || '') + String(x.t2 || '')).replace(/\D/g, '');
  return x;
}

/* ----- filtros cruzados: cada bloco ignora o próprio filtro, para mostrar as alternativas ----- */
function agBucket(x) {
  if (!x.atr) return null;
  const d = x.pz ? Math.max(0, bl.now - x.pz) / 864e5 : 0;
  return d < 1 ? '0' : d < 3 ? '1' : d < 6 ? '2' : '3';
}
const BLP = {
  cat: (x, v) => x.cat === v,
  st: (x, v) => x.stN === v,
  cid: (x, v) => x.cidK === v,
  tec: (x, v) => x.tecK === v,
  ag: (x, v) => agBucket(x) === v,
  sup: (x, v) => Array.isArray(v) ? v.includes(nk(x.sup)) : nk(x.sup) === nk(v),
  sit: (x, v) => v === 'atraso' ? !!x.atr : v === 'play' ? !!x.play : v === 'fila' ? !!x.fila : v === 'venc4' ? vence4(x) : true
};
function blFiltrar(skip, semEmp) {
  const q = semAcento(bl.busca).trim();
  const ks = Object.keys(bl.f).filter(k => bl.f[k] && k !== skip);
  return bl.itens.filter(x =>
    (semEmp || bl.emp === 'GERAL' || x.emp === bl.emp) &&
    ks.every(k => BLP[k](x, bl.f[k])) &&
    (!q || x._s.indexOf(q) >= 0));
}
function agrupa(arr, key) {
  const m = new Map();
  arr.forEach(x => {
    const k = key(x); if (k == null) return;
    let g = m.get(k); if (!g) { g = { n: 0, a: 0 }; m.set(k, g); }
    g.n++; if (x.atr) g.a++;
  });
  return m;
}
function blEmpresas() {
  const ext = Array.from(new Set(bl.itens.map(x => x.emp))).filter(e => EMP_BASE.indexOf(e) < 0).sort();
  return EMP_BASE.concat(ext);
}
function blToggle(dim, v) {
  bl.f[dim] = bl.f[dim] === v ? '' : v;
  bl.limite = 30;
  blRender();
}

/* ----- carregamento ----- */
function blAviso(msg, retry) {
  const box = $('bAviso'); box.innerHTML = '';
  if (!msg) return;
  const b = el('div', 'banner', msg); b.setAttribute('role', 'alert');
  if (retry) { const bt = el('button', '', 'Tentar de novo'); bt.type = 'button'; bt.onclick = () => carregarBacklog(); b.appendChild(bt); }
  box.appendChild(b);
}
function blEsqueleto() {
  $('bEmps').innerHTML = ''; $('bKpis').innerHTML = '';
  for (let i = 0; i < 5; i++) { const s = el('div', 'skelb'); if (i === 0) s.style.gridColumn = '1/-1'; $('bEmps').appendChild(s); }
}
// coloca uma resposta do backlog (nova ou guardada) em uso
function blAplicar(j) {
  bl.dados = j;
  bl.itens = j.itens.map(blPrep);
  bl.cidN = {}; bl.tecN = {}; bl.itens.forEach(x => { bl.cidN[x.cidK] = x.cidN; bl.tecN[x.tecK] = x.tecNome; });
}
async function carregarBacklog() {
  if (bl.carregando || !state.cred) return;
  bl.carregando = true;
  document.body.classList.add('loading');
  if (!bl.dados) {
    const g = lcLer(lcKeyBlk(), false);
    if (g) { definirUsuario(g.d.usuario); blAplicar(g.d); bl.dadosEm = g.t; bl.doCache = true; blRender(); }
    else blEsqueleto();
  }
  blAviso('');
  blFrescor();
  await resolverUrl();
  if (!urlValida(SCRIPT_URL)) {
    bl.carregando = false; document.body.classList.remove('loading');
    $('bEmps').innerHTML = '';
    blAviso('Falta configurar a URL do Apps Script no arquivo index.html.');
    return;
  }
  const q = qAuth(new URLSearchParams({ pagina: 'backlog' }));
  q.set('leve', '1');     // OS sem a descrição (vem ao abrir a OS) e sem a lista de concluídos (vem ao clicar no KPI)
  try {
    const j = await pedir(SCRIPT_URL + '?' + q.toString(), 60000);
    if (j && j.login) { bl.carregando = false; document.body.classList.remove('loading'); sair('Sessão inválida. Entre novamente.'); return; }
    if (j && j.auth) { bl.carregando = false; document.body.classList.remove('loading'); pedirCodigo(j.error); return; }
    if (!j || !j.ok) throw new Error((j && j.error) || 'Resposta inválida.');
    if (!Array.isArray(j.itens)) throw new Error('O Apps Script ainda está na versão antiga. Cole o novo Code.gs e publique uma nova versão da implantação.');
    if (j.usuario) definirUsuario(j.usuario);
    lcGravar(lcKeyBlk(), j);                 // guarda a resposta crua (antes de blPrep acrescentar campos de busca)
    blAplicar(j);
    bl.ultima = Date.now(); bl.offline = false; bl.dadosEm = bl.ultima; bl.doCache = false;
    blRender();
  } catch (e) {
    if (!bl.dados) { $('bEmps').innerHTML = ''; }
    const abortou = e && e.name === 'AbortError';
    const rede = abortou || !e || !e.message || e.message === 'Failed to fetch';
    bl.offline = !!(bl.dados && rede);
    if (bl.dados && rede) blAviso('Sem conexão, mostrando dados de ' + hhmm(bl.dadosEm) + '.', true);
    else blAviso(abortou ? 'A conexão demorou demais.' : (e && e.message && e.message !== 'Failed to fetch' ? e.message : 'Não foi possível carregar o backlog.'), true);
  } finally {
    bl.carregando = false;
    document.body.classList.remove('loading');
    blFrescor();
  }
}

/* ----- banner de atualização ----- */
function blModo() {
  const m = $('bModo'), d = bl.dados; if (!d) return;
  // mesma régua da produção: até 30 min verde, 31 a 60 laranja, acima de 60 vermelho (se Sincronismo!B1 existir)
  const ms = d.abertosAtualizadoMs, idade = ms ? (Date.now() - Number(ms)) / 60000 : null;
  const nivel = idade == null || isNaN(idade) ? '' : idade <= 30 ? '' : idade <= 60 ? ' sync-warn' : ' sync-bad';
  m.innerHTML = ''; m.className = 'modo hoje' + nivel;
  m.appendChild(el('span', 'dot'));
  const mi = el('span', 'mi'); mi.innerHTML = ic('stack'); m.appendChild(mi);
  const t = el('div', 'mt');
  t.appendChild(el('b', '', 'OS em aberto'));
  const up = el('span', 'up');
  up.appendChild(document.createTextNode('Atualizado em '));
  up.appendChild(el('em', '', fmtStamp(ms) || d.atualizado || '--'));
  t.appendChild(up); m.appendChild(t);
  const v = el('span', 'live');
  v.innerHTML = ic('refresh') + (idade != null && !isNaN(idade) ? 'há ' + (idade < 1 ? '<1' : idade < 60 ? Math.floor(idade) : Math.floor(idade / 60) + 'h' + String(Math.floor(idade % 60)).padStart(2, '0')) + (idade < 60 ? ' min' : '') : 'Ao vivo');
  m.appendChild(v);
}

/* ----- desenho ----- */
function blRender() {
  const d = bl.dados; if (!d) return;
  bl.now = Date.now();
  blFrescor();
  if (blEmpresas().indexOf(bl.emp) < 0) bl.emp = 'GERAL';
  // supervisor salvo que não existe mais: remove o filtro
  if (bl.f.sup) { const ok = blSupervisores().map(nk), f = (Array.isArray(bl.f.sup) ? bl.f.sup : [nk(bl.f.sup)]).filter(k => ok.includes(k)); bl.f.sup = f.length ? f : ''; }
  const totEmp = bl.itens.filter(x => (bl.emp === 'GERAL' || x.emp === bl.emp) && (!bl.f.sup || BLP.sup(x, bl.f.sup))).length;
  $('bTitulo').textContent = ehTec() ? 'Minhas OS' : 'Backlog';
  $('bSub').textContent = ehTec()
    ? 'Agendadas para você' + (bl.emp === 'GERAL' ? '' : ' · ' + empNome(bl.emp)) + ' · ' + totEmp + ' OS'
    : (bl.emp === 'GERAL' ? 'Todas as empresas' : empNome(bl.emp)) + (bl.f.sup ? ' · ' + supResumo(bl.f.sup, blSupervisores()) : '') + ' · ' + totEmp + ' OS abertas';
  $('bFiltBtn').classList.toggle('on', !!bl.f.sup);
  blSalvar();
  blEmps(); blKpis(); blChips(); blStrip();
  blTipo(); blStatus(); blAging(); blCidades(); blTecnicos(); blMatriz(); blLista(); blModo();
  alertaSync(); tituloAba(); botaoNotif(); notificarVencimentos();
  $('bOrdem').value = bl.ordem;
}

/* ----- filtro de supervisor do Backlog ----- */
function blSupervisores() {
  const d = bl.dados && bl.dados.supervisores;
  const l = Array.isArray(d) && d.length ? d : Array.from(new Set(bl.itens.map(x => x.sup).filter(Boolean)));
  return l.slice().sort((a, b) => a.localeCompare(b, 'pt-BR'));
}
$('bFiltBtn').onclick = () => {
  bfSel = new Set(Array.isArray(bl.f.sup) ? bl.f.sup : []);
  mselDesenhar($('bfBox'), blSupervisores(), bfSel);
  abrirDlg($('dlgBFiltro'));
};
$('bfFechar').onclick = () => $('dlgBFiltro').close();
$('bfLimpar').onclick = () => { bfSel.clear(); mselDesenhar($('bfBox'), blSupervisores(), bfSel); };
$('bfForm').addEventListener('submit', () => {
  bl.f.sup = bfSel.size ? Array.from(bfSel) : ''; bl.limite = 30;
  setTimeout(blRender, 0);
});

function blEmps() {
  const base = blFiltrar(null, true), box = $('bEmps'); box.innerHTML = '';
  blEmpresas().forEach(e => {
    const l = e === 'GERAL' ? base : base.filter(x => x.emp === e);
    const tot = l.length, at = l.filter(x => x.atr).length, pc = tot ? at / tot * 100 : 0;
    const b = el('button', 'ecard' + (e === 'GERAL' ? ' geral' : '') + (bl.emp === e ? ' on' : '')); b.type = 'button';
    b.style.setProperty('--h', empH(e));
    b.setAttribute('aria-pressed', String(bl.emp === e));
    b.setAttribute('aria-label', empNome(e) + ': ' + tot + ' OS, ' + at + ' em atraso');
    b.appendChild(el('span', 'en', empNome(e)));
    b.appendChild(el('b', 'ev', String(tot)));
    const ea = el('span', 'ea'); ea.innerHTML = ic('alert'); ea.appendChild(document.createTextNode(at + ' em atraso · ' + pct1(pc))); b.appendChild(ea);
    const eb = el('i', 'eb'), u = el('u'); u.style.width = pc.toFixed(1) + '%'; eb.appendChild(u); b.appendChild(eb);
    b.onclick = () => { bl.emp = (bl.emp === e && e !== 'GERAL') ? 'GERAL' : e; blSalvar(); bl.limite = 30; blRender(); };
    box.appendChild(b);
  });
}

function blKpis() {
  const l = blFiltrar(), tot = l.length, at = l.filter(x => x.atr).length, pl = l.filter(x => x.play).length, fi = l.filter(x => x.fila).length;
  const ch = bl.dados.concluidosHoje;
  const defs = [
    ['', 'stack', String(tot), 'OS abertas'],
    ['bad', 'alert', String(at), 'Em atraso'],
    ['warn', 'percent', tot ? pct1(at / tot * 100) : '0%', 'Taxa de atraso'],
    ['ok', 'play', String(pl), 'Em play'],
    ['inst', 'queue', String(fi), 'Sem técnico'],
    ['pur', 'check', ch == null ? '--' : String(ch), 'Concluídos hoje']
  ];
  const box = $('bKpis'); box.innerHTML = '';
  const temLista = ch != null && (Array.isArray(bl.dados.concluidosHojeItens) || bl.dados.concluidosHojeDet === true);   // Code.gs antigo: só o número, sem clique
  defs.forEach(([c, i, v, lb]) => {
    const k = el('div', 'kpi' + (c ? ' ' + c : '')); k.innerHTML = ic(i);
    k.appendChild(el('b', '', v)); k.appendChild(el('span', '', lb));
    if (c === 'pur' && temLista) {
      k.classList.add('clk');
      k.setAttribute('role', 'button'); k.tabIndex = 0;
      k.title = 'Ver OS concluídas hoje';
      k.setAttribute('aria-label', 'Concluídos hoje: ' + v + '. Ver a lista de OS');
      k.addEventListener('click', abrirConcluidosHoje);
      k.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirConcluidosHoje(); } });
    }
    box.appendChild(k);
  });
}

function blChips() {
  const l = blFiltrar('sit'), box = $('bChips'); box.innerHTML = '';
  const defs = [['todas', 'Todas', 'list', l.length], ['atraso', 'Em atraso', 'alert', l.filter(x => x.atr).length],
    ['play', 'Em play', 'play', l.filter(x => x.play).length], ['fila', 'Sem técnico', 'queue', l.filter(x => x.fila).length],
    ['venc4', 'Vencem em 4h:', 'clock', l.filter(vence4).length]];
  defs.forEach(([s, n, i, c]) => {
    const on = s === 'todas' ? !bl.f.sit : bl.f.sit === s;
    const b = el('button', 'chp' + (on ? ' on' : '')); b.type = 'button'; b.dataset.s = s; b.setAttribute('aria-pressed', String(on));
    b.innerHTML = ic(i); b.appendChild(document.createTextNode(n)); b.appendChild(el('b', '', String(c)));
    b.onclick = () => { bl.f.sit = s === 'todas' || bl.f.sit === s ? '' : s; bl.limite = 30; blRender(); };
    box.appendChild(b);
  });
}

function facetaNome(k, v) {
  return k === 'cat' ? catDe(v).n : k === 'st' ? v : k === 'cid' ? (bl.cidN[v] || v) : k === 'tec' ? (v === '_fila' ? 'Sem técnico' : 'Técnico: ' + ((bl.tecN && bl.tecN[v]) || v)) : k === 'ag' ? 'Atraso: ' + AGB[+v].n : k === 'sup' ? 'Equipe: ' + supResumo(v, blSupervisores()) : SIT_N[v] || v;
}
function limparTudo() {
  bl.f = {}; bl.busca = ''; $('bBusca').value = ''; bl.limite = 30; blRender();
}
function blStrip() {
  const box = $('bStrip'); box.innerHTML = '';
  const ativos = Object.keys(bl.f).filter(k => bl.f[k] && !(k === 'sit' && bl.f[k] === 'todas'));
  if (!ativos.length && !bl.busca.trim()) return;
  const cnt = el('span', 'cnt'); cnt.appendChild(el('b', '', String(blFiltrar().length))); cnt.appendChild(document.createTextNode(' OS no filtro')); box.appendChild(cnt);
  ativos.forEach(k => {
    const c = el('button', 'fchip'); c.type = 'button';
    c.appendChild(document.createTextNode(facetaNome(k, bl.f[k]))); c.insertAdjacentHTML('beforeend', ic('x'));
    c.setAttribute('aria-label', 'Remover filtro ' + facetaNome(k, bl.f[k]));
    c.onclick = () => { bl.f[k] = ''; bl.limite = 30; blRender(); };
    box.appendChild(c);
  });
  const lp = el('button', 'fbtn', 'Limpar'); lp.type = 'button'; lp.onclick = limparTudo; box.appendChild(lp);
  const go = el('button', 'fbtn go', 'Ver lista'); go.type = 'button'; go.onclick = () => $('bLista').scrollIntoView({ behavior: 'smooth', block: 'start' }); box.appendChild(go);
}

function bRow(o) {
  const b = el('button', 'brow' + (o.on ? ' on' : '') + (o.dim ? ' dim' : '') + (!o.n ? ' zero' : '')); b.type = 'button';
  b.style.setProperty('--h', o.h); b.setAttribute('aria-pressed', String(!!o.on));
  const bi = el('span', 'bi'); if (o.ic) bi.innerHTML = ic(o.ic); else bi.appendChild(el('i', 'dot')); b.appendChild(bi);
  b.appendChild(el('span', 'bn', o.nome));
  const bv = el('span', 'bv');
  if (o.a > 0) { const at = el('span', 'at'); at.title = 'Em atraso'; at.innerHTML = ic('alert'); at.appendChild(document.createTextNode(String(o.a))); bv.appendChild(at); }
  bv.appendChild(el('b', '', String(o.n))); b.appendChild(bv);
  const bb = el('span', 'bb'), u = el('u'); u.style.width = (o.n && o.max ? Math.max(3, o.n / o.max * 100) : 0).toFixed(1) + '%'; bb.appendChild(u); b.appendChild(bb);
  b.onclick = o.click; return b;
}

function blTipo() {
  const l = blFiltrar('cat'), g = agrupa(l, x => x.cat), box = $('bTipo'); box.innerHTML = '';
  $('bTipoN').textContent = l.length + ' OS';
  const rows = CATS.filter(c => c.k !== 'outros' || g.has('outros') || bl.f.cat === 'outros');
  const max = Math.max(1, ...rows.map(c => (g.get(c.k) || { n: 0 }).n));
  rows.forEach(c => {
    const v = g.get(c.k) || { n: 0, a: 0 };
    box.appendChild(bRow({ h: c.h, ic: c.i, nome: c.n, n: v.n, a: v.a, max, on: bl.f.cat === c.k, dim: !!bl.f.cat && bl.f.cat !== c.k, click: () => blToggle('cat', c.k) }));
  });
}

function blStatus() {
  const l = blFiltrar('st'), g = agrupa(l, x => x.stN), box = $('bSt'); box.innerHTML = '';
  $('bStN').textContent = l.length + ' OS';
  const ent = Array.from(g.entries()).sort((a, b) => b[1].n - a[1].n);
  if (bl.f.st && !g.has(bl.f.st)) ent.push([bl.f.st, { n: 0, a: 0 }]);
  if (!ent.length) { box.appendChild(el('div', 'bempty', 'Nenhuma OS neste filtro.')); return; }
  const bar = el('div', 'sbar');
  ent.filter(e => e[1].n).forEach(([k, v]) => { const i = el('i'); i.style.flex = String(v.n); i.style.setProperty('--h', hueDe(k, ST_H)); i.title = k + ': ' + v.n; bar.appendChild(i); });
  box.appendChild(bar);
  const max = Math.max(1, ent[0][1].n);
  ent.forEach(([k, v]) => box.appendChild(bRow({ h: hueDe(k, ST_H), nome: k, n: v.n, a: v.a, max, on: bl.f.st === k, dim: !!bl.f.st && bl.f.st !== k, click: () => blToggle('st', k) })));
}

function blAging() {
  const l = blFiltrar('ag').filter(x => x.atr), box = $('bAg'); box.innerHTML = '';
  $('bAgN').textContent = l.length + ' em atraso';
  if (!l.length && !bl.f.ag) { box.appendChild(el('div', 'bempty', 'Nenhuma OS em atraso neste filtro.')); return; }
  const cont = [0, 0, 0, 0]; l.forEach(x => { cont[+agBucket(x)]++; });
  const max = Math.max(1, ...cont), wrap = el('div', 'age');
  AGB.forEach((a, i) => {
    const b = el('button', 'agc' + (bl.f.ag === String(i) ? ' on' : '') + (bl.f.ag && bl.f.ag !== String(i) ? ' dim' : '')); b.type = 'button';
    b.style.setProperty('--h', a.h); b.setAttribute('aria-pressed', String(bl.f.ag === String(i)));
    b.appendChild(el('b', '', String(cont[i])));
    const c = el('i', 'col'); c.style.height = (cont[i] ? Math.max(8, cont[i] / max * 96) : 4) + 'px'; b.appendChild(c);
    b.appendChild(el('span', '', a.n));
    b.onclick = () => blToggle('ag', String(i));
    wrap.appendChild(b);
  });
  box.appendChild(wrap);
}

function blCidades() {
  const l = blFiltrar('cid'), g = agrupa(l, x => x.cidK), box = $('bCid'); box.innerHTML = '';
  const ent = Array.from(g.entries()).sort((a, b) => b[1].n - a[1].n || (bl.cidN[a[0]] || '').localeCompare(bl.cidN[b[0]] || '', 'pt-BR'));
  $('bCidN').textContent = ent.length + (ent.length === 1 ? ' cidade' : ' cidades');
  if (!ent.length) { box.appendChild(el('div', 'bempty', 'Nenhuma OS neste filtro.')); return; }
  const TOP = 8;
  let show = bl.verCid ? ent : ent.slice(0, TOP);
  if (!bl.verCid && bl.f.cid && !show.some(e => e[0] === bl.f.cid)) { const s = ent.find(e => e[0] === bl.f.cid); if (s) show = show.concat([s]); }
  const max = Math.max(1, ent[0][1].n);
  show.forEach(([k, v]) => box.appendChild(bRow({ h: 200, ic: 'pin', nome: bl.cidN[k] || k, n: v.n, a: v.a, max, on: bl.f.cid === k, dim: !!bl.f.cid && bl.f.cid !== k, click: () => blToggle('cid', k) })));
  if (ent.length > TOP) {
    const m = el('button', 'bmore', bl.verCid ? 'Ver menos' : 'Ver todas (' + ent.length + ')'); m.type = 'button';
    m.onclick = () => { bl.verCid = !bl.verCid; blCidades(); }; box.appendChild(m);
  }
}

function blTecnicos() {
  const sec = $('bTecSec');
  if (ehTec()) { sec.hidden = true; return; }          // o técnico só tem as próprias OS
  sec.hidden = false;
  const l = blFiltrar('tec'), g = agrupa(l, x => x.tecK), box = $('bTec'); box.innerHTML = '';
  const nome = k => k === '_fila' ? 'Sem técnico' : ((bl.tecN && bl.tecN[k]) || k);
  const ent = Array.from(g.entries()).sort((a, b) => b[1].n - a[1].n || nome(a[0]).localeCompare(nome(b[0]), 'pt-BR'));
  $('bTecN').textContent = ent.length + (ent.length === 1 ? ' responsável' : ' responsáveis');
  if (!ent.length) { box.appendChild(el('div', 'bempty', 'Nenhuma OS neste filtro.')); return; }
  const TOP = 8;
  let show = bl.verTec ? ent : ent.slice(0, TOP);
  if (!bl.verTec && bl.f.tec && !show.some(e => e[0] === bl.f.tec)) { const s = ent.find(e => e[0] === bl.f.tec); if (s) show = show.concat([s]); }
  const max = Math.max(1, ent[0][1].n);
  show.forEach(([k, v]) => box.appendChild(bRow({ h: k === '_fila' ? 190 : 215, ic: k === '_fila' ? 'queue' : 'wrench', nome: nome(k), n: v.n, a: v.a, max, on: bl.f.tec === k, dim: !!bl.f.tec && bl.f.tec !== k, click: () => blToggle('tec', k) })));
  if (ent.length > TOP) {
    const m = el('button', 'bmore', bl.verTec ? 'Ver menos' : 'Ver todos (' + ent.length + ')'); m.type = 'button';
    m.onclick = () => { bl.verTec = !bl.verTec; blTecnicos(); }; box.appendChild(m);
  }
}

function blMatriz() {
  const l = blFiltrar('cat', true), emps = blEmpresas(), box = $('bMx'); box.innerHTML = '';
  const cell = {}; let max = 1;
  l.forEach(x => { [x.emp, 'GERAL'].forEach(e => { const k = x.cat + '|' + e; cell[k] = (cell[k] || 0) + 1; if (e !== 'GERAL') max = Math.max(max, cell[k]); }); });
  const rows = CATS.filter(c => c.k !== 'outros' || emps.some(e => cell['outros|' + e]));
  const t = el('table', 'mx'); t.setAttribute('role', 'grid');
  const hr = el('tr'); hr.appendChild(el('th', '', 'Tipo'));
  emps.forEach(e => hr.appendChild(el('th', '', empNome(e)))); t.appendChild(el('thead')).appendChild(hr);
  const tb = el('tbody');
  const botao = (v, e, k) => {
    const td = el('td'), b = el('button', v ? '' : 'z', String(v)); b.type = 'button';
    if (v) { b.style.setProperty('--a', (e === 'GERAL' ? .1 + .25 * Math.min(1, v / (max * 3)) : .12 + .5 * v / max).toFixed(2)); b.style.setProperty('--c', empH(e)); }
    if (bl.emp === e && k && bl.f.cat === k) b.classList.add('on');
    b.setAttribute('aria-label', empNome(e) + (k ? ' · ' + catDe(k).n : ' · total') + ': ' + v);
    b.onclick = () => { const ja = bl.emp === e && k && bl.f.cat === k; bl.emp = e; blSalvar(); bl.f.cat = ja ? '' : (k || ''); bl.limite = 30; blRender(); };
    td.appendChild(b); return td;
  };
  rows.forEach(c => {
    const tr = el('tr'), n = el('td', 'cn'); n.innerHTML = '<span class="l"></span><span class="s"></span>';
    n.firstChild.textContent = c.n; n.lastChild.textContent = c.s; tr.appendChild(n);
    emps.forEach(e => tr.appendChild(botao(cell[c.k + '|' + e] || 0, e, c.k)));
    tb.appendChild(tr);
  });
  const sep = el('tr', 'sep'); sep.appendChild(el('td')); tb.appendChild(sep);
  const tot = el('tr', 'tot'); tot.appendChild(el('td', 'cn', 'Total'));
  const atr = el('tr'); atr.appendChild(el('td', 'cn', 'Em atraso'));
  emps.forEach(e => {
    const le = e === 'GERAL' ? l : l.filter(x => x.emp === e), a = le.filter(x => x.atr).length;
    const td = el('td'), b = el('button', '', String(le.length)); b.type = 'button';
    b.onclick = () => { bl.emp = e; blSalvar(); bl.f.cat = ''; bl.limite = 30; blRender(); };
    td.appendChild(b); tot.appendChild(td);
    const ta = el('td'), ba = el('button', 'at', String(a)); ba.type = 'button'; ba.tabIndex = -1;
    ta.appendChild(ba); atr.appendChild(ta);
  });
  tb.appendChild(tot); tb.appendChild(atr); t.appendChild(tb); box.appendChild(t);
}

/* ----- lista ----- */
const BIG = 9e15;
const SORTS = {
  atraso: (a, b) => (b.atr - a.atr) || ((a.pz == null ? BIG : a.pz) - (b.pz == null ? BIG : b.pz)),
  prazo: (a, b) => (a.pz == null ? BIG : a.pz) - (b.pz == null ? BIG : b.pz),
  antigas: (a, b) => (a.ab == null ? BIG : a.ab) - (b.ab == null ? BIG : b.ab),
  recentes: (a, b) => (b.ab || 0) - (a.ab || 0),
  cidade: (a, b) => a.cidN.localeCompare(b.cidN, 'pt-BR') || SORTS.atraso(a, b),
  tecnico: (a, b) => (a.fila - b.fila) || a.resp.localeCompare(b.resp, 'pt-BR') || SORTS.atraso(a, b)
};
function sitOS(x) {
  if (x.atr) return 'bad';
  if (x.pz && x.pz >= bl.now && x.pz - bl.now < 864e5) return 'warn';
  return 'ok';
}
function prazoTxt(x) {
  if (x.atr) return x.pz && x.pz < bl.now ? 'Atrasada há ' + dur(bl.now - x.pz) : 'Em atraso';
  if (!x.pz) return 'Sem prazo';
  return x.pz >= bl.now ? 'Vence em ' + dur(x.pz - bl.now) : 'Prazo ' + fmtStamp(x.pz);
}
function tecTxt(x) { return x.resp ? tc(x.resp) : 'Sem responsável'; }

// destaca o termo pesquisado sem innerHTML: só nós de texto e <mark> (ignora acentos e maiúsculas)
function realce(no, texto, termo) {
  texto = String(texto == null ? '' : texto);
  const q = semAcento(termo || '').trim();
  if (!q) { no.appendChild(document.createTextNode(texto)); return no; }
  let norm = ''; const mapa = [];
  for (let i = 0; i < texto.length; i++) { const n = semAcento(texto[i]); for (let k = 0; k < n.length; k++) { norm += n[k]; mapa.push(i); } }
  let pos = 0, ult = 0;
  while ((pos = norm.indexOf(q, pos)) >= 0) {
    const ini = mapa[pos], fim = mapa[pos + q.length - 1] + 1;
    if (ini >= ult) { if (ini > ult) no.appendChild(document.createTextNode(texto.slice(ult, ini))); no.appendChild(el('mark', 'hl', texto.slice(ini, fim))); ult = fim; }
    pos += q.length;
  }
  if (ult < texto.length) no.appendChild(document.createTextNode(texto.slice(ult)));
  return no;
}
function osCard(x) {
  const s = sitOS(x), c = catDe(x.cat);
  const r = el('div', 'os ' + s); r.tabIndex = 0; r.setAttribute('role', 'button');
  r.setAttribute('aria-label', 'OS ' + x.id + ', ' + (x.cli || 'sem cliente') + ', ' + prazoTxt(x));
  const top = el('div', 'os-top');
  top.appendChild(realce(el('span', 'os-id'), '#' + x.id, bl.busca));
  const p = el('span', 'opill'); p.style.setProperty('--h', c.h); p.innerHTML = ic(c.i); p.appendChild(document.createTextNode(c.n)); top.appendChild(p);
  if (x.play) { const pl = el('span', 'os-play'); pl.title = 'Em play'; pl.innerHTML = ic('play'); top.appendChild(pl); }
  const et = el('span', 'etag', x.emp); et.style.setProperty('--h', empH(x.emp)); top.appendChild(et);
  r.appendChild(top);
  r.appendChild(realce(el('div', 'os-cli'), x.cli ? tc(x.cli) : 'Cliente não informado', bl.busca));
  const sub = el('div', 'os-sub'); sub.innerHTML = ic('pin'); sub.appendChild(realce(el('span'), [x.cidN !== 'Sem cidade' ? x.cidN : '', x.bai ? tc(x.bai) : ''].filter(Boolean).join(' · ') || 'Sem endereço', bl.busca)); r.appendChild(sub);
  r.appendChild(el('div', 'os-tipo', x.tipo));
  const bot = el('div', 'os-bot');
  const tg = el('span', 'tag ' + s); tg.innerHTML = ic(s === 'bad' ? 'alert' : 'clock'); tg.appendChild(document.createTextNode(prazoTxt(x))); bot.appendChild(tg);
  bot.appendChild(el('span', 'tag st', x.stN));
  if (x.atr) bot.appendChild(seloAtraso('tag'));
  const tec = el('span', 'os-tec' + (x.fila ? ' fila' : '')); tec.innerHTML = ic(x.fila ? 'queue' : 'wrench'); tec.appendChild(realce(el('span'), tecTxt(x), bl.busca)); bot.appendChild(tec);
  r.appendChild(bot);
  const abrir = () => abrirOS(x);
  r.addEventListener('click', abrir);
  r.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } });
  return r;
}

function blLista() {
  const l = blFiltrar().slice().sort(SORTS[bl.ordem] || SORTS.atraso), box = $('bOs'); box.innerHTML = '';
  const n = Math.min(l.length, bl.limite);
  $('bListN').textContent = l.length ? 'Mostrando ' + n + ' de ' + l.length : '';
  if (!l.length) {
    const v = el('div', 'bempty', 'Nenhuma OS encontrada.');
    if (Object.keys(bl.f).some(k => bl.f[k]) || bl.busca.trim()) { const b = el('button', 'btn vz-btn', 'Limpar filtros'); b.type = 'button'; b.onclick = limparTudo; v.appendChild(b); }
    box.appendChild(v);
  }
  l.slice(0, n).forEach(x => box.appendChild(osCard(x)));
  const m = $('bMais'); m.hidden = l.length <= n;
  m.textContent = 'Mostrar mais ' + Math.min(30, l.length - n) + ' (restam ' + (l.length - n) + ')';
}
$('bMais').onclick = () => { bl.limite += 30; blLista(); };
const fmtDH = ms => { if (!ms) return ''; const p = {}; new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(Number(ms))).forEach(x => p[x.type] = x.value); return p.day + '/' + p.month + '/' + p.year + ' ' + p.hour + ':' + p.minute; };
// mesma lista filtrada e ordenada da tela (todas as OS, não só as que estão visíveis na página)
function csvBacklog() {
  const cab = ['protocolo', 'empresa', 'tipo', 'status', 'atraso', 'prazo', 'cliente', 'cidade', 'bairro', 'técnico'];
  const l = blFiltrar().slice().sort(SORTS[bl.ordem] || SORTS.atraso).map(x => [x.id, x.emp, x.tipo, x.stN, x.atr ? 'Sim' : 'Não', fmtDH(x.pz), x.cli ? tc(x.cli) : '', x.cid ? tc(x.cid) : '', x.bai ? tc(x.bai) : '', x.resp ? tc(x.resp) : 'Sem técnico']);
  return csvTexto(cab, l);
}
$('bCsv').onclick = () => { if (bl.dados) baixarCSV('backlog-' + dataHoje() + '.csv', csvBacklog()); };

/* ----- detalhe da OS ----- */
function resumoOS(x) {
  const end = [x.end, x.bai ? tc(x.bai) : '', x.cid ? tc(x.cid) : ''].filter(Boolean).join(', ');
  return ['OS #' + x.id, 'Tipo: ' + (x.tipo || '-'), 'Cliente: ' + (x.cli ? tc(x.cli) : '-'), 'Endereço: ' + (end || '-'),
    'Prazo: ' + (fmtDH(x.pz) || '-'), 'Status: ' + x.stN, 'Atraso: ' + (x.atr ? 'Sim' : 'Não'), 'Técnico: ' + tecTxt(x)].join('\n');
}
async function copiarTexto(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (_) {}
  try { const ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;left:-999px'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (_) { return false; }
}
function abrirOS(x) {
  const s = sitOS(x), c = catDe(x.cat);
  $('oTipo').textContent = x.tipo || c.n;
  $('oSub').textContent = '#' + x.id + ' · ' + x.emp + ' · ' + c.n;
  const ch = $('oChips'); ch.innerHTML = '';
  const t1 = el('span', 'tag ' + s); t1.innerHTML = ic(s === 'bad' ? 'alert' : 'clock'); t1.appendChild(document.createTextNode(prazoTxt(x))); ch.appendChild(t1);
  ch.appendChild(el('span', 'tag st', x.stN));
  if (x.atr) ch.appendChild(seloAtraso('tag'));
  if (x.play) { const p = el('span', 'tag ok'); p.innerHTML = ic('play'); p.appendChild(document.createTextNode('Em play')); ch.appendChild(p); }
  if (x.fila) { const f = el('span', 'tag st'); f.innerHTML = ic('queue'); f.appendChild(document.createTextNode('Sem técnico')); ch.appendChild(f); }

  const ac = $('oActs'); ac.innerHTML = '';
  const digs = v => String(v || '').replace(/\D/g, '');
  const tel = digs(x.t1) || digs(x.t2);
  const link = (cls, icone, txt, href) => { const a = el('a', 'oact ' + cls); a.innerHTML = ic(icone); a.appendChild(document.createTextNode(txt)); a.href = href; if (/^https/.test(href)) { a.target = '_blank'; a.rel = 'noopener'; } ac.appendChild(a); };
  if (tel.length >= 10) {
    link('', 'phone', 'Ligar', 'tel:' + tel);
    link('wa', 'chat', 'WhatsApp', 'https://wa.me/' + (tel.length <= 11 ? '55' + tel : tel));
  }
  const endTxt = [x.end, x.bai ? tc(x.bai) : '', x.cid ? tc(x.cid) : ''].filter(Boolean).join(', ');
  if (x.lat != null && x.lon != null) link('mp', 'pin', 'Mapa', 'https://www.google.com/maps/search/?api=1&query=' + x.lat + ',' + x.lon);
  else if (endTxt) link('mp', 'pin', 'Mapa', 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(endTxt));

  { // Etapa 14c: copia o resumo e, se o aparelho suportar, abre o compartilhamento nativo (WhatsApp, etc.)
    const b = el('button', 'oact cp'); b.type = 'button'; b.innerHTML = ic('copy'); const tx = document.createTextNode('Copiar resumo'); b.appendChild(tx);
    b.onclick = async () => {
      const t = resumoOS(x), ok = await copiarTexto(t);
      tx.nodeValue = ok ? 'Copiado' : 'Não copiou'; b.classList.toggle('feito', ok);
      setTimeout(() => { tx.nodeValue = 'Copiar resumo'; b.classList.remove('feito'); }, 2000);
      if (navigator.share) { try { await navigator.share({ title: 'OS #' + x.id, text: t }); } catch (_) {} }
    };
    ac.appendChild(b);
  }
  const dl = $('oDet'); dl.innerHTML = '';
  const par = (k, v) => { if (v == null || v === '') return; dl.appendChild(el('dt', '', k)); dl.appendChild(el('dd', '', String(v))); };
  par('Cliente', x.cli ? tc(x.cli) : '');
  par('Telefone 1', x.t1); if (x.t2 && x.t2 !== x.t1) par('Telefone 2', x.t2);
  par('Endereço', endTxt);
  par('Aberta em', fmtFull(x.ab));
  par('Aberta há', x.ab ? dur(bl.now - x.ab) : '');
  par('Prazo', fmtFull(x.pz));
  par('Responsável', x.fila ? (x.resp ? tc(x.resp) + ' (fila)' : 'Sem responsável') : tc(x.resp));
  par('Aberta por', x.at ? tc(x.at) : '');
  par('Equipe', x.eq);
  par('Classificação', (x.cats || []).join(' › '));
  par('OS original', x.orig);
  const precisaDesc = x.desc === undefined && x.temDesc;     // resposta leve: a descrição vem do servidor
  $('oDescBox').hidden = !(x.desc || precisaDesc);
  $('oDesc').textContent = x.desc || '';
  $('oDescAux').innerHTML = '';
  $('osBox').scrollTop = 0;
  abrirDlg($('dlgOS'));
  if (precisaDesc) comCarregando($('oDescAux'), async ativo => {
    const j = await buscarServidor(qAuth(new URLSearchParams({ acao: 'os', id: x.id })));
    x.desc = j.desc || '';
    if (ativo()) { $('oDesc').textContent = x.desc; $('oDescBox').hidden = !x.desc; }
  });
}
$('oFechar').onclick = () => $('dlgOS').close();

/* ----- Concluídos hoje (Backlog) ----- */
const chSt = { emp: 'GERAL', busca: '' };
function chFiltrados(ignoraEmp) {
  const q = semAcento(chSt.busca).trim();
  return (bl.dados.concluidosHojeItens || []).filter(p =>
    (ignoraEmp || chSt.emp === 'GERAL' || p.emp === chSt.emp) &&
    (!q || semAcento([p.protocolo, p.cliente, p.cidade, p.tecnico].join(' ')).indexOf(q) >= 0));
}
function chDesenhar() {
  const todos = bl.dados.concluidosHojeItens || [], l = chFiltrados(false), base = chFiltrados(true);
  const total = bl.dados.concluidosHoje != null ? Number(bl.dados.concluidosHoje) : todos.length;
  const emps = ['GERAL'].concat(Array.from(new Set(todos.map(p => p.emp))).sort());
  if (emps.indexOf(chSt.emp) < 0) chSt.emp = 'GERAL';
  const filtrando = chSt.emp !== 'GERAL' || chSt.busca.trim();
  $('chSub').textContent = (filtrando ? l.length + ' de ' + total : String(total)) + (total === 1 ? ' OS concluída hoje' : ' OS concluídas hoje') +
    (!filtrando && todos.length < total ? ' (mostrando ' + todos.length + ')' : '');
  const cb = $('chChips'); cb.innerHTML = '';
  emps.forEach(e => {
    const n = e === 'GERAL' ? base.length : base.filter(p => p.emp === e).length;
    const b = el('button', 'chp' + (chSt.emp === e ? ' on' : '')); b.type = 'button'; b.setAttribute('aria-pressed', String(chSt.emp === e));
    b.appendChild(document.createTextNode(empNome(e))); b.appendChild(el('b', '', String(n)));
    b.onclick = () => { chSt.emp = e; chDesenhar(); };
    cb.appendChild(b);
  });
  const box = $('chLista'); box.innerHTML = '';
  if (!l.length) {
    const v = el('div', 'pvazio'); v.innerHTML = ic('check');
    v.appendChild(el('b', '', 'Nenhuma OS concluída hoje'));
    box.appendChild(v); return;
  }
  const g = new Map();
  l.forEach(p => { const k = p.tecnico || 'Sem técnico'; if (!g.has(k)) g.set(k, []); g.get(k).push(p); });
  Array.from(g.entries()).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'pt-BR')).forEach(([nome, arr]) => {
    const hd = el('div', 'chg'); hd.appendChild(el('b', '', tc(nome))); hd.appendChild(el('span', '', arr.length + (arr.length === 1 ? ' OS' : ' OS')));
    box.appendChild(hd);
    arr.forEach(p => box.appendChild(cartaoOS(p, 'Concluído', 'cc')));
  });
}
function abrirConcluidosHoje() {
  if (!bl.dados) return;
  chSt.emp = 'GERAL'; chSt.busca = ''; $('chBusca').value = '';
  $('chBox').scrollTop = 0;
  if (Array.isArray(bl.dados.concluidosHojeItens)) { chDesenhar(); abrirDlg($('dlgCH')); return; }
  if (!bl.dados.concluidosHojeDet) return;
  $('chSub').textContent = 'Carregando...'; $('chChips').innerHTML = '';
  abrirDlg($('dlgCH'));
  comCarregando($('chLista'), async ativo => {
    const j = await buscarServidor(qAuth(new URLSearchParams({ acao: 'concluidosHoje' })));
    if (!ativo()) return;
    bl.dados.concluidosHojeItens = Array.isArray(j.itens) ? j.itens : [];
    $('chLista').innerHTML = '';
    chDesenhar();
  });
}
$('chBusca').addEventListener('input', e => { chSt.busca = e.target.value; chDesenhar(); });
$('chFechar').onclick = () => $('dlgCH').close();

/* ----- eventos ----- */
$('bBusca').addEventListener('input', e => { bl.busca = e.target.value; bl.limite = 30; blRender(); });
$('bOrdem').addEventListener('change', e => { bl.ordem = e.target.value; blSalvar(); blLista(); });
$('bRef').onclick = () => carregarBacklog();

/* ----- barra inferior no celular (Etapa 19) ----- */
function bnavAtualizar() {
  const b = emBacklog();
  document.querySelectorAll('#bnav button').forEach(x => {
    const on = (x.dataset.a === 'blk') === b && x.dataset.a !== 'filtro';
    x.classList.toggle('on', on); if (on) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current');
  });
}
document.querySelectorAll('#bnav button').forEach(x => x.addEventListener('click', () => {
  const k = x.dataset.a;
  if (k === 'prod') { if (emBacklog()) fecharBacklog(); else window.scrollTo({ top: 0, behavior: 'smooth' }); }
  else if (k === 'blk') { if (!emBacklog()) abrirBacklog(); else window.scrollTo({ top: 0, behavior: 'smooth' }); }
  else (emBacklog() ? $('bFiltBtn') : $('filtroBtn')).click();          // o filtro da tela atual
}));
// a barra some com o teclado aberto (campo de texto em foco)
document.addEventListener('focusin', e => { if (e.target.matches && e.target.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, select')) document.body.classList.add('kb'); });
document.addEventListener('focusout', () => setTimeout(() => { const f = document.activeElement; if (!f || !f.matches || !f.matches('input, textarea, select')) document.body.classList.remove('kb'); }, 60));

/* ----- Modo TV (Etapa 20) -----
   Usa a sessão já aberta no aparelho (nada de login ou senha na URL). Esc ou toque longo no canto superior direito sai. */
const tv = { on: false, seg: 0, tick: null, raf: 0, y: 0, pausaAte: 0, fimCiclo: false, antes: null, ts: 0 };
const relogio = () => { const p = {}; new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).forEach(x => p[x.type] = x.value); return p.hour + ':' + p.minute + ':' + p.second; };
function tvPintar() {
  const bk = emBacklog(), d = bk ? bl.dados : state.dados, em = bk ? bl.dadosEm : state.dadosEm;
  $('tvTela').textContent = bk ? 'Backlog' : 'Produção Parcial';
  const quando = d && (d.atualizado || (em ? hhmm(em) : ''));
  $('tvAtual').textContent = quando ? 'Atualizado em ' + quando : 'Carregando...';
  $('tvRelogio').textContent = relogio();
}
function tvTrocarTela() {
  if (emBacklog()) fecharBacklog(); else abrirBacklog();
  window.scrollTo(0, 0); tv.y = 0; tv.seg = 0; tv.fimCiclo = false; tv.pausaAte = performance.now() + TV_CFG.pausaTopoMs;
  tvPintar();
}
function tvQuadro(ts) {
  if (!tv.on) return;
  const dt = tv.ts ? Math.min(.25, (ts - tv.ts) / 1000) : 0; tv.ts = ts;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (!emBacklog() && max > 8) {                       // lista maior que a tela: rola devagar e volta ao topo
    if (ts >= tv.pausaAte) {
      if (tv.y >= max - 1) { tv.y = 0; window.scrollTo(0, 0); tv.pausaAte = ts + TV_CFG.pausaTopoMs; tv.fimCiclo = true; }
      else { tv.y = Math.min(max, tv.y + TV_CFG.rolagemPxPorSegundo * dt); window.scrollTo(0, tv.y); if (tv.y >= max - 1) tv.pausaAte = ts + TV_CFG.pausaFimMs; }
    }
  } else tv.fimCiclo = true;
  tv.raf = requestAnimationFrame(tvQuadro);
}
function entrarTV() {
  if (tv.on || !state.cred || document.body.classList.contains('sem-login')) return;
  tv.on = true; tv.antes = { blk: emBacklog(), y: window.scrollY };
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  document.body.classList.add('tv');
  if (!state.dados) carregar();
  if (!bl.dados) carregarBacklog();
  window.scrollTo(0, 0); tv.y = 0; tv.seg = 0; tv.fimCiclo = false; tv.ts = 0; tv.pausaAte = performance.now() + TV_CFG.pausaTopoMs;
  tvPintar();
  try { const r = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); if (r && r.catch) r.catch(() => {}); } catch (_) {}
  tv.tick = setInterval(() => {
    tv.seg++; $('tvRelogio').textContent = relogio();
    if (tv.seg % 5 === 0) tvPintar();
    // mantém os dois conjuntos de dados em dia (a tela da vez já é atualizada pelo intervalo normal)
    if (tv.seg % 30 === 0) {
      if (emBacklog() && Date.now() - state.ultimaCarga > AUTO_MIN * 60000) carregar();
      if (!emBacklog() && bl.ultima && Date.now() - bl.ultima > AUTO_MIN * 60000) carregarBacklog();
    }
    if (TV_CFG.rotacao && tv.seg >= TV_CFG.segundosPorTela && tv.fimCiclo) tvTrocarTela();   // espera o fim da rolagem para não cortar a lista
  }, 1000);
  tv.raf = requestAnimationFrame(tvQuadro);
}
function sairTV() {
  if (!tv.on) return;
  tv.on = false; clearInterval(tv.tick); cancelAnimationFrame(tv.raf);
  document.body.classList.remove('tv');
  try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen(); } catch (_) {}
  const a0 = tv.antes || { blk: false, y: 0 };
  if (a0.blk !== emBacklog()) { if (a0.blk) abrirBacklog(); else fecharBacklog(); }   // volta à tela de antes (os filtros não foram tocados)
  setTimeout(() => window.scrollTo(0, a0.y || 0), 60);
  tituloAba();
}
$('tvBtn').onclick = entrarTV; $('bTvBtn').onclick = entrarTV;
document.addEventListener('keydown', e => { if (tv.on && e.key === 'Escape') { e.preventDefault(); sairTV(); } });
document.addEventListener('fullscreenchange', () => { if (tv.on && !document.fullscreenElement) sairTV(); });
(function () {                                           // toque longo no canto superior direito
  const z = $('tvSair'); let t = null;
  const cancela = () => { clearTimeout(t); t = null; };
  z.addEventListener('pointerdown', () => { cancela(); t = setTimeout(sairTV, 700); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => z.addEventListener(ev, cancela));
})();

/* ----- navegação entre as telas ----- */
function abrirBacklog() {
  document.body.classList.add('v-blk'); store.set(K.view, 'blk');
  window.scrollTo(0, 0);
  if (bl.dados) blRender();
  if (!bl.dados || Date.now() - bl.ultima > 60000) carregarBacklog();
  bnavAtualizar();
}
function fecharBacklog() {
  document.body.classList.remove('v-blk'); store.set(K.view, '');
  window.scrollTo(0, 0);
  if (state.dados) render();
  else carregar();
  bnavAtualizar();
}
$('blkBtn').onclick = abrirBacklog;
$('bHome').onclick = fecharBacklog;

setInterval(() => { bl.now = Date.now(); if (state.dados && !emBacklog()) { mostrarModo(); mostrarFrescor(); } if (bl.dados && emBacklog()) { blModo(); blFrescor(); } alertaSync(); tituloAba(); if (bl.dados) notificarVencimentos(); }, 30000);

/* ----- atualização automática ----- */
setInterval(() => {
  if (document.hidden) return;
  if (emBacklog()) { if (Date.now() - bl.ultima > AUTO_MIN * 60000) carregarBacklog(); }
  else if (Date.now() - state.ultimaCarga > AUTO_MIN * 60000) carregar();
}, 30000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (emBacklog()) { if (bl.ultima && Date.now() - bl.ultima > 2 * 60000) carregarBacklog(); }
  else if (state.ultimaCarga && Date.now() - state.ultimaCarga > 2 * 60000) carregar();
});

/* ----- puxar para atualizar (celular, só com a página no topo) ----- */
(function () {
  const ptr = $('ptr'), toque = window.matchMedia('(pointer: coarse)');
  let y0 = null, dy = 0;
  const reduz = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esconder = () => { ptr.className = 'ptr'; ptr.style.transform = ''; };
  window.addEventListener('touchstart', e => {
    if (!toque.matches || e.touches.length !== 1 || window.scrollY > 0 || document.body.classList.contains('sem-login') || document.querySelector('dialog[open]')) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  window.addEventListener('touchmove', e => {
    if (y0 == null) return;
    if (window.scrollY > 0) { y0 = null; esconder(); return; }
    dy = e.touches[0].clientY - y0;
    if (dy < 12) { esconder(); return; }
    const d = Math.min(dy, 110);
    ptr.className = 'ptr on' + (dy > 70 ? ' pronto' : '') + (reduz() ? ' sem-mov' : '');
    ptr.style.transform = 'translate(-50%, ' + Math.round(d * .55) + 'px)';
    ptr.textContent = dy > 70 ? 'Solte para atualizar' : 'Puxe para atualizar';
  }, { passive: true });
  window.addEventListener('touchend', () => {
    const vai = y0 != null && dy > 70;
    y0 = null; dy = 0; esconder();
    if (vai) { if (emBacklog()) carregarBacklog(); else carregar(); }
  }, { passive: true });
})();

aplicarTema();
bnavAtualizar();
loginPreencher();
if (state.cred) {
  if (store.get(K.view, '') === 'blk') { document.body.classList.add('v-blk'); carregarBacklog(); }
  else carregar();
}

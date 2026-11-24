/* ============ CONFIGURAÇÃO ============ */
// URL do app da web (termina em /exec), gerada ao implantar o Apps Script
const URL_PADRAO = 'https://script.google.com/macros/s/AKfycbxpLpDK0WJ53wMXThw2NBb5L9EduZ3DGYrR7IZbSEalXjP-RE8klCTE5JEW5quKltivHw/exec';
// Opcional: link CSV da aba "URL" publicada na web (assim você troca a URL só na planilha)
const URL_CSV = 'https://script.google.com/macros/s/AKfycbxpLpDK0WJ53wMXThw2NBb5L9EduZ3DGYrR7IZbSEalXjP-RE8klCTE5JEW5quKltivHw/exec';
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
  { periodo: 'hoje', ini: '', fim: '', cal: { dias: [], meses: [] }, ordem: 'sup', escala: '' },
  store.get(K.filtros, {})
);
state.busca = '';
state.dir = state.dir === 'asc' || state.dir === 'desc' ? state.dir : '';   // sentido da ordenação pelo cabeçalho ('' = o padrão da coluna)
state.grpFechado = new Set();       // equipes recolhidas na tabela (só na tela)
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
    b.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-' + (claro ? 'sun' : 'moon') + '"/></svg><span>Tema</span>';
    b.setAttribute('aria-label', 'Tema: ' + (e === 'auto' ? 'automático' : e) + '. Escolher');
  });
  document.querySelectorAll('#temaMenu button').forEach(b => { const on = b.dataset.t === e; b.setAttribute('aria-checked', String(on)); b.classList.toggle('on', on); });
}
if (mqClaro.addEventListener) mqClaro.addEventListener('change', aplicarTema); else mqClaro.addListener(aplicarTema);
/* ----- menu do topo (3 barrinhas): mesmos itens, mesma cor e mesma ordem na Produção e no Backlog ----- */
(function () {
  const fechar = foco => document.querySelectorAll('.hmenu').forEach(m => {
    if (m.hidden) return;
    m.hidden = true;
    const b = m.parentElement.querySelector('.menu-btn');
    if (b) { b.setAttribute('aria-expanded', 'false'); if (foco) b.focus(); }
  });
  const itens = m => Array.from(m.querySelectorAll('.mi')).filter(x => !x.hidden && x.offsetParent !== null);
  document.querySelectorAll('.menu-btn').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const m = b.parentElement.querySelector('.hmenu'), abrir = m.hidden;
    fechar();
    if (!abrir) return;
    m.hidden = false; b.setAttribute('aria-expanded', 'true');
    const p = itens(m)[0]; if (p) p.focus();
  }));
  document.querySelectorAll('.hmenu').forEach(m => {
    // captura: fecha o menu e devolve o foco ao botão antes da ação do item (o foco volta certo depois dos diálogos)
    m.addEventListener('click', e => { if (e.target.closest('.mi')) { fechar(false); const b = m.parentElement.querySelector('.menu-btn'); if (b) b.focus({ preventScroll: true }); } }, true);
    m.addEventListener('keydown', e => {
      const l = itens(m), i = l.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); l[(i + 1) % l.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); l[(i + l.length - 1) % l.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); l[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); l[l.length - 1].focus(); }
      else if (e.key === 'Tab') fechar(false);
    });
  });
  document.addEventListener('click', e => { if (!e.target.closest('.hmenu')) fechar(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.querySelector('.hmenu:not([hidden])')) fechar(true); });
})();
(function () {
  const menu = document.getElementById('temaMenu'); let aberto = null;
  const anc = b => { const t = b.closest('.top'); return (t && t.querySelector('.menu-btn')) || b; };   // o seletor abre abaixo do botão do menu
  const fechar = () => { menu.hidden = true; if (aberto) { aberto.setAttribute('aria-expanded', 'false'); aberto = null; } };
  document.querySelectorAll('.tema-btn').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    if (aberto === b) { fechar(); return; }
    fechar(); aberto = b; b.setAttribute('aria-expanded', 'true'); menu.hidden = false;
    const r = anc(b).getBoundingClientRect();
    menu.style.top = Math.round(r.bottom + 6) + 'px'; menu.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px';
    const on = menu.querySelector('button.on') || menu.querySelector('button'); on.focus();
  }));
  menu.querySelectorAll('button').forEach(x => x.addEventListener('click', () => {
    try { localStorage.setItem(TEMA_K, x.dataset.t); } catch (_) {}
    aplicarTema(); const b = aberto; fechar(); if (b) anc(b).focus();
  }));
  menu.addEventListener('keydown', e => {
    const bs = Array.from(menu.querySelectorAll('button')), i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i + bs.length - 1) % bs.length].focus(); }
    else if (e.key === 'Escape') { e.stopPropagation(); const b = aberto; fechar(); if (b) anc(b).focus(); }
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
const PAPEL_N = { tecnico: 'Técnico', supervisor: 'Supervisor', controlador: 'Controlador', coordenador: 'Coordenador' };
const supsPadrao = () => (papel() === 'supervisor' || papel() === 'controlador') && state.user.supervisor ? [nk(state.user.supervisor)] : [];   // controlador: a equipe do supervisor dele
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
  $('acessBtn').hidden = $('bAcessBtn').hidden = !(u.papel === 'supervisor' || u.papel === 'coordenador');   // quem está logado: só supervisor e coordenador
  $('cfgBtn').hidden = $('bCfgBtn').hidden = !(u.papel === 'supervisor' || u.papel === 'coordenador');       // Configurações: só supervisor e coordenador
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
  if (state.escala) q.set('escala', state.escala);                 // filtro de escala / extra (data aaaa-mm-dd)
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
const lcSig = () => hash36(JSON.stringify([state.periodo, state.ini, state.fim, state.cal, state.escala]));
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
// "ao vivo" = dado novo vindo do servidor; guardado ou sem conexão não pulsa (indicador "Hoje" e Play)
function semVivo(v) { document.body.classList.toggle('sem-vivo', !!v); }
const mostrarFrescor = () => { if (!emBacklog()) semVivo(state.doCache || state.offline); };
const blFrescor = () => { if (emBacklog()) semVivo(bl.doCache || bl.offline); };

/* ----- alertas dentro do painel (Etapa 16) ----- */
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
function salvarFiltros() { store.set(K.filtros, { periodo: state.periodo, ini: state.ini, fim: state.fim, cal: state.cal, ordem: state.ordem, dir: state.dir, escala: state.escala }); }
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

const NIVEL_EXT = { atencao: 'atenção', obs: 'observação', normal: 'normal', acima: 'acima da meta' };
const NIVEL_SIM = { atencao: '▼', obs: '●', normal: '✔', acima: '▲' };
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
// Selo violeta "Prioridade" (OS que está na aba Prioridades). base = 'pchip' (cartões) ou 'tag' (Backlog)
function seloPrio(base) {
  const s = el('span', base + ' prio selo-prio');
  s.title = 'OS com pedido de prioridade';
  s.innerHTML = ic('star');
  s.appendChild(document.createTextNode('Prioridade'));
  return s;
}
// texto curto do pedido: justificativa, quem pediu e setor
function prioResumo(pr) {
  if (!pr) return '';
  return [pr.jus, pr.sol ? 'pedido por ' + pr.sol : '', pr.set ? '(' + pr.set + ')' : ''].filter(Boolean).join(' · ');
}
function cartaoOS(p, rotulo, extra) {
  const card = el('div', 'pcard' + (extra ? ' ' + extra : '') + (p.prio ? ' prio' : ''));
  // cabeçalho: situação (Em execução / Agendado / Concluído) + empresa + status da OS (igual ao Backlog)
  const hd = el('div', 'pc-head');
  const lv = el('div', 'live'); lv.appendChild(el('i')); lv.appendChild(document.createTextNode(rotulo)); hd.appendChild(lv);
  if (p.emp) { const e = el('span', 'pchip', p.emp); e.title = 'Empresa'; e.style.setProperty('--h', empH(p.emp)); hd.appendChild(e); }
  if (p.status) { const st = el('span', 'pchip', p.status); st.title = 'Status da OS'; st.style.setProperty('--h', hueDe(p.status, ST_H)); hd.appendChild(st); }
  if (p.atr) hd.appendChild(seloAtraso('pchip'));
  if (p.prio) hd.appendChild(seloPrio('pchip'));
  card.appendChild(hd);
  [['Tipo', p.tipo], ['Protocolo', p.protocolo], ['Cliente', p.cliente], ['Cidade', p.cidade], ['Bairro', p.bairro]].concat(p.tecnico ? [['Técnico', tc(p.tecnico)]] : []).forEach(([k, v]) => {
    const f = el('div', 'pf'); f.appendChild(el('span', '', k)); f.appendChild(el('b', '', v || '—')); card.appendChild(f);
  });
  if (p.prio && p.pr) { const f = el('div', 'pf'); f.appendChild(el('span', '', 'Prioridade')); f.appendChild(el('b', '', prioResumo(p.pr) || 'Pedido de prioridade')); card.appendChild(f); }
  return card;
}
function abrirPlay(t) {
  const sup = t.supervisor ? 'Supervisor: ' + tc(t.supervisor) + ' · ' : '';
  const box = $('pLista'); box.innerHTML = '';
  $('pNome').textContent = tc(t.nome);
  const desenhar = (pl, ag) => {
    box.innerHTML = '';
    const nPr = pl.concat(ag).filter(x => x.prio).length, txtPr = nPr ? ' · Prioridades: ' + nPr : '';
    if (t.play === 'play') {
      $('pSub').textContent = sup + 'Em execução: ' + pl.length + ' · Agendadas: ' + ag.length + txtPr;
      pl.forEach(p => box.appendChild(cartaoOS(p, 'Em execução')));
      ag.forEach(p => box.appendChild(cartaoOS(p, 'Agendado', 'ag')));
    } else if (t.play === 'parado') {
      $('pSub').textContent = sup + 'Sem play · ' + ag.length + (ag.length === 1 ? ' agendado' : ' agendados') + txtPr;
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
    const nPr = l.filter(x => x.prio).length;
    $('pSub').textContent = sup + 'Concluídos: ' + n + (l.length < n ? ' (mostrando ' + l.length + ')' : '') + (nPr ? ' · Prioridades: ' + nPr : '');
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

/* ----- filtro de escala / extra (aba Escala_FDS) ----- */
const DIA_SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const rotEsc = iso => { const [y, m, d] = iso.split('-').map(Number); return DIA_SEM[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + ' ' + pad2(d) + '/' + pad2(m); };
function escOpcoes() {
  const w = $('fEscWrap'), sel = $('fEsc'), l = state.dados && state.dados.escalaDatas;
  w.hidden = ehTec() || !Array.isArray(l) || !l.length;
  sel.innerHTML = ''; sel.appendChild(new Option('Todos os técnicos', ''));
  (l || []).forEach(x => sel.appendChild(new Option(rotEsc(x.iso) + (x.escala ? ' · ' + x.nEscala + ' escala' : ' · dia comum') + ' · ' + x.nExtra + ' extra', x.iso)));
  sel.value = state.escala && (l || []).some(x => x.iso === state.escala) ? state.escala : '';
}

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
  const escI = state.escala && state.dados && state.dados.escala ? state.dados.escala : null;
  t.appendChild(el('b', '', escI ? 'Escala de ' + rotEsc(escI.data) + ' · ' + escI.nEscala + ' em escala · ' + escI.nExtra + ' extra' : hoje ? 'Produção de hoje' : 'Filtro: ' + (p === 'cal' && state.dados && state.dados.periodo ? state.dados.periodo.rotulo : (NOME_P[p] || p))));
  const dd = state.dados || {};
  const up = el('span', 'up');
  up.appendChild(document.createTextNode('Atualizado em '));
  up.appendChild(el('em', '', fmtStamp(dd.hojeAtualizadoMs || dd.hojeAtualizado) || dd.atualizado || '--'));
  t.appendChild(up);
  m.appendChild(t);
  if (hoje) { const v = el('span', 'live'); v.innerHTML = ic('refresh') + (idade != null && !isNaN(idade) ? 'há ' + (idade < 1 ? '<1' : idade < 60 ? Math.floor(idade) : Math.floor(idade / 60) + 'h' + String(Math.floor(idade % 60)).padStart(2, '0')) + (idade < 60 ? ' min' : '') : 'Ao vivo'); m.appendChild(v); return; }
  const b = el('button', '', 'Voltar para hoje'); b.type = 'button';
  b.onclick = () => { state.periodo = 'hoje'; state.ini = ''; state.fim = ''; state.escala = ''; salvarFiltros(); carregar(); };
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
    if (papel() === 'controlador') sub += state.user.supervisor ? ' · Equipe ' + tc(state.user.supervisor) : '';
    else if (!ehTec()) {
      if (!state.sups.length) sub += ' · Todas as equipes';
      else if (!mesmoSet(state.sups, supsPadrao())) sub += ' · ' + supResumo(state.sups, d.supervisores);
    }
    $('subtitulo').textContent = sub;
  }

  mostrarModo();
  mostrarFrescor();
  tituloAba();

  if (d.baseVazia) aviso('A aba Encerramentos ainda não tem dados. Importe o relatório de encerrados.', 'info');
  else aviso('');

  const lista = listaVisivel();
  const rows = $('rows'); rows.innerHTML = '';
  if (!lista.length) {
    const filtrado = state.busca || state.sups.length;
    const v = el('div', 'vazio', filtrado ? 'Nenhum técnico encontrado.' : state.escala ? 'Ninguém de escala ou extra nesta data.' : 'Nenhum técnico cadastrado.');
    if (filtrado) { const b = el('button', 'btn vz-btn', 'Limpar busca e filtros'); b.type = 'button'; b.onclick = limparBuscaFiltros; v.appendChild(b); }
    rows.appendChild(v);
  }
  // linhas de equipe só na ordenação por supervisor (a padrão); recolher não altera os KPIs, que somam a lista inteira
  const agrupar = state.ordem === 'sup' && lista.length > 0;
  const temMetaL = lista.some(t => t.metaPer !== undefined);
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
    nb.appendChild(document.createTextNode(tc(t.nome)));
    n.appendChild(nb);
    if (t.escTipo) {                              // filtro de escala: distingue ESCALA de EXTRA
      const eb = el('span', 'esc-bdg ' + t.escTipo, t.escTipo === 'extra' ? 'EXTRA' : 'ESCALA'); eb.title = t.escCod || '';
      n.appendChild(eb);
    }
    if (t.prioPend > 0) {                         // prioridades que ainda estão na agenda do técnico
      const pb = el('span', 'pr-bdg'); pb.innerHTML = ic('star'); pb.appendChild(document.createTextNode(String(t.prioPend)));
      pb.title = t.prioPend + (t.prioPend === 1 ? ' prioridade pendente na agenda' : ' prioridades pendentes na agenda');
      pb.setAttribute('role', 'img'); pb.setAttribute('aria-label', pb.title);
      n.appendChild(pb);
    }
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

  desenharDetalhes(lista, s, nAtivos, temMeta, meta, fmtN, diario);

  $('filtroBtn').classList.toggle('on', state.periodo !== 'hoje' || !mesmoSet(state.sups, supsPadrao()) || state.ordem !== 'sup');
  pintarCabecalho();
}

// quantas metas (0 a 4) o técnico alcançou, pela média por dia produzido (mesma conta do servidor)
const faixaTec = t => t.diasMeta ? t.metasTipo.map(Number).filter(m => (Number(t.media) || 0) + 1e-9 >= m).length : 0;

/* ----- Mais detalhes: visão individual (técnico) e visão da equipe (supervisor / coordenador / controlador) ----- */
// hoje no relógio de Fortaleza, em AAAA-MM-DD
const hojeISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
// o período mostrado ainda pode receber produção (termina hoje ou depois)? usado para "com mais 1 dia trabalhado"
function periodoAberto() {
  if (state.periodo === 'hoje') return true;
  if (state.periodo === 'ontem') return false;
  const f = state.dados && state.dados.periodo && state.dados.periodo.fimBR, m = String(f || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return !!m && (m[3] + '-' + m[2] + '-' + m[1]) >= hojeISO();
}
const plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);
// o que falta para a próxima meta do técnico: { f: faixa atual (0 a 4), prox: 'Meta X' | null, falta, alvo, ant, mais1 (concluídos necessários em mais 1 dia) }
function proximaMeta(t) {
  const conc = Number(t.concl) || 0, dias = Math.max(1, t.diasMeta || 0);
  if (Array.isArray(t.metasTipo) && t.metasTipo.length) {
    const metas = t.metasTipo.map(Number), f = faixaTec(t);
    const r = { f: f, tipo: true, metas: metas, dias: dias, prox: null };
    if (f < metas.length) {
      r.prox = 'Meta ' + ROMANOS[f]; r.alvo = metas[f] * dias; r.ant = f ? metas[f - 1] * dias : 0;
      r.falta = Math.max(0, Math.ceil(r.alvo - conc - 1e-9));
      r.mais1 = Math.max(0, Math.ceil(metas[f] * (dias + 1) - conc - 1e-9));
    }
    return r;
  }
  if (t.metaPer !== undefined && t.metaRef) {     // sem Tipo na aba Metas: só a meta padrão
    const falta = Math.max(0, Math.ceil(t.metaPer - conc - 1e-9));
    return { f: falta ? 0 : 1, tipo: false, prox: falta ? 'Meta padrão' : null, alvo: t.metaPer, ant: 0, falta: falta, mais1: Math.max(0, Math.ceil(t.metaRef * (dias + 1) - conc - 1e-9)), dias: dias };
  }
  return null;
}
function desenharDetalhes(lista, s, nAtivos, temMeta, meta, fmtN, diario) {
  const dg = $('dgrid'); dg.innerHTML = ''; dg.className = 'dx';
  const d = state.dados || {};
  const sec = (titulo, cls) => { const b = el('section', 'dx-sec' + (cls ? ' ' + cls : '')); b.appendChild(el('h4', '', titulo)); dg.appendChild(b); return b; };
  const grade = b => { const g = el('div', 'dx-tiles'); b.appendChild(g); return g; };
  const tile = (g, rot, val, sub, cls) => {
    const x = el('div', 'dx-t' + (cls ? ' ' + cls : ''));
    x.appendChild(el('span', 'dx-l', rot)); x.appendChild(el('b', 'dx-v', String(val)));
    if (sub) x.appendChild(el('small', 'dx-s', sub));
    g.appendChild(x); return x;
  };
  const sinal = n => (n > 0 ? '+' : '') + fmtN(n);
  const rotPer = d.periodo && d.periodo.rotulo ? d.periodo.rotulo : '';
  const frT = fracExpediente();
  const gapCls = g => g > 0 ? 'ok' : g < 0 ? 'bad' : '';

  if (!lista.length) { dg.appendChild(el('p', 'dx-vazio', 'Sem dados para detalhar neste filtro.')); return; }

  /* ================= TÉCNICO: só os números dele ================= */
  if (ehTec()) {
    const t = lista[0], conc = Number(t.concl) || 0, dias = t.dias || [];
    const diasProd = t.diasProd !== undefined ? t.diasProd : dias.length;
    const media = t.media !== undefined ? Number(t.media) || 0 : (diasProd ? conc / diasProd : 0);
    const pm = proximaMeta(t);

    // 1) quanto produziu
    const a = sec('Sua produção' + (rotPer ? ' · ' + rotPer : '')), ga = grade(a);
    tile(ga, 'Dias produzidos', diasProd, diasProd ? (state.periodo === 'hoje' ? 'hoje' : (diasProd === 1 ? 'dia com concluídos' : 'dias com concluídos')) : 'nenhum dia ainda');
    tile(ga, 'Concluídos', conc, t.metaPer !== undefined ? 'meta do período: ' + fmtN(t.metaPer) : '', 'forte');
    tile(ga, 'Média por dia trabalhado', fmtN(media), t.metaRef ? 'meta diária: ' + fmtN(t.metaRef) : (diasProd ? conc + ' em ' + plural(diasProd, 'dia', 'dias') : ''));
    if (t.gap !== undefined) tile(ga, 'Gap do período', sinal(t.gap), t.gap > 0 ? 'acima da meta' : t.gap < 0 ? 'faltam ' + fmtN(-t.gap) + ' para a meta' : 'na meta', gapCls(t.gap));
    if (frT) {
      const pj = conc / frT;
      tile(ga, 'Projeção do dia', fmtProj(pj), 'estimativa linear pelo ritmo de hoje');
    }
    const melhor = dias.length ? dias.reduce((m, x) => x.concl > m.concl ? x : m, dias[0]) : null;
    if (melhor && dias.length > 1) tile(ga, 'Melhor dia', melhor.concl, melhor.d + (melhor.faixa > 0 ? ' · Meta ' + ROMANOS[melhor.faixa - 1] : ''));

    // 2) próxima meta
    if (pm) {
      const b = sec('Próxima meta', 'dx-prox'), c = el('div', 'dx-card ' + (pm.prox ? '' : 'ok'));
      if (!pm.prox) {
        c.appendChild(el('b', 'dx-big', '🏆 ' + (pm.tipo ? 'Todas as metas atingidas' : 'Meta do período atingida')));
        c.appendChild(el('p', 'dx-p', pm.tipo ? 'Você está na Meta ' + ROMANOS[pm.f - 1] + ' com ' + fmtN(media) + ' por dia trabalhado.' : 'Você já passou da meta do período (' + fmtN(t.metaPer) + ').'));
      } else {
        const atual = pm.f ? (pm.tipo ? 'Meta ' + ROMANOS[pm.f - 1] : '') : 'Abaixo da Meta I';
        c.appendChild(el('b', 'dx-big', pm.falta === 0 ? '✔ ' + pm.prox + ' atingida' : 'Faltam ' + plural(pm.falta, 'concluída', 'concluídas') + ' para a ' + pm.prox));
        const pct = pm.alvo > pm.ant ? Math.max(0, Math.min(100, (conc - pm.ant) / (pm.alvo - pm.ant) * 100)) : 100;
        const bar = el('div', 'dx-bar'); bar.setAttribute('role', 'img');
        bar.setAttribute('aria-label', conc + ' de ' + fmtN(pm.alvo) + ' concluídos para a ' + pm.prox + ' (' + Math.round(pct) + '%)');
        const fi = el('i', 'dx-fill'); fi.style.width = pct.toFixed(1) + '%'; bar.appendChild(fi); c.appendChild(bar);
        const lg = el('div', 'dx-barlg'); lg.appendChild(el('span', '', atual ? 'Agora: ' + atual : 'Agora: ' + conc)); lg.appendChild(el('span', '', conc + ' / ' + fmtN(pm.alvo))); c.appendChild(lg);
        const ls = el('ul', 'dx-ul');
        ls.appendChild(el('li', '', pm.tipo ? 'A ' + pm.prox + ' é ' + fmtN(pm.metas[pm.f]) + ' por dia trabalhado' + (pm.dias > 1 ? ' (' + fmtN(pm.alvo) + ' nos ' + pm.dias + ' dias)' : '') + '.' : 'Meta diária ' + fmtN(t.metaRef) + (pm.dias > 1 ? ' × ' + pm.dias + ' dias = ' + fmtN(pm.alvo) : '') + '.'));
        if (pm.falta > 0 && state.periodo !== 'hoje' && periodoAberto()) ls.appendChild(el('li', '', 'Trabalhando mais 1 dia, você precisa fazer ' + plural(pm.mais1, 'concluída', 'concluídas') + ' nele para fechar a ' + pm.prox + '.'));
        if (pm.falta > 0 && frT) {
          const pj = conc / frT;
          ls.appendChild(el('li', '', pj + 1e-9 >= pm.alvo ? 'No ritmo de hoje (projeção ' + fmtProj(pj) + ') você alcança a ' + pm.prox + '.' : 'No ritmo de hoje (projeção ' + fmtProj(pj) + ') ainda faltariam ' + fmtN(Math.max(0, Math.ceil(pm.alvo - pj - 1e-9))) + '.'));
        }
        if (pm.falta > 0 && state.periodo === 'hoje' && t.play !== 'na' && (t.agenda || 0) > 0) ls.appendChild(el('li', '', 'Você tem ' + plural(t.agenda, 'OS aberta', 'OS abertas') + ' na agenda' + (t.agenda >= pm.falta ? ': dá para chegar lá.' : ', menos do que o necessário.')));
        c.appendChild(ls);
      }
      b.appendChild(c);
    }

    // 3) escada de metas (barra e quanto falta em cada uma)
    const bm = blocoMetas(t); if (bm) { const b = sec('Todas as metas', 'dx-metas'); bm.removeChild(bm.firstChild); b.appendChild(bm); }

    // 4) regularidade: em que faixa foi cada dia
    if (dias.length > 1) {
      const b = sec('Regularidade nos dias trabalhados'), g = grade(b);
      if (dias.some(x => x.faixa !== null && x.faixa !== undefined)) {
        const cont = [0, 0, 0, 0, 0]; dias.forEach(x => { cont[Math.min(4, Math.max(0, x.faixa || 0))]++; });
        const bateu = dias.length - cont[0];
        tile(g, 'Dias na Meta I ou mais', bateu + ' de ' + dias.length, Math.round(bateu / dias.length * 100) + '% dos dias', bateu === dias.length ? 'ok' : '');
        const ch = el('div', 'dx-chips');
        ['Abaixo da Meta I', 'Meta I', 'Meta II', 'Meta III', 'Meta IV'].forEach((n, i) => { if (cont[i]) ch.appendChild(el('span', 'dx-chip f' + i, n + ': ' + plural(cont[i], 'dia', 'dias'))); });
        b.appendChild(ch);
      }
      const menor = dias.reduce((m, x) => x.concl < m.concl ? x : m, dias[0]);
      tile(g, 'Pior dia', menor.concl, menor.d);
    }

    // 5) o que produziu (tipos de OS)
    const p = sec('Tipos de OS'), gp = grade(p);
    [['Instalação', t.inst], ['Reab. Inst.', t.reabInst], ['Prest. de contas', t.outros], ['Reab. prest. contas', t.reabOutros], ['Cancelados', t.cancel]].forEach(([k, v]) => tile(gp, k, v || 0, '', v ? '' : 'zero'));
    tile(gp, 'Concluídos em atraso (SLA)', t.atraso || 0, '', t.atraso ? 'bad' : 'zero');

    // 6) agenda e prioridades
    const ag = sec('Agenda'), gg = grade(ag);
    const sit = { play: 'Em play agora', parado: 'Agendado, sem play', fim: 'Agenda concluída', vazio: 'Sem agenda e sem conclusão', na: '-' }[t.play] || '-';
    tile(gg, 'Situação', sit, t.play === 'play' ? plural(nPlay(t), 'OS em execução', 'OS em execução') : '');
    if (t.play !== 'na') {
      tile(gg, 'OS abertas na agenda', t.agenda || 0);
      if (t.playAtr !== undefined) tile(gg, 'Atrasadas (em play / fora)', (t.playAtr || 0) + ' / ' + (t.agendaAtr || 0), '', (t.playAtr || t.agendaAtr) ? 'bad' : 'zero');
    }
    if (d.prioOk) { tile(gg, 'Prioridades pendentes', t.prioPend || 0, 'na sua agenda', t.prioPend ? 'warn' : 'zero'); tile(gg, 'Prioridades atendidas', t.prioAtend || 0, 'no período'); }
    if (t.escTipo) tile(gg, 'Escala', t.escTipo === 'extra' ? 'Extra' : 'Escala', t.escCod || '');
    return;
  }

  /* ================= SUPERVISOR / COORDENADOR / CONTROLADOR: a equipe ================= */
  const ativos = lista.filter(t => t.ativo !== false);
  const diasTot = lista.reduce((a, t) => a + (t.diasMeta || 0), 0);               // dias-técnico trabalhados
  const mediaDia = diasTot ? s.concl / diasTot : 0;
  const gapTot = Math.round((s.concl - meta) * 100) / 100;

  // 1) resultado da equipe
  const a = sec('Resultado da equipe' + (rotPer ? ' · ' + rotPer : '')), ga = grade(a);
  tile(ga, 'Concluídos', s.concl, 'meta do período: ' + fmtN(meta), 'forte');
  if ((diario || temMeta) && meta) {
    tile(ga, 'Gap do período', sinal(gapTot), gapTot >= 0 ? 'meta batida (' + Math.round(s.concl / meta * 100) + '%)' : Math.round(s.concl / meta * 100) + '% da meta · faltam ' + fmtN(-gapTot), gapCls(gapTot));
  }
  tile(ga, 'Técnicos ativos', nAtivos + ' / ' + lista.length, lista.length - nAtivos ? plural(lista.length - nAtivos, 'inativo', 'inativos') + ' no filtro' : 'todos ativos');
  tile(ga, 'Média por técnico ativo', nAtivos ? fmtN(s.concl / nAtivos) : '0', 'concluídos ÷ técnicos ativos');
  if (diasTot && diasTot !== nAtivos) tile(ga, 'Média por dia trabalhado', fmtN(mediaDia), plural(diasTot, 'dia-técnico', 'dias-técnico') + ' no período');
  if (frT) tile(ga, 'Projeção do dia', fmtProj(s.concl / frT), 'estimativa linear' + (meta ? ' · meta ' + fmtN(meta) : ''));

  // 2) distribuição por meta
  if (temMeta) {
    const niv = [0, 0, 0, 0, 0]; let semMeta = 0;
    ativos.forEach(t => { if (Array.isArray(t.metasTipo)) niv[faixaTec(t)]++; else semMeta++; });
    const tot = niv.reduce((x, y) => x + y, 0), b = sec('Técnicos por meta');
    if (tot) {
      const bar = el('div', 'dx-stack'); bar.setAttribute('role', 'img');
      const nomes = ['Abaixo da Meta I', 'Meta I', 'Meta II', 'Meta III', 'Meta IV'];
      bar.setAttribute('aria-label', nomes.map((n, i) => n + ': ' + niv[i]).join(', '));
      niv.forEach((n, i) => { if (n) { const sg = el('i', 'f' + i); sg.style.flexGrow = n; sg.title = nomes[i] + ': ' + n; bar.appendChild(sg); } });
      b.appendChild(bar);
    }
    const g = grade(b);
    [['Abaixo da Meta I', 0], ['Meta I', 1], ['Meta II', 2], ['Meta III', 3], ['Meta IV', 4]].forEach(([n, i]) => tile(g, n, niv[i], tot ? Math.round(niv[i] / tot * 100) + '% dos ativos' : '', 'f' + i + (niv[i] ? '' : ' zero')));
    if (semMeta) tile(g, 'Sem meta definida (Tipo)', semMeta, 'usam a meta padrão');
  }
  const bn = sec('Situação do dia'), gn = grade(bn);
  [['Em atenção', s.atencao, 'bad'], ['Em observação', s.obs, 'warn'], ['Normal', s.normal, 'ok'], ['Acima', s.acima, 'acc']].forEach(([k, v, c]) => tile(gn, k, v, '', v ? c : 'zero'));

  // 3) quem precisa de atenção: perto da próxima meta e parados
  const prox = ativos.map(t => ({ t: t, pm: proximaMeta(t) })).filter(x => x.pm && x.pm.prox && x.pm.falta > 0);
  const lstLinha = (box, x, txt) => {
    const b = el('button', 'dx-li'); b.type = 'button';
    b.appendChild(el('span', 'dx-nm', tc(x.t.nome))); b.appendChild(el('b', '', txt));
    b.addEventListener('click', () => abrirTecnico(x.t, b)); box.appendChild(b);
  };
  const perto = prox.slice().sort((x, y) => x.pm.falta - y.pm.falta || (y.t.concl - x.t.concl)).slice(0, 5);
  if (perto.length) {
    const b = sec('Mais perto da próxima meta'), ls = el('div', 'dx-list'); b.appendChild(ls);
    perto.forEach(x => lstLinha(ls, x, 'faltam ' + x.pm.falta + ' p/ ' + x.pm.prox));
  }
  const baixo = prox.filter(x => x.pm.f === 0 && (x.t.diasMeta || 0) > 0).sort((x, y) => y.pm.falta - x.pm.falta).slice(0, 5);
  if (baixo.length) {
    const b = sec('Abaixo da Meta I · maior distância'), ls = el('div', 'dx-list'); b.appendChild(ls);
    baixo.forEach(x => lstLinha(ls, x, x.t.concl + ' feitas · faltam ' + x.pm.falta));
  }
  const paradosL = lista.filter(t => t.play === 'vazio');
  if (paradosL.length) {
    const b = sec('Sem agenda e sem conclusão'), ls = el('div', 'dx-list'); b.appendChild(ls);
    paradosL.slice(0, 8).forEach(t => lstLinha(ls, { t: t }, 'sem produção'));
    if (paradosL.length > 8) b.appendChild(el('p', 'dx-mais', '+ ' + (paradosL.length - 8) + ' técnicos'));
  }

  // 4) operação: play e agenda
  const bo = sec('Play e agenda'), go = grade(bo);
  tile(go, 'Em play agora', lista.filter(t => t.play === 'play').length, 'técnicos executando');
  tile(go, 'Agendados sem play', lista.filter(t => t.play === 'parado').length);
  tile(go, 'Agenda concluída', lista.filter(t => t.play === 'fim').length);
  tile(go, 'Sem agenda e sem conclusão', paradosL.length, '', paradosL.length ? 'warn' : 'zero');
  tile(go, 'Em atraso (SLA)', s.atraso, 'concluídos fora do prazo', s.atraso ? 'bad' : 'zero');

  // 5) produção por tipo
  const bp = sec('Produção por tipo'), gp = grade(bp);
  [['Instalação', s.inst], ['Reab. Inst.', s.reabI], ['Prest. de contas', s.outros], ['Reab. prest. contas', s.reabO], ['Cancelados', s.canc]].forEach(([k, v]) => tile(gp, k, v, '', v ? '' : 'zero'));

  // 6) prioridades e escala
  if (d.prioOk) {
    const bq = sec('Prioridades'), gq = grade(bq);
    tile(gq, 'Pendentes (agenda)', lista.reduce((x, t) => x + (t.prioPend || 0), 0));
    tile(gq, 'Atendidas (período)', lista.reduce((x, t) => x + (t.prioAtend || 0), 0));
    const porDia = {}; lista.forEach(t => (t.dias || []).forEach(x => { if (x.prio) porDia[x.iso] = (porDia[x.iso] || 0) + x.prio; }));
    const ks = Object.keys(porDia).sort().slice(-7);
    if (ks.length > 1) bq.appendChild(el('p', 'dx-p', 'Atendidas por dia: ' + ks.map(k => k.slice(8, 10) + '/' + k.slice(5, 7) + ': ' + porDia[k]).join(' · ')));
  }
  if (d.escala && d.escala.ok) {
    const be = sec('Escala · ' + rotEsc(d.escala.data)), ge = grade(be);
    tile(ge, 'Em escala', lista.filter(t => t.escTipo === 'escala').length); tile(ge, 'Em extra', lista.filter(t => t.escTipo === 'extra').length);
  }
}

/* ----- projeção do dia (Etapa 13) ----- */
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
// Bloco "Metas": mostra TODAS as metas (atingidas ou não), quanto falta para cada uma e a barra de progresso
function blocoMetas(t) {
  const d = state.dados || {}, w = el('div', 'mt'), conc = Number(t.concl) || 0;
  w.appendChild(el('h3', '', 'Metas'));
  const diario = state.periodo === 'hoje' || state.periodo === 'ontem' || !!(d.periodo && d.periodo.ini && d.periodo.ini === d.periodo.fim);
  let alvos = [];                                 // [{ n: nome, v: texto da meta, alvo: concluídos necessários }]
  let resumo = '';
  if (Array.isArray(t.metasTipo) && t.metasTipo.length) {
    const metas = t.metasTipo.map(Number), dias = Math.max(1, t.diasMeta || 0), media = Number(t.media) || 0;
    metas.forEach((m, i) => alvos.push({ n: 'Meta ' + (ROMANOS[i] || i + 1), v: fmtN2(m) + '/dia' + (dias > 1 ? ' · ' + fmtN2(m * dias) + ' no período' : ''), alvo: m * dias }));
    const f = faixaTec(t);
    resumo = 'Faixa atual: ' + (f ? 'Meta ' + ROMANOS[f - 1] : 'abaixo da Meta I') + ' · Média por dia produzido: ' + fmtN2(media) +
      (f < metas.length ? ' · Próxima: Meta ' + ROMANOS[f] + ' (faltam ' + Math.max(0, Math.ceil(metas[f] * dias - conc - 1e-9)) + ')' : ' · Todas as metas atingidas');
  } else if (diario) {                            // sem Tipo / meta: regra de cores do dia
    alvos = [{ n: 'Observação', v: '3 concluídas', alvo: 3 }, { n: 'Normal', v: '4 concluídas', alvo: 4 }, { n: 'Acima', v: '6 concluídas', alvo: 6 }];
    resumo = 'Sem Tipo na aba Metas: vale a régua do dia (até 2 atenção · 3 observação · 4 e 5 normal · acima de 5 acima)';
  } else if (d.metas) {
    alvos = [{ n: 'Observação', v: fmtN2(Number(d.metas.obs) || 0) + ' no período', alvo: Number(d.metas.obs) || 0 }, { n: 'Normal', v: fmtN2(Number(d.metas.normal) || 0) + ' no período', alvo: Number(d.metas.normal) || 0 }];
    resumo = 'Sem Tipo na aba Metas: vale a meta Normal / Observação do período (aba Config)';
  }
  if (!alvos.length) return null;
  // barra: preenchimento = concluídos; marcas = cada meta
  const topo = Math.max(conc, alvos[alvos.length - 1].alvo) * 1.08 || 1;
  const bar = el('div', 'mt-bar'); bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', conc + ' concluídos. ' + alvos.map(a => a.n + ': ' + fmtN2(a.alvo)).join(', ') + '.');
  const fill = el('i', 'mt-fill ' + (t.nivel || '')); fill.style.width = Math.min(100, conc / topo * 100).toFixed(1) + '%'; bar.appendChild(fill);
  alvos.forEach((a, i) => { const k = el('u', 'mt-tick'); k.style.left = Math.min(100, a.alvo / topo * 100).toFixed(1) + '%'; k.title = a.n + ': ' + fmtN2(a.alvo); k.appendChild(el('s', '', alvos.length === 4 ? ROMANOS[i] : a.n.slice(0, 3))); bar.appendChild(k); });
  w.appendChild(bar);
  w.appendChild(el('p', 'mt-res', resumo));
  alvos.forEach(a => {
    const falta = Math.max(0, Math.ceil(a.alvo - conc - 1e-9)), r = el('div', 'mt-row' + (falta === 0 ? ' ok' : ''));
    r.appendChild(el('span', 'mt-n', a.n)); r.appendChild(el('span', 'mt-v', a.v));
    r.appendChild(el('b', 'mt-s', falta === 0 ? '✔ Atingida' : 'Faltam ' + falta));
    w.appendChild(r);
  });
  return w;
}
function abrirTecnico(t, opener) {
  $('tNome').textContent = tc(t.nome);
  $('tSup').textContent = t.supervisor ? 'Supervisor: ' + tc(t.supervisor) : '';
  const ch = $('tChip');
  ch.className = 'chip ' + t.nivel;
  ch.textContent = t.nivel === 'acima' ? 'Acima' : t.nivel === 'normal' ? 'Normal' : t.nivel === 'obs' ? 'Observação' : 'Atenção';
  const dl = $('tDet'); dl.innerHTML = '';
  if (t.escTipo) { dl.appendChild(el('dt', '', 'Escala')); dl.appendChild(el('dd', '', (t.escTipo === 'extra' ? 'Extra' : 'Escala') + (t.escCod ? ' (' + t.escCod + ')' : ''))); }
  [['Concluídos', t.concl], ['Instalação', t.inst], ['Pendência', t.pend], ['Prest. de contas', t.outros],
   ['Reab. Instalação', t.reabInst], ['Reab. Pendência', t.reabPend], ['Reab. prest. contas', t.reabOutros],
   ['Cancelados', t.cancel], ['Concluídos em atraso', t.atraso],
   ['Na agenda (abertos)', t.play === 'na' ? '-' : (t.agenda || 0)]]
    .forEach(([k, v]) => { dl.appendChild(el('dt', '', k)); dl.appendChild(el('dd', '', String(v))); });
  if (t.play !== 'na') {                          // detalhe da agenda: play, atrasadas e prioridades
    const extra = [['Em play agora', nPlay(t)]];
    if (t.playAtr !== undefined) extra.push(['Atrasadas na agenda (em play / fora do play)', (t.playAtr || 0) + ' / ' + (t.agendaAtr || 0)]);
    if (state.dados && state.dados.prioOk) extra.push(['Prioridades pendentes na agenda', t.prioPend || 0], ['Prioridades atendidas (período)', t.prioAtend || 0]);
    extra.forEach(([k, v]) => { dl.appendChild(el('dt', '', k)); dl.appendChild(el('dd', '', String(v))); });
  }
  const fr = fracExpediente();
  if (fr) { dl.appendChild(el('dt', '', 'Projeção')); dl.appendChild(el('dd', '', fmtProj((Number(t.concl) || 0) / fr) + ' (estimativa linear)')); }
  const fN = n => (Math.round(n * 100) / 100).toString().replace('.', ',');
  const bx = $('tDias'); bx.innerHTML = '';
  const bm = blocoMetas(t); if (bm) bx.appendChild(bm);
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
        r.appendChild(el('b', '', x.concl + (x.concl === 1 ? ' concluída' : ' concluídas') + (x.prio ? ' · ★ ' + x.prio + (x.prio === 1 ? ' prioridade' : ' prioridades') : '')));
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
  if (gr) bx.insertBefore(gr, bm ? bm.nextSibling : bx.firstChild);
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
  $('fSupWrap').hidden = ehTec() || papel() === 'controlador';   // controlador só tem a equipe dele
  fSupSel = new Set(state.sups); mselDesenhar($('fSupBox'), listaSups(), fSupSel);
  escOpcoes();
  $('fOrd').value = state.ordem;
  abrirDlg($('dlgFiltro'));
}
$('filtroBtn').onclick = abrirFiltro;
$('fFechar').onclick = () => $('dlgFiltro').close();
$('fPeriodo').onchange = () => { $('fCustom').hidden = $('fPeriodo').value !== 'custom'; if ($('fPeriodo').value === 'cal' && !cal.aberto) { cal.aberto = true; calDesenhar(); } };
$('fLimpar').onclick = () => {
  $('fPeriodo').value = 'hoje'; $('fOrd').value = 'sup'; $('fEsc').value = '';
  fSupSel = new Set(supsPadrao()); mselDesenhar($('fSupBox'), listaSups(), fSupSel);
  $('fCustom').hidden = true; $('fIni').value = ''; $('fFim').value = '';
  cal.dias.clear(); cal.meses.clear(); cal.aberto = false; calDesenhar();
};
$('fForm').addEventListener('submit', () => {
  const sig = () => state.periodo + state.ini + state.fim + state.escala + (state.periodo === 'cal' ? JSON.stringify(state.cal) : '');
  const antes = sig(), perAntes = state.periodo, escAntes = state.escala;
  state.periodo = $('fPeriodo').value;
  state.ini = $('fIni').value; state.fim = $('fFim').value;
  if (state.periodo === 'custom' && (!state.ini || !state.fim)) state.periodo = 'hoje';
  state.cal = calSerial();
  if (state.periodo === 'cal' && calVazio()) state.periodo = 'hoje';
  // escala: escolher uma data leva a produção para esse dia; mudar só o período (com a mesma data) sai do filtro
  const esc = $('fEsc').value;
  if (esc && !(esc === escAntes && state.periodo !== perAntes)) {
    state.escala = esc; state.periodo = esc === dataHoje() ? 'hoje' : 'cal'; state.cal = { dias: esc === dataHoje() ? [] : [esc], meses: [] }; state.ini = state.fim = '';
  } else state.escala = '';
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
let lembrar = false;   // caixa "Manter conectado"
function loginMsg(msg, tipo) { const m = $('lgMsg'); m.className = 'ln-msg' + (tipo ? ' ' + tipo : ''); m.textContent = msg || ''; }
function loginAtualizar() {
  $('lgKeep').checked = lembrar;
  $('lgBtn').disabled = !($('lgUser').value.trim() && $('lgPass').value);
}
function loginPreencher() {
  const c = store.get(K.cred, null);
  $('lgUser').value = c ? c.login : ''; $('lgPass').value = c ? c.senha : '';
  lembrar = !!(c && c.login && c.senha);
  loginAtualizar();
}
['lgUser', 'lgPass'].forEach(id => $(id).addEventListener('input', loginAtualizar));
$('lgKeep').onchange = () => {                    // "Manter conectado": guarda login e senha neste aparelho
  if ($('lgKeep').checked) {
    lembrar = true;
    const login = $('lgUser').value.trim(), senha = $('lgPass').value;
    if (login && senha) { store.set(K.cred, { login, senha }); store.set(K.auto, true); loginMsg('Credenciais salvas neste aparelho.', 'ok'); }
  } else { lembrar = false; store.del(K.cred); loginMsg('Credenciais removidas deste aparelho.'); }
  loginAtualizar();
};
$('lgForgot').onclick = () => {                  // senha ou usuário: só o supervisor responsável redefine
  const h = $('lgHelp'), abrir = h.hidden;
  h.hidden = !abrir; $('lgForgot').setAttribute('aria-expanded', String(abrir));
};
$('lgEye').onclick = () => {
  const p = $('lgPass'), ver = p.type === 'password';
  p.type = ver ? 'text' : 'password';
  $('lgEye').classList.toggle('on', ver);
  $('lgEye').querySelector('use').setAttribute('href', ver ? '#i-eyeoff' : '#i-eye');
  $('lgEye').setAttribute('aria-label', ver ? 'Ocultar senha' : 'Mostrar senha');
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
    sess.token = j.token || '';
    entrar({ login: login, senha: senha }, j.usuario);
  } catch (err) {
    const abortou = err && err.name === 'AbortError';
    loginMsg(abortou ? 'A conexão demorou demais. Tente de novo.' : (err && err.message && err.message !== 'Failed to fetch' ? err.message : 'Não foi possível conectar. Tente de novo.'), 'erro');
  } finally { loginAtualizar(); }
});
function sair(msg) {
  if (sess.token) { try { fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ acao: 'logout', token: sess.token }), keepalive: true, cache: 'no-store' }).catch(() => {}); } catch (_) {} sess.token = ''; }   // encerra o token no servidor
  cf.aba = ''; Object.keys(cfc).forEach(k => delete cfc[k]); cfp.dados = null; cfp.busca = ''; ev.arq = null; ev.id = '';
  if (state.cred && !msg) { try { fetch(SCRIPT_URL + '?' + new URLSearchParams({ acao: 'sair', login: state.cred.login, senha: state.cred.senha, codigo: state.codigo || '' }).toString(), { keepalive: true, cache: 'no-store' }).catch(() => {}); } catch (_) {} }   // marca offline na hora
  if (state.cred) lcLimpa(state.cred.login);          // apaga os dados guardados deste usuário neste aparelho
  state.dadosEm = 0; state.doCache = false; state.dadosSig = ''; bl.dadosEm = 0; bl.doCache = false; mostrarFrescor(); blFrescor();
  try { sessionStorage.removeItem(K.sess); } catch (_) {}
  store.set(K.auto, false);            // não entra sozinho de novo; se houver credenciais salvas, elas voltam preenchidas
  state.cred = null; state.user = null; state.dados = null; state.sups = [];
  state.busca = ''; $('busca').value = ''; $('rows').innerHTML = ''; aviso('');
  bl.dados = null; bl.itens = []; bl.f = {}; bl.busca = '';
  ['v-blk', 'v-cfg', 'p-tec', 'p-sup', 'p-coord'].forEach(c => document.body.classList.remove(c));
  store.set(K.view, '');
  document.body.classList.add('sem-login');
  loginPreencher();
  if (msg) loginMsg(msg, 'erro');
  window.scrollTo(0, 0);
}
$('sairBtn').onclick = () => sair();
$('bSairBtn').onclick = () => sair();


/* ============ ACESSOS: quem está logado (supervisor e coordenador) e batimento de presença ============ */
// a cada 90 s, com a página visível, avisa o servidor que o usuário continua com a tela aberta
function batimento() {
  if (!state.cred || document.hidden || document.body.classList.contains('sem-login')) return;
  pedir(SCRIPT_URL + '?' + qAuth(new URLSearchParams({ acao: 'ping' })).toString(), 15000).catch(() => {});
}
setInterval(batimento, 90000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) batimento(); });
const ac = { filtro: 'todos', dados: null, timer: null };
function acQuando(ms, agora) {
  const m = Math.max(0, (agora - ms) / 60000);
  const p = {}; new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
  return 'há ' + fmtIdade(m) + ' · ' + p.day + '/' + p.month + ' ' + p.hour + ':' + p.minute;
}
function acDesenhar() {
  const d = ac.dados, box = $('acLista'); if (!d) return;
  const l = d.itens.slice().sort((a, b) => (b.online - a.online) || ((b.ultimo || 0) - (a.ultimo || 0)) || a.nome.localeCompare(b.nome, 'pt-BR'));
  const on = l.filter(x => x.online).length;
  $('acSub').textContent = on + ' online agora · ' + l.length + ' com login · atualiza sozinho a cada 30 s';
  const defs = [['todos', 'Todos', l.length], ['on', 'Online', on], ['off', 'Offline', l.length - on], ['tecnico', 'Técnicos', l.filter(x => x.papel === 'tecnico').length], ['controlador', 'Controladores', l.filter(x => x.papel === 'controlador').length]];
  const cb = $('acChips'); cb.innerHTML = '';
  defs.forEach(([k, n, c]) => {
    const b = el('button', 'chp' + (ac.filtro === k ? ' on' : '')); b.type = 'button'; b.setAttribute('aria-pressed', String(ac.filtro === k));
    b.appendChild(document.createTextNode(n)); b.appendChild(el('b', '', String(c))); b.onclick = () => { ac.filtro = k; acDesenhar(); }; cb.appendChild(b);
  });
  const f = l.filter(x => ac.filtro === 'todos' || (ac.filtro === 'on' ? x.online : ac.filtro === 'off' ? !x.online : x.papel === ac.filtro));
  box.innerHTML = '';
  if (!f.length) { const v = el('div', 'pvazio'); v.innerHTML = ic('users'); v.appendChild(el('b', '', 'Ninguém neste filtro')); box.appendChild(v); return; }
  f.forEach(x => {
    const r = el('div', 'acrow' + (x.online ? ' on' : ''));
    r.appendChild(el('i', 'acdot'));
    const t = el('div', 'actxt'); t.appendChild(el('b', '', tc(x.nome)));
    t.appendChild(el('span', '', (x.papel === 'controlador' ? 'Controlador' : 'Técnico') + (x.equipe ? ' · Equipe ' + tc(x.equipe) : '')));
    r.appendChild(t);
    const q = el('span', 'acq', x.online ? 'Online agora' : x.ultimo ? 'Último acesso ' + acQuando(x.ultimo, d.agoraMs) : 'Nunca acessou');
    r.appendChild(q); box.appendChild(r);
  });
}
async function acCarregar() {
  try { ac.dados = await buscarServidor(qAuth(new URLSearchParams({ acao: 'acessos' })), 20000); acDesenhar(); }
  catch (e) { if (!ac.dados) { $('acLista').innerHTML = ''; $('acLista').appendChild(el('div', 'perro', msgErro(e))); } }
}
$('acessBtn').onclick = () => {
  ac.filtro = 'todos'; ac.dados = null; $('acLista').innerHTML = ''; $('acSub').textContent = 'Carregando...';
  abrirDlg($('dlgAcess')); acCarregar();
  clearInterval(ac.timer); ac.timer = setInterval(() => { if ($('dlgAcess').open) acCarregar(); else clearInterval(ac.timer); }, 30000);
};
$('bAcessBtn').onclick = () => $('acessBtn').click();
$('acFechar').onclick = () => $('dlgAcess').close();

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
const SIT_N = { atraso: 'Em atraso', atrplay: 'Atrasadas em play', atrfora: 'Atrasadas fora do play', prio: 'Prioridades', play: 'Em play', fila: 'Sem técnico', venc4: 'Vencem em 4h' };
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
  sit: (x, v) => v === 'atraso' ? !!x.atr : v === 'atrplay' ? !!x.atr && !!x.play : v === 'atrfora' ? !!x.atr && !x.play : v === 'prio' ? !!x.prio : v === 'play' ? !!x.play : v === 'fila' ? !!x.fila : v === 'venc4' ? vence4(x) : true
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
  $('bFiltBtn').classList.toggle('on', !!bl.f.sup); $('bMenuBtn').classList.toggle('on', !!bl.f.sup);
  blSalvar();
  blEmps(); blKpis(); blPrio(); blChips(); blStrip();
  blTipo(); blStatus(); blAging(); blCidades(); blTecnicos(); blMatriz(); blLista(); blModo();
  tituloAba(); botaoNotif(); notificarVencimentos();
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
    ['atrplay', 'Atrasadas em play', 'play', l.filter(x => x.atr && x.play).length],
    ['atrfora', 'Atrasadas fora do play', 'stop', l.filter(x => x.atr && !x.play).length]]
    .concat(bl.dados && bl.dados.prioOk ? [['prio', 'Prioridades', 'star', l.filter(x => x.prio).length]] : [])
    .concat([['play', 'Em play', 'play', l.filter(x => x.play).length], ['fila', 'Sem técnico', 'queue', l.filter(x => x.fila).length],
    ['venc4', 'Vencem em 4h:', 'clock', l.filter(vence4).length]]);
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
  const r = el('div', 'os ' + s + (x.prio ? ' prio' : '')); r.tabIndex = 0; r.setAttribute('role', 'button');
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
  if (x.prio) bot.appendChild(seloPrio('tag'));
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
  if (x.prio) ch.appendChild(seloPrio('tag'));
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
  const pb = $('oPrioBox'); pb.hidden = !(x.prio && x.pr);
  if (x.prio && x.pr) {
    const pd = $('oPrioDet'); pd.innerHTML = '';
    const pp = (k, v) => { if (v == null || v === '') return; pd.appendChild(el('dt', '', k)); pd.appendChild(el('dd', '', String(v))); };
    pp('Justificativa', x.pr.jus); pp('Pedido por', x.pr.sol); pp('Setor', x.pr.set);
    pp('Solicitada em', fmtFull(x.pr.dt) === '—' ? '' : fmtFull(x.pr.dt));
    if (x.pr.n > 1) pp('Pedidos de prioridade', x.pr.n);
    $('oPrioRel').textContent = x.pr.rel || ''; $('oPrioRel').hidden = !x.pr.rel;
  }
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


/* ----- Prioridades no Backlog (aba Prioridades): pendentes, atendidas por dia e lista ----- */
const prSt = { aba: 'pend', dia: '' };
const prPend = () => blFiltrar('sit').filter(x => x.prio);                       // mesmos filtros dos chips
const prAtend = () => ((bl.dados && bl.dados.prioridades && bl.dados.prioridades.atend) || [])
  .filter(x => (bl.emp === 'GERAL' || x.emp === bl.emp) && (!bl.f.sup || BLP.sup(x, bl.f.sup)));
function isoMenos(n) {                                                           // dataHoje() menos n dias, yyyy-mm-dd
  const [y, m, d] = dataHoje().split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d - n));
  return t.getUTCFullYear() + '-' + pad2(t.getUTCMonth() + 1) + '-' + pad2(t.getUTCDate());
}
const rotDia = iso => { const h = dataHoje(); return iso === h ? 'Hoje' : iso === isoMenos(1) ? 'Ontem' : iso.slice(8, 10) + '/' + iso.slice(5, 7); };
function blPrio() {
  const sec = $('bPrioSec'), d = bl.dados;
  if (!d || !d.prioOk) { sec.hidden = true; return; }
  sec.hidden = false;
  const pend = prPend(), atend = prAtend(), sp = d.prioridades || {}, hoje = dataHoje();
  $('bPrioN').textContent = pend.length + (pend.length === 1 ? ' pendente' : ' pendentes');
  const k = $('bPrioKpi'); k.innerHTML = '';
  const tile = (cls, v, lb, aba) => {
    const b = el('button', 'prt ' + cls); b.type = 'button'; b.appendChild(el('b', '', String(v))); b.appendChild(el('span', '', lb));
    b.setAttribute('aria-label', lb + ': ' + v + '. Ver lista'); b.onclick = () => abrirPrio(aba, ''); k.appendChild(b);
  };
  tile('pend', pend.length, 'Pendentes', 'pend');
  tile('bad', pend.filter(x => x.atr).length, 'Pendentes em atraso', 'pend');
  tile('ok', atend.filter(x => x.iso === hoje).length, 'Atendidas hoje', 'atend');
  tile('ok', atend.length, 'Atendidas (30 dias)', 'atend');
  if (!ehTec() && sp.semReg) tile('dim', sp.semReg, 'Sem registro', 'semreg');
  // atendidas por dia: últimos 7 dias
  const dias = []; for (let i = 6; i >= 0; i--) dias.push(isoMenos(i));
  const cont = dias.map(iso => atend.filter(x => x.iso === iso).length), max = Math.max(1, ...cont);
  $('bPrioCap').textContent = 'Atendidas por dia (últimos 7 dias)';
  const box = $('bPrioDia'); box.innerHTML = '';
  const wrap = el('div', 'age prdias');
  dias.forEach((iso, i) => {
    const b = el('button', 'agc'); b.type = 'button'; b.style.setProperty('--h', 280);
    b.setAttribute('aria-label', rotDia(iso) + ': ' + cont[i] + ' atendidas');
    b.appendChild(el('b', '', String(cont[i])));
    const c = el('i', 'col'); c.style.height = (cont[i] ? Math.max(8, cont[i] / max * 96) : 4) + 'px'; b.appendChild(c);
    b.appendChild(el('span', '', rotDia(iso)));
    b.onclick = () => abrirPrio('atend', iso);
    wrap.appendChild(b);
  });
  box.appendChild(wrap);
}
$('bPrioVer').onclick = () => abrirPrio('pend', '');
function prCard(x, rot, extra) {
  return cartaoOS({ tipo: x.tipo, protocolo: x.id, cliente: x.cli ? tc(x.cli) : '', cidade: x.cid ? tc(x.cid) : '', bairro: x.bai ? tc(x.bai) : '',
    tecnico: x.fila ? 'Sem técnico' : (x.resp || x.tec || ''), emp: x.emp, status: x.stN, atr: x.atr, prio: 1, pr: x.pr }, rot, extra);
}
function abrirPrio(aba, dia) { prSt.aba = aba; prSt.dia = dia || ''; prDesenhar(); $('prBox').scrollTop = 0; abrirDlg($('dlgPrio')); }
function prDesenhar() {
  const pend = prPend(), atend = prAtend(), sp = (bl.dados && bl.dados.prioridades) || {};
  const abas = [['pend', 'Pendentes', pend.length], ['atend', 'Atendidas', atend.length]];
  if (!ehTec()) abas.push(['semreg', 'Sem registro', sp.semReg || 0]);
  if (!abas.some(a => a[0] === prSt.aba)) prSt.aba = 'pend';
  const cb = $('prChips'); cb.innerHTML = '';
  abas.forEach(([k, n, c]) => {
    const b = el('button', 'chp' + (prSt.aba === k ? ' on' : '')); b.type = 'button'; b.setAttribute('aria-pressed', String(prSt.aba === k));
    b.appendChild(document.createTextNode(n)); b.appendChild(el('b', '', String(c)));
    b.onclick = () => { prSt.aba = k; prSt.dia = ''; prDesenhar(); }; cb.appendChild(b);
  });
  const box = $('prLista'); box.innerHTML = '';
  const vazio = t => { const v = el('div', 'pvazio'); v.innerHTML = ic('star'); v.appendChild(el('b', '', t)); box.appendChild(v); };
  if (prSt.aba === 'pend') {
    $('prSub').textContent = pend.length + (pend.length === 1 ? ' prioridade pendente' : ' prioridades pendentes') + ' · ' + pend.filter(x => x.atr).length + ' em atraso';
    if (!pend.length) return vazio('Nenhuma prioridade pendente');
    pend.slice().sort(SORTS.atraso).forEach(x => {
      const c = prCard(x, 'Pendente', 'ag'); c.classList.add('clk'); c.tabIndex = 0; c.setAttribute('role', 'button');
      c.addEventListener('click', () => abrirOS(x));
      c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirOS(x); } });
      box.appendChild(c);
    });
  } else if (prSt.aba === 'atend') {
    const l = prSt.dia ? atend.filter(x => x.iso === prSt.dia) : atend;
    $('prSub').textContent = l.length + (l.length === 1 ? ' prioridade atendida' : ' prioridades atendidas') + (prSt.dia ? ' em ' + rotDia(prSt.dia) : ' nos últimos 30 dias') +
      (sp.atendCortado ? ' (lista cortada: faltam ' + sp.atendCortado + ')' : '');
    if (prSt.dia) { const lp = el('button', 'fbtn', 'Ver todos os dias'); lp.type = 'button'; lp.onclick = () => { prSt.dia = ''; prDesenhar(); }; box.appendChild(lp); }
    if (!l.length) return vazio('Nenhuma prioridade atendida');
    const g = new Map(); l.forEach(x => { if (!g.has(x.iso)) g.set(x.iso, []); g.get(x.iso).push(x); });
    Array.from(g.keys()).sort().reverse().forEach(iso => {
      const arr = g.get(iso), hd = el('div', 'chg'); hd.appendChild(el('b', '', rotDia(iso) + ' · ' + iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4))); hd.appendChild(el('span', '', arr.length + ' OS')); box.appendChild(hd);
      arr.forEach(x => box.appendChild(prCard(Object.assign({}, x, { cli: x.cli, stN: 'Concluído' }), 'Atendida', 'cc')));
    });
  } else {
    const l = sp.semRegItens || [];
    $('prSub').textContent = (sp.semReg || 0) + ' sem registro · ' + (sp.cancel || 0) + ' canceladas (não entram nas contas)';
    if (!l.length) return vazio('Nada sem registro');
    l.forEach(x => {
      const c = cartaoOS({ protocolo: x.id, tipo: 'Não está na base de abertos nem nos encerramentos', prio: 1, pr: x.pr }, 'Sem registro', 'ag'); box.appendChild(c);
    });
  }
}
$('prFechar').onclick = () => $('dlgPrio').close();

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
  const b = emBacklog(), c = emCfg();
  document.querySelectorAll('#bnav button').forEach(x => {
    const on = !c && (x.dataset.a === 'blk') === b && x.dataset.a !== 'filtro';
    x.classList.toggle('on', on); if (on) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current');
  });
}
document.querySelectorAll('#bnav button').forEach(x => x.addEventListener('click', () => {
  const k = x.dataset.a;
  if (k === 'prod') { if (emCfg()) fecharCfg('prod'); else if (emBacklog()) fecharBacklog(); else window.scrollTo({ top: 0, behavior: 'smooth' }); }
  else if (k === 'blk') { if (emCfg()) fecharCfg('blk'); else if (!emBacklog()) abrirBacklog(); else window.scrollTo({ top: 0, behavior: 'smooth' }); }
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
  document.body.classList.remove('v-cfg'); document.body.classList.add('v-blk'); store.set(K.view, 'blk');
  window.scrollTo(0, 0);
  if (bl.dados) blRender();
  if (!bl.dados || Date.now() - bl.ultima > 60000) carregarBacklog();
  bnavAtualizar();
}
function fecharBacklog() {
  document.body.classList.remove('v-blk', 'v-cfg'); store.set(K.view, '');
  window.scrollTo(0, 0);
  if (state.dados) render();
  else carregar();
  bnavAtualizar();
}
$('blkBtn').onclick = abrirBacklog;
$('bHome').onclick = fecharBacklog;

setInterval(() => { bl.now = Date.now(); if (state.dados && !emBacklog()) { mostrarModo(); mostrarFrescor(); } if (bl.dados && emBacklog()) { blModo(); blFrescor(); } tituloAba(); if (bl.dados) notificarVencimentos(); }, 30000);

/* ----- atualização automática ----- */
setInterval(() => {
  if (document.hidden || emCfg()) return;
  if (emBacklog()) { if (Date.now() - bl.ultima > AUTO_MIN * 60000) carregarBacklog(); }
  else if (Date.now() - state.ultimaCarga > AUTO_MIN * 60000) carregar();
}, 30000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden || emCfg()) return;
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
    if (vai && !emCfg()) { if (emBacklog()) carregarBacklog(); else carregar(); }
  }, { passive: true });
})();


/* ============ CONFIGURAÇÕES (cadastros, Metas, Config, envio de arquivos, Escala e Prioridades) ============
   Gravações vão por POST com TOKEN de sessão (nada de login e senha repetidos). A permissão é conferida no servidor a cada ação:
   o que aparece ou some aqui é só conforto. Textos sempre entram por textContent (nada de innerHTML com dados). */
const sess = { token: '' };
const emCfg = () => document.body.classList.contains('v-cfg');
const podeCfg = () => papel() === 'supervisor' || papel() === 'coordenador';
const eCoord = () => papel() === 'coordenador';
async function postarBruto(corpo, ms) {
  await resolverUrl();
  if (!urlValida(SCRIPT_URL)) throw new Error('Falta configurar a URL do Apps Script no arquivo app.js.');
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms || 60000);
  try {
    const r = await fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(corpo), signal: ctl.signal, cache: 'no-store' });
    return await r.json();
  } finally { clearTimeout(t); }
}
async function obterToken() {
  if (!state.cred) throw new Error('Entre novamente.');
  const j = await postarBruto({ acao: 'login', login: state.cred.login, senha: state.cred.senha }, 30000);
  if (!j || !j.ok || !j.token) { sair('Sessão inválida. Entre novamente.'); throw new Error('Sessão inválida.'); }
  sess.token = j.token; return j.token;
}
// ação de configuração: token + código de acesso; se a sessão expirou, entra de novo sozinho e repete (nada tinha sido executado)
async function postar(acao, dados, ms) {
  if (!sess.token) await obterToken();
  const corpo = () => Object.assign({}, dados, { acao: acao, token: sess.token, codigo: state.codigo || '' });
  let j = await postarBruto(corpo(), ms);
  if (j && j.sessao) { await obterToken(); j = await postarBruto(corpo(), ms); }
  if (j && j.login) { sair('Sessão inválida. Entre novamente.'); throw new Error('Sessão inválida.'); }
  if (j && j.auth) { pedirCodigo(j.error); throw new Error(j.error || 'Código de acesso necessário.'); }
  if (!j || !j.ok) { const e = new Error((j && j.error) || 'Resposta inválida.'); e.info = j || {}; throw e; }
  return j;
}
const conflito = e => !!(e && e.info && e.info.conflito);
function cfMsg(txt, tipo, acao) {
  const s = $('cfStatus'); s.className = 'cf-status' + (tipo ? ' ' + tipo : ''); s.textContent = txt || '';
  if (acao) { const b = el('button', 'cf-b', acao.t); b.type = 'button'; b.onclick = acao.f; s.appendChild(b); }
}
const cfBtn = (txt, cls, fn, icone) => { const b = el('button', 'cf-b' + (cls ? ' ' + cls : '')); b.type = 'button'; if (icone) b.innerHTML = ic(icone); b.appendChild(document.createTextNode(txt)); if (fn) b.onclick = fn; return b; };
const cfRecarregarBtn = f => ({ t: 'Recarregar', f: () => { cfMsg(''); f(); } });

/* ----- formulário genérico (dlgForm) ----- */
const cfForm = { o: null, busy: false };
function erroForm(msg, recarregar) {
  const e = $('dfErro'); e.textContent = msg || ''; e.hidden = !msg;
  if (msg && recarregar) { const b = cfBtn('Recarregar a lista', '', () => { $('dlgForm').close(); recarregar(); }); e.appendChild(document.createElement('br')); e.appendChild(b); }
}
function campoForm(c) {
  const w = el('div', 'cf-field'), id = 'ff_' + c.k;
  let inp;
  if (c.tipo === 'check') {
    const row = el('div', 'cf-check'); inp = el('input'); inp.type = 'checkbox'; inp.id = id; inp.checked = !!c.valor;
    const l = el('label', '', c.rot); l.htmlFor = id; l.style.margin = '0'; row.appendChild(inp); row.appendChild(l); w.appendChild(row);
  } else {
    const l = el('label', '', c.rot + (c.obrig ? ' *' : '')); l.htmlFor = id; w.appendChild(l);
    if (c.tipo === 'select') {
      inp = el('select', 'ctl'); c.opcoes.forEach(o => { const op = el('option', '', o.t); op.value = o.v; inp.appendChild(op); }); inp.value = c.valor == null ? '' : c.valor;
    } else if (c.tipo === 'textarea') { inp = el('textarea', 'ctl'); inp.value = c.valor || ''; }
    else {
      inp = el('input', 'ctl'); inp.type = c.tipo === 'senha' ? 'password' : c.tipo === 'date' ? 'date' : 'text'; inp.value = c.valor == null ? '' : c.valor;
      inp.autocomplete = 'off'; if (c.tipo !== 'date') { inp.autocapitalize = 'none'; inp.spellcheck = false; }
      if (c.modo) inp.inputMode = c.modo;
    }
    if (c.max) inp.maxLength = c.max;
    if (c.tipo === 'senha') {
      const box = el('div', 'cf-pwbox'); box.appendChild(inp);
      const eye = el('button', 'cf-eye'); eye.type = 'button'; eye.innerHTML = ic('eye'); eye.setAttribute('aria-label', 'Mostrar senha'); eye.setAttribute('aria-pressed', 'false');
      eye.onclick = () => { const ver = inp.type === 'password'; inp.type = ver ? 'text' : 'password'; eye.setAttribute('aria-pressed', String(ver)); eye.setAttribute('aria-label', ver ? 'Ocultar senha' : 'Mostrar senha'); eye.innerHTML = ic(ver ? 'eyeoff' : 'eye'); };
      box.appendChild(eye); w.appendChild(box);
    } else w.appendChild(inp);
  }
  inp.id = id; inp.name = c.k; if (c.ro) inp.disabled = true;
  if (c.ajuda) { const p = el('p', 'cf-ajuda', c.ajuda); p.id = id + '_a'; inp.setAttribute('aria-describedby', p.id); w.appendChild(p); }
  return w;
}
function abrirForm(o) {
  const box = $('dfCampos'); box.innerHTML = '';
  $('dfTitulo').textContent = o.titulo; $('dfSub').textContent = o.sub || ''; erroForm('');
  o.campos.forEach(c => box.appendChild(campoForm(c)));
  $('dfSalvar').textContent = o.salvarTxt || 'Salvar'; cfForm.o = o;
  abrirDlg($('dlgForm'));
  const p = box.querySelector('input:not([disabled]):not([type=checkbox]), select:not([disabled]), textarea'); if (p) p.focus();
}
$('dfCancelar').onclick = () => $('dlgForm').close();
$('dfForm').addEventListener('submit', async e => {
  e.preventDefault();
  const o = cfForm.o; if (!o || cfForm.busy) return;
  const dados = {}; o.campos.forEach(c => { const i = $('ff_' + c.k); dados[c.k] = c.tipo === 'check' ? i.checked : i.value; });
  const falta = o.campos.find(c => c.obrig && !String(dados[c.k] || '').trim());
  if (falta) { erroForm('Preencha: ' + falta.rot + '.'); $('ff_' + falta.k).focus(); return; }
  cfForm.busy = true; $('dfSalvar').disabled = true; $('dfSalvar').textContent = 'Salvando…';
  try { await o.onSalvar(dados); $('dlgForm').close(); }
  catch (err) { erroForm(msgErro(err), conflito(err) ? o.onRecarregar : null); }
  finally { cfForm.busy = false; $('dfSalvar').disabled = false; $('dfSalvar').textContent = o.salvarTxt || 'Salvar'; }
});

/* ----- confirmação genérica ----- */
const conf = { res: null, digitar: '' };
function confirmar(o) {
  return new Promise(res => {
    const d = $('dlgConf'); conf.res = res; conf.digitar = o.digitar || '';
    $('cnTitulo').textContent = o.titulo; $('cnTexto').textContent = o.texto || '';
    $('cnDigita').hidden = !o.digitar; $('cnInput').value = '';
    if (o.digitar) $('cnRotulo').textContent = 'Digite "' + o.digitar + '" para confirmar';
    const sim = $('cnSim'); sim.textContent = o.ok || 'Confirmar'; sim.classList.toggle('perigo', !!o.perigo); sim.disabled = !!o.digitar;
    abrirDlg(d); (o.digitar ? $('cnInput') : sim).focus();
  });
}
$('cnInput').addEventListener('input', () => { $('cnSim').disabled = conf.digitar && $('cnInput').value.trim() !== conf.digitar; });
$('cnForm').addEventListener('submit', e => { e.preventDefault(); if ($('cnSim').disabled) return; const r = conf.res; conf.res = null; $('dlgConf').close(); if (r) r(true); });
$('cnNao').onclick = () => $('dlgConf').close();
$('dlgConf').addEventListener('close', () => { const r = conf.res; conf.res = null; if (r) r(false); });

/* ----- navegação e abas ----- */
const CF_AM = ['coordenador', 'supervisor'], CF_C = ['coordenador'];
const CF_ABAS = [
  { k: 'tecnico', n: 'Técnicos', p: CF_AM, f: () => cfCad('tecnico') },
  { k: 'controlador', n: 'Controladores', p: CF_AM, f: () => cfCad('controlador') },
  { k: 'supervisor', n: 'Supervisores', p: CF_C, f: () => cfCad('supervisor') },
  { k: 'coordenador', n: 'Coordenadores', p: CF_C, f: () => cfCad('coordenador') },
  { k: 'metas', n: 'Metas', p: CF_C, f: () => cfMetas() },
  { k: 'config', n: 'Config', p: CF_C, f: () => cfConfig() },
  { k: 'envio', n: 'Enviar dados', p: CF_AM, f: () => cfEnvio() },
  { k: 'escala', n: 'Escala', p: CF_AM, f: () => cfEscala() },
  { k: 'prio', n: 'Prioridades', p: CF_AM, f: () => cfPrio() }
];
const cf = { aba: '' };
const cfVisiveis = () => CF_ABAS.filter(a => a.p.indexOf(papel()) >= 0);
function cfTabs() {
  const box = $('cfTabs'); box.innerHTML = '';
  cfVisiveis().forEach(a => {
    const b = el('button', 'cf-tab', a.n); b.type = 'button'; b.id = 'cft_' + a.k; b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', 'cfBody');
    b.setAttribute('aria-selected', String(a.k === cf.aba)); b.tabIndex = a.k === cf.aba ? 0 : -1; b.onclick = () => cfIr(a.k);
    b.onkeydown = e => {
      const l = cfVisiveis(), i = l.findIndex(x => x.k === a.k);
      const j = e.key === 'ArrowRight' ? (i + 1) % l.length : e.key === 'ArrowLeft' ? (i + l.length - 1) % l.length : e.key === 'Home' ? 0 : e.key === 'End' ? l.length - 1 : -1;
      if (j >= 0) { e.preventDefault(); cfIr(l[j].k, true); }
    };
    box.appendChild(b);
  });
}
function cfIr(k, foco) {
  const l = cfVisiveis(); if (!l.length) return;
  if (!l.some(a => a.k === k)) k = l[0].k;
  cf.aba = k; cfTabs(); cfMsg(''); $('cfBody').setAttribute('aria-labelledby', 'cft_' + k);
  CF_ABAS.find(a => a.k === k).f();
  if (foco) $('cft_' + k).focus();
}
function abrirCfg() {
  if (!podeCfg()) return;
  document.body.classList.remove('v-blk'); document.body.classList.add('v-cfg'); store.set(K.view, '');
  $('cSub').textContent = eCoord() ? 'Todos os cadastros e dados' : 'Equipe de ' + tc(state.user.nome);
  window.scrollTo(0, 0); cfIr(cf.aba); bnavAtualizar();
}
function fecharCfg(para) {
  document.body.classList.remove('v-cfg');
  if (para === 'blk') abrirBacklog(); else fecharBacklog();
}
['cfgBtn', 'bCfgBtn'].forEach(id => { $(id).onclick = abrirCfg; });
$('cHome').onclick = () => fecharCfg('prod'); $('cBlk').onclick = () => fecharCfg('blk');
$('cSairBtn').onclick = () => sair(); $('cAcessBtn').onclick = () => $('acessBtn').click();
$('cRef').onclick = () => cfIr(cf.aba);

/* ----- cadastros (Técnicos, Controladores, Supervisores, Coordenadores) ----- */
const cfc = {};
const NOME_CAD = { tecnico: 'técnicos', controlador: 'controladores', supervisor: 'supervisores', coordenador: 'coordenadores' };
function cfCad(k) {
  const box = $('cfBody'); box.innerHTML = '';
  const est = cfc[k] || (cfc[k] = { busca: '', filtro: 'ativo', dados: null });
  const bar = el('div', 'cf-bar');
  const lb = el('label', 'search'); lb.innerHTML = ic('search'); const inp = el('input'); inp.type = 'search'; inp.placeholder = 'Pesquisar'; inp.autocomplete = 'off';
  inp.setAttribute('aria-label', 'Pesquisar em ' + NOME_CAD[k]); inp.value = est.busca; lb.appendChild(inp); bar.appendChild(lb);
  const sel = el('select', 'ctl'); sel.setAttribute('aria-label', 'Filtrar por situação');
  [['ativo', 'Ativos'], ['inativo', 'Inativos'], ['todos', 'Todos']].forEach(([v, t]) => { const o = el('option', '', t); o.value = v; sel.appendChild(o); }); sel.value = est.filtro; bar.appendChild(sel);
  const add = cfBtn('Adicionar', 'pri', null, 'plus'); bar.appendChild(add);
  const cont = el('div', 'cf-cont'); cont.setAttribute('aria-live', 'polite');
  const lista = el('div', 'cf-list');
  box.appendChild(bar); box.appendChild(cont); box.appendChild(lista);
  const desenhar = () => {
    const d = est.dados; if (!d) return;
    const q = nk(est.busca);
    const l = d.linhas.filter(x => (est.filtro === 'todos' || (est.filtro === 'ativo') === x.ativo) && (!q || nk([x.nome, x.ref, x.tipo, x.login].join(' ')).indexOf(q) >= 0))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    cont.textContent = l.length + ' de ' + d.linhas.length + ' ' + NOME_CAD[k];
    lista.innerHTML = '';
    if (!l.length) { lista.appendChild(el('div', 'cf-vazio', d.linhas.length ? 'Nada encontrado com esta busca e filtro.' : 'Nenhum cadastro ainda. Use "Adicionar".')); return; }
    const h = el('div', 'cf-head'); h.setAttribute('aria-hidden', 'true');
    ['Nome', 'Login', 'Senha', 'Situação', ''].forEach(t => h.appendChild(el('span', '', t))); lista.appendChild(h);
    l.forEach(x => lista.appendChild(cadLinha(k, d, x, est)));
  };
  est.recarregar = () => comCarregando(lista, async ativo => { const j = await postar('cad_listar', { cad: k }); if (!ativo()) return; est.dados = j; desenhar(); });
  inp.oninput = () => { est.busca = inp.value; desenhar(); };
  sel.onchange = () => { est.filtro = sel.value; desenhar(); };
  add.onclick = () => formCad(k, est, null);
  if (est.dados) desenhar();
  est.recarregar();
}
function cadLinha(k, d, x, est) {
  const r = el('div', 'cf-row' + (x.ativo ? '' : ' inativo'));
  const m = el('div', 'cf-main'); m.appendChild(el('b', '', x.nome));
  m.appendChild(el('span', '', [x.tipo, x.ref ? d.refRot + ': ' + x.ref : ''].filter(Boolean).join(' · '))); r.appendChild(m);
  const lg = el('div', 'cf-cel', x.login || '—'); lg.dataset.l = 'Login'; r.appendChild(lg);
  const pw = el('div', 'cf-cel cf-pw'); pw.dataset.l = 'Senha';
  if (x.senha) {
    const v = el('code', '', '••••••'), eye = el('button', 'cf-eye'); eye.type = 'button'; eye.innerHTML = ic('eye'); eye.setAttribute('aria-pressed', 'false'); eye.setAttribute('aria-label', 'Mostrar senha de ' + x.nome);
    eye.onclick = () => { const ver = eye.getAttribute('aria-pressed') !== 'true'; eye.setAttribute('aria-pressed', String(ver)); v.textContent = ver ? x.senha : '••••••'; eye.innerHTML = ic(ver ? 'eyeoff' : 'eye'); eye.setAttribute('aria-label', (ver ? 'Ocultar' : 'Mostrar') + ' senha de ' + x.nome); };
    pw.appendChild(v); pw.appendChild(eye);
  } else pw.textContent = '—';
  r.appendChild(pw);
  const st = el('div', 'cf-cel'); st.dataset.l = 'Situação'; st.appendChild(el('span', 'cf-badge' + (x.ativo ? '' : ' off'), x.ativo ? 'Ativo' : 'Inativo')); r.appendChild(st);
  const ac = el('div', 'cf-acts');
  const ed = cfBtn('Editar', '', () => formCad(k, est, x)); ed.setAttribute('aria-label', 'Editar ' + x.nome);
  const at = cfBtn(x.ativo ? 'Desativar' : 'Ativar', x.ativo ? 'perigo' : '', () => cadAtivo(k, est, x)); at.setAttribute('aria-label', (x.ativo ? 'Desativar ' : 'Ativar ') + x.nome);
  ac.appendChild(ed); ac.appendChild(at); r.appendChild(ac);
  return r;
}
function formCad(k, est, x) {
  const d = est.dados, campos = [{ k: 'nome', rot: d.rot, obrig: true, tipo: 'text', valor: x ? x.nome : '', max: 120 }];
  if (d.temTipo) {
    const ops = [{ v: '', t: '(sem tipo)' }].concat(d.tipos.map(t => ({ v: t, t: t })));
    if (x && x.tipo && !d.tipos.some(t => nk(t) === nk(x.tipo))) ops.push({ v: x.tipo, t: x.tipo + ' (fora da aba Metas)' });
    campos.push({ k: 'tipo', rot: 'Tipo', tipo: 'select', opcoes: ops, valor: x ? x.tipo : '', ajuda: 'Lista dos tipos da aba Metas.' });
  }
  if (d.refLista) {
    const ops = d.refs.map(n => ({ v: n, t: n }));
    if (x && x.ref && !d.refs.some(n => nk(n) === nk(x.ref))) ops.unshift({ v: x.ref, t: x.ref + ' (inexistente)' });
    if (!d.equipeFixa) ops.unshift({ v: '', t: 'Escolha…' });
    campos.push({ k: 'ref', rot: d.refRot, obrig: true, tipo: 'select', opcoes: ops, valor: d.equipeFixa ? d.equipeFixa : (x ? x.ref : ''), ro: !!d.equipeFixa, ajuda: d.equipeFixa ? 'Pessoas novas entram na sua equipe.' : '' });
  } else campos.push({ k: 'ref', rot: d.refRot, tipo: 'text', valor: x ? x.ref : '', max: 120 });
  campos.push({ k: 'login', rot: 'Login', tipo: 'text', valor: x ? x.login : '', max: 60, ajuda: 'Sem espaços. Único entre todos os cadastros. Deixe login e senha vazios se a pessoa não entra no painel.' });
  campos.push({ k: 'senha', rot: 'Senha', tipo: 'senha', valor: x ? x.senha : '', max: 60 });
  campos.push({ k: 'ativo', rot: 'Ativo', tipo: 'check', valor: x ? x.ativo : true });
  abrirForm({
    titulo: (x ? 'Editar ' : 'Adicionar ') + d.rot.toLowerCase(), sub: x ? x.nome : 'Novo cadastro', campos: campos, onRecarregar: est.recarregar,
    onSalvar: async dados => { await postar('cad_salvar', { cad: k, linha: x ? x.linha : 0, versao: x ? x.versao : '', dados: dados }); cfMsg('Salvo.', 'ok'); est.recarregar(); }
  });
}
async function cadAtivo(k, est, x) {
  const ativar = !x.ativo;
  const sim = await confirmar({ titulo: (ativar ? 'Ativar ' : 'Desativar ') + x.nome + '?', ok: ativar ? 'Ativar' : 'Desativar', perigo: !ativar,
    texto: ativar ? 'A pessoa volta a poder entrar e a aparecer nas listas.' : 'A pessoa não poderá mais entrar e sai das listas. A linha continua na planilha com Ativo = NÃO (nada é apagado).' });
  if (!sim) return;
  try { await postar('cad_ativo', { cad: k, linha: x.linha, versao: x.versao, ativo: ativar }); cfMsg('Salvo.', 'ok'); }
  catch (e) { cfMsg(msgErro(e), 'erro', conflito(e) ? cfRecarregarBtn(est.recarregar) : null); if (!conflito(e)) return; }
  est.recarregar();
}

/* ----- Metas (só coordenador) ----- */
const cfm = { itens: [], backup: null };
const fmtMeta = n => n === '' || n == null ? '' : String(n).replace('.', ',');
const numMeta = s => { const t = String(s == null ? '' : s).trim().replace(',', '.'); if (!t) return null; const n = Number(t); return isFinite(n) ? n : null; };
function erroMeta(it) {
  const nome = (it.tipo || '').trim();
  if (!nome) return 'Informe o nome do tipo.';
  const n = it.v.map(numMeta);
  if (n.some(x => x == null)) return 'Preencha as quatro metas com números.';
  if (n.some(x => x < 0 || x > 1000)) return 'Meta fora do intervalo permitido.';
  for (let j = 1; j < 4; j++) if (n[j] < n[j - 1]) return 'É preciso Meta I ≤ II ≤ III ≤ IV.';
  if (cfm.itens.some(o => o !== it && nk(o.tipo) === nk(nome))) return 'Já existe esse tipo.';
  return '';
}
const sujoMeta = it => it.novo || JSON.stringify(it.v) !== it.orig;
function cfMetas() {
  const box = $('cfBody'); box.innerHTML = '';
  box.appendChild(el('h2', 'cf-h', 'Metas por tipo de técnico'));
  box.appendChild(el('p', 'cf-sub', 'Meta diária de concluídas (Meta I a IV). Aceita vírgula decimal. Precisa valer Meta I ≤ II ≤ III ≤ IV e nenhum campo pode ficar vazio.'));
  const bar = el('div', 'cf-bar'), add = cfBtn('Adicionar tipo', '', null, 'plus'), salvar = cfBtn('Salvar alterações', 'pri', null, 'save'), rest = cfBtn('Restaurar último backup', '');
  salvar.disabled = true; rest.hidden = true; bar.appendChild(add); bar.appendChild(salvar); bar.appendChild(rest);
  const lista = el('div', 'cf-list'); box.appendChild(bar); box.appendChild(lista);
  const atualizar = () => { salvar.disabled = !cfm.itens.some(sujoMeta); };
  const desenhar = () => {
    lista.innerHTML = '';
    if (!cfm.itens.length) { lista.appendChild(el('div', 'cf-vazio', 'Nenhum tipo cadastrado. Use "Adicionar tipo".')); atualizar(); return; }
    const h = el('div', 'cf-metas-h'); h.setAttribute('aria-hidden', 'true'); ['Tipo', 'Meta I', 'Meta II', 'Meta III', 'Meta IV', ''].forEach(t => h.appendChild(el('span', '', t))); lista.appendChild(h);
    cfm.itens.forEach((it, idx) => {
      const r = el('div', 'cf-metas-r'), err = el('div', 'cf-linhaerr'); err.setAttribute('role', 'alert');
      const t = el('input', 'ctl cf-tipo'); t.type = 'text'; t.value = it.tipo; t.setAttribute('aria-label', 'Nome do tipo'); t.maxLength = 60; t.autocomplete = 'off';
      if (!it.novo) { t.readOnly = true; t.title = 'Para renomear um tipo, mude também a coluna Tipo na aba Técnicos'; }
      t.oninput = () => { it.tipo = t.value; revalida(); };
      r.appendChild(t);
      const ins = [];
      it.v.forEach((val, j) => {
        const w = el('div'); const l = el('label', 'sr', 'Meta ' + ROMANOS[j]); const i = el('input', 'ctl'); i.type = 'text'; i.inputMode = 'decimal'; i.value = val; i.id = 'mt_' + idx + '_' + j; l.htmlFor = i.id;
        i.autocomplete = 'off'; i.oninput = () => { it.v[j] = i.value; revalida(); }; ins.push(i); w.appendChild(l); w.appendChild(i); r.appendChild(w);
      });
      const rem = cfBtn('Remover', 'perigo cf-rem', () => metaRemover(it)); rem.setAttribute('aria-label', 'Remover o tipo ' + (it.tipo || 'novo')); r.appendChild(rem);
      r.appendChild(err);
      const revalida = () => { r.classList.toggle('sujo', sujoMeta(it)); err.textContent = sujoMeta(it) ? erroMeta(it) : ''; atualizar(); };
      revalida(); lista.appendChild(r);
    });
    atualizar();
  };
  const carregar = () => comCarregando(lista, async ativo => {
    const j = await postar('metas_listar', {}); if (!ativo()) return;
    cfm.itens = j.itens.map(i => { const v = i.v.map(fmtMeta); return { linha: i.linha, versao: i.versao, tipo: i.tipo, v: v, orig: JSON.stringify(v), usamAtivos: i.usamAtivos, usamTotal: i.usamTotal, novo: false }; });
    cfm.backup = j.backup; rest.hidden = !j.backup; desenhar();
  });
  cfm.recarregar = carregar; cfm.desenhar = desenhar;
  add.onclick = () => { cfm.itens.unshift({ linha: 0, versao: '', tipo: '', v: ['', '', '', ''], orig: '', novo: true }); desenhar(); const p = lista.querySelector('.cf-tipo'); if (p) p.focus(); };
  salvar.onclick = async () => {
    const sujos = cfm.itens.filter(sujoMeta), e = sujos.map(erroMeta).find(Boolean);
    if (e) { cfMsg(e, 'erro'); return; }
    salvar.disabled = true;
    try { await postar('metas_salvar', { itens: sujos.map(i => ({ linha: i.linha, versao: i.versao, tipo: i.tipo.trim(), v: i.v })) }); cfMsg('Salvo.', 'ok'); carregar(); }
    catch (err) { cfMsg(msgErro(err), 'erro', conflito(err) ? cfRecarregarBtn(carregar) : null); atualizar(); }
  };
  rest.onclick = async () => {
    const b = cfm.backup;
    if (!await confirmar({ titulo: 'Restaurar a aba Metas?', ok: 'Restaurar', perigo: true, texto: 'A aba Metas volta ao conteúdo de antes da última mudança' + (b && b.t ? ' (' + fmtDH(b.t) + ')' : '') + '. Mudanças feitas depois dela serão perdidas.' })) return;
    try { await postar('backup_restaurar', { aba: 'Metas' }); cfMsg('Backup restaurado.', 'ok'); carregar(); } catch (err) { cfMsg(msgErro(err), 'erro'); }
  };
  carregar();
}
async function metaRemover(it) {
  if (it.novo) { cfm.itens = cfm.itens.filter(x => x !== it); cfm.desenhar(); return; }
  const n = it.usamAtivos || 0;
  const texto = (n ? n + ' técnico(s) ativo(s) usam o tipo "' + it.tipo + '"' + (it.usamTotal > n ? ' (' + it.usamTotal + ' contando os inativos)' : '') + '. Sem o tipo eles passam a usar a "Meta padrão" da Config. ' : it.usamTotal ? 'Só técnicos inativos usam este tipo. ' : 'Nenhum técnico usa este tipo. ') + 'Uma cópia da aba fica guardada para restaurar.';
  if (!await confirmar({ titulo: 'Remover o tipo "' + it.tipo + '"?', texto: texto, ok: 'Remover', perigo: true })) return;
  try { await postar('metas_remover', { linha: it.linha, versao: it.versao, confirmo: true }); cfMsg('Tipo removido.', 'ok'); }
  catch (e) { cfMsg(msgErro(e), 'erro', conflito(e) ? cfRecarregarBtn(() => cfMetas()) : null); return; }
  cfMetas();
}

/* ----- Config (só coordenador) ----- */
const CF_ROT = {
  codigo: ['Código de acesso', 'Se preenchido, todos precisam digitar este código para entrar. Deixe vazio para desligar.', ''],
  metaNormal: ['Meta normal (por dia)', 'Usada quando o técnico não tem tipo na aba Metas e o período é longo.', '4'],
  metaObs: ['Meta observação (por dia)', 'Abaixo dela o técnico fica em atenção.', '2'],
  metaGap: ['Meta do gap (1 a 4)', 'Qual meta do tipo (I a IV) serve de referência para o Gap.', '1'],
  metaPadrao: ['Meta padrão (por dia)', 'Meta diária de quem não tem tipo.', '5'],
  titulo: ['Título', 'Aparece no topo do painel.', 'Desempenho da Equipe'],
  subtitulo: ['Subtítulo', 'Texto abaixo do título (pode ficar vazio).', ''],
  expedIni: ['Início do expediente', 'Usado na projeção do dia.', '08:00'],
  expedFim: ['Fim do expediente', 'Usado na projeção do dia.', '18:00']
};
function cfConfig() {
  const box = $('cfBody'); box.innerHTML = '';
  box.appendChild(el('h2', 'cf-h', 'Config do painel'));
  box.appendChild(el('p', 'cf-sub', 'Valores da aba Config. As outras linhas da aba não são tocadas.'));
  const area = el('div'); box.appendChild(area);
  const carregar = () => comCarregando(area, async ativo => {
    const j = await postar('config_ler', {}); if (!ativo()) return;
    const card = el('form', 'cf-card'); card.noValidate = true; const ins = {};
    j.campos.forEach(c => {
      const [rot, ajuda, padrao] = CF_ROT[c.k], w = el('div', 'cf-field'), id = 'cc_' + c.k;
      const l = el('label', '', rot); l.htmlFor = id; w.appendChild(l);
      let i;
      if (c.tipo === 'gap') { i = el('select', 'ctl'); [1, 2, 3, 4].forEach(n => { const o = el('option', '', 'Meta ' + ROMANOS[n - 1] + ' (' + n + ')'); o.value = String(n); i.appendChild(o); }); i.value = c.valor || '1'; }
      else {
        i = el('input', 'ctl'); i.autocomplete = 'off'; i.value = c.valor;
        if (c.tipo === 'hora') i.type = 'time'; else { i.type = c.k === 'codigo' ? 'password' : 'text'; if (c.tipo === 'num') i.inputMode = 'decimal'; i.placeholder = padrao; }
      }
      i.id = id; ins[c.k] = i;
      if (c.k === 'codigo') {
        const b2 = el('div', 'cf-pwbox'); b2.appendChild(i); const eye = el('button', 'cf-eye'); eye.type = 'button'; eye.innerHTML = ic('eye'); eye.setAttribute('aria-label', 'Mostrar código'); eye.setAttribute('aria-pressed', 'false');
        eye.onclick = () => { const ver = i.type === 'password'; i.type = ver ? 'text' : 'password'; eye.setAttribute('aria-pressed', String(ver)); eye.setAttribute('aria-label', ver ? 'Ocultar código' : 'Mostrar código'); eye.innerHTML = ic(ver ? 'eyeoff' : 'eye'); };
        b2.appendChild(eye); w.appendChild(b2);
      } else w.appendChild(i);
      const p = el('p', 'cf-ajuda', ajuda + (c.existe ? '' : ' (ainda não existe na aba: será criada ao salvar com valor; vazio usa o padrão ' + (padrao || 'em branco') + ')')); p.id = id + '_a'; i.setAttribute('aria-describedby', p.id); w.appendChild(p);
      card.appendChild(w);
    });
    const salvar = cfBtn('Salvar', 'pri', null, 'save'); salvar.type = 'submit'; salvar.style.marginTop = '14px'; card.appendChild(salvar);
    card.onsubmit = async e => {
      e.preventDefault();
      const valores = {}; j.campos.forEach(c => { const v = ins[c.k].value.trim(); if (v !== String(c.valor).trim() && (c.existe || v !== '')) valores[c.k] = v; });
      if (!Object.keys(valores).length) { cfMsg('Nada mudou.', 'aviso'); return; }
      let confirmoCodigo = false;
      if ('codigo' in valores) {
        if (!await confirmar({ titulo: 'Mudar o código de acesso?', ok: 'Mudar código', perigo: true, texto: valores.codigo ? 'Todas as pessoas precisarão digitar o NOVO código para ver o painel. Avise a equipe antes.' : 'O código de acesso será desligado: o painel passa a abrir só com login e senha.' })) return;
        confirmoCodigo = true;
      }
      salvar.disabled = true;
      try {
        await postar('config_salvar', { versao: j.versao, valores: valores, confirmoCodigo: confirmoCodigo });
        if ('codigo' in valores) { state.codigo = valores.codigo; store.set(K.codigo, valores.codigo); }
        cfMsg('Salvo.', 'ok'); carregar();
      } catch (err) { cfMsg(msgErro(err), 'erro', conflito(err) ? cfRecarregarBtn(carregar) : null); salvar.disabled = false; }
    };
    area.appendChild(card);
  });
  carregar();
}

/* ----- Enviar dados (Encerramentos, Encerramentos_Hoje, Base_Abertos) ----- */
const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';   // versão fixada
let xlsxP = null;
function carregarXLSX() {
  if (window.XLSX) return Promise.resolve();
  if (xlsxP) return xlsxP;
  xlsxP = new Promise((ok, no) => {
    const s = document.createElement('script'); s.src = XLSX_URL; s.crossOrigin = 'anonymous';
    s.onload = () => (window.XLSX ? ok() : (xlsxP = null, no(new Error('O leitor de planilhas não carregou.'))));
    s.onerror = () => { xlsxP = null; no(new Error('Não consegui carregar o leitor de planilhas (cdnjs). Verifique a conexão ou envie um arquivo .csv.')); };
    document.head.appendChild(s);
  });
  return xlsxP;
}
function decodificar(buf) {
  const u8 = new Uint8Array(buf);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8).replace(/^\uFEFF/, ''); }
  catch (_) { return new TextDecoder('windows-1252').decode(u8); }        // CSV antigo do Excel (acentos não viram "Ã§")
}
function parseCSV(t) {
  const prim = (t.split(/\r?\n/)[0] || ''); let delim = ';', melhor = -1;
  [';', ',', '\t'].forEach(d => { const n = prim.split(d).length; if (n > melhor) { melhor = n; delim = d; } });
  const rows = []; let row = [], cel = '', asp = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (asp) { if (c === '"') { if (t[i + 1] === '"') { cel += '"'; i++; } else asp = false; } else cel += c; }
    else if (c === '"' && cel === '') asp = true;
    else if (c === delim) { row.push(cel); cel = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cel); cel = ''; rows.push(row); row = []; }
    else cel += c;
  }
  if (cel !== '' || row.length) { row.push(cel); rows.push(row); }
  return rows;
}
const p2 = n => String(n).padStart(2, '0');
function valorCelula(c) {
  if (!c) return '';
  if (c.t === 'n') {
    if (c.z && XLSX.SSF.is_date(c.z)) { const d = XLSX.SSF.parse_date_code(c.v); return { d: d.y + '-' + p2(d.m) + '-' + p2(d.d) + ' ' + p2(d.H) + ':' + p2(d.M) + ':' + p2(Math.floor(d.S)) }; }
    return c.v;
  }
  if (c.t === 'b') return c.v ? 'TRUE' : 'FALSE';
  if (c.t === 'e') return '';
  return c.v == null ? '' : String(c.v);
}
async function lerArquivo(file) {
  const buf = await file.arrayBuffer(), nome = file.name.toLowerCase();
  if (/\.csv$/.test(nome) || /\.txt$/.test(nome)) return parseCSV(decodificar(buf));
  if (!/\.(xlsx|xls)$/.test(nome)) throw new Error('Formato não aceito. Envie .xlsx, .xls ou .csv.');
  await carregarXLSX();
  const wb = XLSX.read(buf, { type: 'array', cellNF: true, cellDates: false, raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws || !ws['!ref']) return [];
  const rg = XLSX.utils.decode_range(ws['!ref']), rows = [];
  for (let r = rg.s.r; r <= rg.e.r; r++) { const row = []; for (let c = rg.s.c; c <= rg.e.c; c++) row.push(valorCelula(ws[XLSX.utils.encode_cell({ r: r, c: c })])); rows.push(row); }
  return rows;
}
const hkey = s => nk(s).replace(/[_\s]+/g, ' ');
const txtCel = x => x == null ? '' : typeof x === 'object' ? String(x.d || '') : String(x);
// casa as colunas do arquivo com as da aba pelo NOME (qualquer ordem)
function prepararArquivo(rows, info) {
  if (!rows.length) throw new Error('O arquivo está vazio.');
  const hdr = rows[0].map(x => txtCel(x).trim()), dest = info.cabecalho;
  const mapa = dest.map(n => hkey(n) ? hdr.findIndex(h => hkey(h) === hkey(n)) : -1);
  const sobrando = hdr.filter(h => h && !dest.some(n => hkey(n) === hkey(h)));
  const repetidos = hdr.filter((h, i) => h && hdr.findIndex(x => hkey(x) === hkey(h)) !== i);
  const faltam = info.obrigatorias.filter(n => !hdr.some(h => hkey(h) === hkey(n)));
  const semDados = dest.filter((n, j) => n && mapa[j] < 0 && info.colunasFormula.indexOf(n) < 0);
  const linhas = rows.slice(1).filter(r => r.some(x => x !== '' && x != null));
  return { hdr: hdr, mapa: mapa, sobrando: sobrando, repetidos: repetidos, faltam: faltam, semDados: semDados, orig: linhas,
           dest: linhas.map(r => mapa.map(p => p < 0 || r[p] === undefined ? null : r[p])), presentes: dest.filter((n, j) => mapa[j] >= 0) };
}
const MODO_T = {
  substituir: ['Substituir tudo', 'Troca todo o conteúdo da aba pelo do arquivo.'],
  acrescentar: ['Acrescentar sem duplicar', 'Só entram as linhas cujo protocolo ainda não existe na aba.'],
  mesclar: ['Mesclar', 'Atualiza as que já existem, adiciona as novas e REMOVE as que não vieram no arquivo.']
};
const MOTIVO_T = { inv: 'Protocolo inválido', rep: 'Repetido no arquivo (entrou a primeira ocorrência)', dup: 'Já existe na aba (mantida a da planilha)' };
const ev = { aba: 'Encerramentos', info: null, arq: null, modo: '', cancel: false, ocupado: false, id: '' };
async function tentar(n, fn) {
  for (let i = 1; ; i++) { try { return await fn(); } catch (e) { if (e.info || i >= n) throw e; await new Promise(r => setTimeout(r, 800 * i)); } }   // só repete falha de rede
}
function cfEnvio() {
  const box = $('cfBody'); box.innerHTML = '';
  box.appendChild(el('h2', 'cf-h', 'Enviar dados para a planilha'));
  box.appendChild(el('p', 'cf-sub', 'Escolha a aba e o arquivo (.xlsx, .xls ou .csv). Nada é gravado na aba antes da sua confirmação, e há backup para desfazer.'));
  const c1 = el('div', 'cf-card'), cInfo = el('div'), cArq = el('div'), cModo = el('div'), cAcao = el('div'), cPrev = el('div'), cRes = el('div'), cDesf = el('div');
  const sel = el('select', 'ctl'); sel.id = 'evAba';
  const l1 = el('label', '', 'Aba de destino'); l1.htmlFor = 'evAba'; c1.appendChild(l1); c1.appendChild(sel);
  ['Encerramentos', 'Encerramentos_Hoje', 'Base_Abertos'].forEach(a => { const o = el('option', '', a); o.value = a; sel.appendChild(o); }); sel.value = ev.aba;
  c1.appendChild(cInfo);
  const l2 = el('label', '', 'Arquivo'); l2.htmlFor = 'evArq'; c1.appendChild(l2);
  const arq = el('input', 'ctl'); arq.type = 'file'; arq.id = 'evArq'; arq.accept = '.xlsx,.xls,.csv'; arq.style.paddingTop = '9px'; c1.appendChild(arq);
  c1.appendChild(cArq);
  box.appendChild(c1); box.appendChild(cModo); box.appendChild(cAcao); box.appendChild(cPrev); box.appendChild(cRes); box.appendChild(cDesf);
  const limpar = () => { cPrev.innerHTML = ''; cRes.innerHTML = ''; };
  const descartar = async () => { if (ev.id) { const id = ev.id; ev.id = ''; try { await postar('envio_cancelar', { id: id }); } catch (_) {} } };
  const desenharModo = () => {
    cModo.innerHTML = ''; if (!ev.info) return;
    const c = el('div', 'cf-card'), fs = el('fieldset', 'cf-radios'); fs.appendChild(el('legend', '', 'Modo de envio'));
    ev.info.modos.forEach(m => {
      const lb = el('label', 'cf-radio'), r = el('input'); r.type = 'radio'; r.name = 'evModo'; r.value = m; r.checked = ev.modo === m;
      r.onchange = () => { ev.modo = m; limpar(); descartar(); desenharModo(); desenharAcao(); };
      const t = el('div'); t.appendChild(el('b', '', MODO_T[m][0] + (m === ev.info.padrao ? ' (padrão)' : ''))); t.appendChild(el('span', '', MODO_T[m][1])); lb.appendChild(r); lb.appendChild(t); fs.appendChild(lb);
    });
    c.appendChild(fs);
    if (ev.modo === 'acrescentar' && ev.aba !== 'Encerramentos') c.appendChild(el('div', 'cf-aviso', 'Atenção: acrescentar nesta aba deixa as OS antigas, já resolvidas, junto com as novas e pode distorcer o backlog. O normal aqui é "Substituir tudo".'));
    if (ev.modo === 'mesclar') c.appendChild(el('div', 'cf-aviso', 'Mesclar remove da aba as OS que não vieram no arquivo. Confira a prévia antes de confirmar.'));
    cModo.appendChild(c);
  };
  const desenharAcao = () => {
    cAcao.innerHTML = '';
    if (!ev.arq || ev.arq.faltam.length || !ev.info) return;
    const c = el('div', 'cf-card');
    const ver = cfBtn('Verificar arquivo e ver a prévia', 'pri', () => verificar(cAcao, cPrev, cRes, desenharInfo), 'upload'); c.appendChild(ver); cAcao.appendChild(c);
  };
  const desenharInfo = async () => {
    cInfo.innerHTML = ''; cDesf.innerHTML = '';
    try { ev.info = await postar('envio_info', { aba: ev.aba }); } catch (e) { cfMsg(msgErro(e), 'erro'); return; }
    const i = ev.info; if (!ev.modo || i.modos.indexOf(ev.modo) < 0) ev.modo = i.padrao;
    cInfo.appendChild(el('p', 'cf-ajuda', 'A aba tem ' + i.linhas + ' linhas de dados hoje.' + (i.colunasFormula.length ? ' Colunas com fórmula (preservadas): ' + i.colunasFormula.join(', ') + '.' : '')));
    if (i.faltamNaAba.length) cInfo.appendChild(el('div', 'cf-forte', 'A aba não tem a(s) coluna(s) obrigatória(s): ' + i.faltamNaAba.join(', ') + '. Corrija o cabeçalho na planilha.'));
    if (i.ocupadoPor) cInfo.appendChild(el('div', 'cf-aviso', 'Há um envio em andamento por ' + i.ocupadoPor + '. Aguarde alguns minutos.'));
    desenharModo(); desenharAcao();
    if (i.backup) {
      const c = el('div', 'cf-card'); c.appendChild(el('h3', '', 'Desfazer último envio'));
      c.appendChild(el('p', 'cf-ajuda', 'Há backup desta aba' + (i.backup.t ? ' de ' + fmtDH(i.backup.t) : '') + (i.backup.login ? ' (' + i.backup.login + ')' : '') + '. Restaurar devolve o conteúdo de antes do último envio e o carimbo do Sincronismo.'));
      c.appendChild(cfBtn('Desfazer último envio', 'perigo', async () => {
        if (!await confirmar({ titulo: 'Desfazer o último envio de ' + ev.aba + '?', ok: 'Desfazer', perigo: true, texto: 'A aba volta ao conteúdo de antes do último envio. Alterações feitas na aba depois dele serão perdidas.' })) return;
        try { await postar('envio_desfazer', { aba: ev.aba }); cfMsg('Envio desfeito: a aba voltou ao estado anterior.', 'ok'); limpar(); desenharInfo(); } catch (e) { cfMsg(msgErro(e), 'erro'); }
      })); cDesf.appendChild(c);
    }
  };
  sel.onchange = () => { ev.aba = sel.value; ev.arq = null; arq.value = ''; cArq.innerHTML = ''; limpar(); descartar(); desenharInfo(); };
  arq.onchange = async () => {
    limpar(); descartar(); ev.arq = null; cArq.innerHTML = ''; desenharAcao();
    const f = arq.files && arq.files[0]; if (!f) return;
    cArq.appendChild(el('p', 'cf-ajuda', 'Lendo o arquivo…'));
    try {
      const a = prepararArquivo(await lerArquivo(f), ev.info); a.nome = f.name; cArq.innerHTML = '';
      if (a.dest.length > ev.info.maxLinhas) throw new Error('O arquivo tem linhas demais (máximo ' + ev.info.maxLinhas + ').');
      ev.arq = a;
      cArq.appendChild(el('p', 'cf-ajuda', f.name + ': ' + a.dest.length + ' linhas de dados, ' + a.presentes.length + ' colunas reconhecidas.'));
      if (a.faltam.length) cArq.appendChild(el('div', 'cf-forte', 'Envio bloqueado: faltam colunas obrigatórias no arquivo: ' + a.faltam.join(', ') + '.'));
      if (!a.dest.length) { ev.arq.faltam = ev.arq.faltam.concat(['(nenhuma linha de dados)']); cArq.appendChild(el('div', 'cf-forte', 'O arquivo não tem linhas de dados.')); }
      if (a.sobrando.length) cArq.appendChild(el('div', 'cf-aviso', 'Colunas do arquivo que não existem na aba (serão ignoradas): ' + a.sobrando.join(', ') + '.'));
      if (a.repetidos.length) cArq.appendChild(el('div', 'cf-aviso', 'Cabeçalho repetido no arquivo (vale a primeira coluna): ' + a.repetidos.join(', ') + '.'));
      if (a.semDados.length) cArq.appendChild(el('div', 'cf-info', 'Colunas da aba que não vieram no arquivo' + (ev.modo === 'mesclar' ? ' (mantêm o valor atual)' : ' (ficam vazias nas linhas novas)') + ': ' + a.semDados.join(', ') + '.'));
    } catch (e) { cArq.innerHTML = ''; cArq.appendChild(el('div', 'cf-forte', msgErro(e))); }
    desenharAcao();
  };
  desenharInfo();
}
async function verificar(cAcao, cPrev, cRes, recarregarInfo) {
  if (ev.ocupado) return;
  const a = ev.arq, info = ev.info; ev.cancel = false; ev.ocupado = true; cPrev.innerHTML = ''; cRes.innerHTML = '';
  const c = el('div', 'cf-card'), prog = el('progress', 'cf-prog'), txt = el('p', 'cf-ajuda', 'Enviando para a área temporária…'); txt.setAttribute('aria-live', 'polite');
  prog.max = a.dest.length; prog.value = 0; prog.setAttribute('aria-label', 'Progresso do envio');
  const canc = cfBtn('Cancelar', 'perigo', () => { ev.cancel = true; canc.disabled = true; txt.textContent = 'Cancelando…'; });
  c.appendChild(prog); c.appendChild(txt); c.appendChild(canc); cPrev.appendChild(c);
  try {
    const ini = await postar('envio_iniciar', { aba: ev.aba, modo: ev.modo, total: a.dest.length, cabecalhoAba: info.cabecalho, presentes: a.presentes, nomeArquivo: a.nome });
    ev.id = ini.id;
    const lote = Math.max(50, Math.floor(15000 / Math.max(1, info.cabecalho.length)));
    for (let i = 0; i < a.dest.length; i += lote) {
      if (ev.cancel) break;
      await tentar(3, () => postar('envio_lote', { id: ev.id, ini: i, linhas: a.dest.slice(i, i + lote) }, 120000));
      prog.value = Math.min(a.dest.length, i + lote); txt.textContent = 'Enviado ' + prog.value + ' de ' + a.dest.length + ' linhas…';
    }
    if (ev.cancel) { const id = ev.id; ev.id = ''; await postar('envio_cancelar', { id: id }); cPrev.innerHTML = ''; cfMsg('Envio cancelado. Nada foi alterado na aba.', 'aviso'); return; }
    txt.textContent = 'Conferindo…';
    const p = await tentar(2, () => postar('envio_previa', { id: ev.id }, 120000));
    cPrev.innerHTML = ''; mostrarPrevia(cPrev, cRes, p, recarregarInfo);
  } catch (e) {
    cPrev.innerHTML = ''; cfMsg(msgErro(e) + ' Nada foi alterado na aba.', 'erro');
    if (ev.id) { const id = ev.id; ev.id = ''; try { await postar('envio_cancelar', { id: id }); } catch (_) {} }
  } finally { ev.ocupado = false; }
}
function tile(n, rot, cls) { const t = el('div', 'cf-stat' + (cls ? ' ' + cls : '')); t.appendChild(el('b', '', String(n))); t.appendChild(el('span', '', rot)); return t; }
function mostrarPrevia(cPrev, cRes, p, recarregarInfo) {
  const c = el('div', 'cf-card'); c.appendChild(el('h3', '', 'Prévia: ' + p.aba + ' (' + MODO_T[p.modo][0].toLowerCase() + ')'));
  const g = el('div', 'cf-stats');
  g.appendChild(tile(p.linhasAtuais, 'linhas atuais')); g.appendChild(tile(p.linhasArquivo, 'linhas no arquivo'));
  if (p.modo === 'mesclar') { g.appendChild(tile(p.novas, 'novas', 'ok')); g.appendChild(tile(p.atualizadas, 'atualizadas')); g.appendChild(tile(p.removidas, 'removidas', p.removidas ? 'warn' : '')); }
  else g.appendChild(tile(p.entram, 'entram', 'ok'));
  g.appendChild(tile(p.duplicadas, 'duplicadas (já na aba)', p.duplicadas ? 'warn' : '')); g.appendChild(tile(p.repetidas, 'repetidas no arquivo', p.repetidas ? 'warn' : '')); g.appendChild(tile(p.invalidas, 'inválidas', p.invalidas ? 'bad' : ''));
  c.appendChild(g);
  if (p.semProtocolo) c.appendChild(el('div', 'cf-info', p.semProtocolo + ' linha(s) da aba sem protocolo válido serão mantidas como estão.'));
  if (p.colunasFormula.length) c.appendChild(el('div', 'cf-info', 'Colunas com fórmula preservadas: ' + p.colunasFormula.join(', ') + '.'));
  if (p.alertaForte) c.appendChild(el('div', 'cf-forte', p.modo === 'substituir' ? 'ALERTA: o arquivo tem ' + p.linhasArquivo + ' linhas e a aba tem ' + p.linhasAtuais + ' (menos da metade). Substituir vai apagar o que não estiver no arquivo. Você precisará digitar o nome da aba para confirmar.' : 'ALERTA: esta mesclagem remove ' + p.removidas + ' das ' + p.linhasAtuais + ' linhas atuais. Você precisará digitar o nome da aba para confirmar.'));
  c.appendChild(el('h3', '', 'Primeiras ' + p.primeiras.length + ' linhas que entram'));
  const tw = el('div', 'cf-tabela'), tb = el('table'); tb.setAttribute('aria-label', 'Primeiras linhas que entram');
  const th = el('tr'); p.cabecalho.forEach(h => { const x = el('th', '', h); x.scope = 'col'; th.appendChild(x); }); const thd = el('thead'); thd.appendChild(th); tb.appendChild(thd);
  const tbd = el('tbody'); p.primeiras.forEach(r => { const tr = el('tr'); r.forEach(v => tr.appendChild(el('td', '', v))); tbd.appendChild(tr); }); tb.appendChild(tbd); tw.appendChild(tb); c.appendChild(tw);
  if (!p.primeiras.length) c.appendChild(el('div', 'cf-forte', 'Nenhuma linha válida para entrar.'));
  const ac = el('div', 'cf-bar');
  const ok = cfBtn('Confirmar envio', 'pri', async () => {
    let confirmacao = '';
    if (p.alertaForte) { if (!await confirmar({ titulo: 'Confirmar a substituição?', texto: 'Esta operação muda muitas linhas de ' + p.aba + '. Um backup será guardado e dá para desfazer.', digitar: p.aba, ok: 'Substituir', perigo: true })) return; confirmacao = p.aba; }
    ok.disabled = true; no.disabled = true; ok.textContent = 'Gravando…';
    try { const r = await postar('envio_confirmar', { id: ev.id, confirmacao: confirmacao }, 300000); ev.id = ''; cPrev.innerHTML = ''; mostrarResultado(cRes, r); recarregarInfo(); }
    catch (e) { cfMsg(msgErro(e), 'erro'); ok.disabled = false; no.disabled = false; ok.textContent = 'Confirmar envio'; }
  }, 'save');
  const no = cfBtn('Cancelar', '', async () => { const id = ev.id; ev.id = ''; cPrev.innerHTML = ''; if (id) { try { await postar('envio_cancelar', { id: id }); } catch (_) {} } cfMsg('Envio cancelado. Nada foi alterado na aba.', 'aviso'); });
  ok.disabled = !p.entram;
  ac.appendChild(ok); ac.appendChild(no); c.appendChild(ac); cPrev.appendChild(c);
}
function mostrarResultado(cRes, r) {
  const c = el('div', 'cf-card'); c.appendChild(el('h3', '', 'Envio concluído em ' + r.aba));
  const linha = r.novas + ' novas, ' + r.duplicadas + ' duplicadas ignoradas, ' + r.invalidas + ' inválidas' + (r.repetidas ? ' (e ' + r.repetidas + ' repetidas no arquivo)' : '') + (r.modo === 'mesclar' ? '; ' + r.atualizadas + ' atualizadas, ' + r.removidas + ' removidas' : '') + '.';
  const p = el('p', '', linha); p.style.fontWeight = '700'; c.appendChild(p);
  c.appendChild(el('p', 'cf-ajuda', r.carimbo ? 'Carimbo da aba Sincronismo atualizado.' : (r.avisoSinc || '')));
  if (r.ignoradas.length) c.appendChild(cfBtn('Baixar ignoradas e inválidas (CSV)', '', () => {
    const a = ev.arq; if (!a) return;
    const cab = ['Linha no arquivo', 'Motivo'].concat(a.hdr);
    const linhas = r.ignoradas.map(x => [x[0] + 2, MOTIVO_T[x[1]] + (x[1] === 'inv' ? ': ' + x[2] : '')].concat((a.orig[x[0]] || []).map(txtCel)));
    baixarCSV('envio-ignoradas-' + r.aba + '-' + dataHoje() + '.csv', csvTexto(cab, linhas));
  }, 'copy'));
  c.appendChild(el('p', 'cf-ajuda', 'Para voltar atrás, use "Desfazer último envio" abaixo.'));
  cRes.appendChild(c); cfMsg('Envio concluído: ' + linha, 'ok');
}

/* ----- Escala (colaboradores x datas) ----- */
const cfe = { dados: null, data: '', alter: {} };
function cfEscala() {
  const box = $('cfBody'); box.innerHTML = ''; cfe.alter = {};
  box.appendChild(el('h2', 'cf-h', 'Escala de fim de semana e feriado'));
  box.appendChild(el('p', 'cf-sub', 'Escolha a data e ajuste o código de cada pessoa. Só valem os códigos que a aba já usa e os nomes iguais aos da aba Técnicos.' + (eCoord() ? '' : ' Você vê só a sua equipe.')));
  const bar = el('div', 'cf-bar'), area = el('div');
  const l1 = el('label', 'sr', 'Data'); l1.htmlFor = 'esData'; l1.style.position = 'absolute'; l1.style.left = '-9999px';
  const sd = el('select', 'ctl'); sd.id = 'esData';
  const salvar = cfBtn('Salvar alterações', 'pri', null, 'save'); salvar.disabled = true;
  bar.appendChild(l1); bar.appendChild(sd); bar.appendChild(salvar);
  const extra = el('div', 'cf-bar'), rest = cfBtn('Restaurar último backup', ''); rest.hidden = true;
  box.appendChild(bar); box.appendChild(area); box.appendChild(extra);
  const nSujo = () => Object.keys(cfe.alter).reduce((a, k) => a + Object.keys(cfe.alter[k].celulas).length, 0);
  const desenhar = () => {
    const d = cfe.dados; area.innerHTML = ''; salvar.disabled = !nSujo();
    if (!d.linhas.length) { area.appendChild(el('div', 'cf-vazio', 'Nenhum colaborador visível na escala.')); return; }
    const g = el('div', 'cf-esc'); area.appendChild(g);
    d.linhas.forEach(l => {
      const mud = cfe.alter[l.linha] && cfe.alter[l.linha].celulas[cfe.data] !== undefined, atual = mud ? cfe.alter[l.linha].celulas[cfe.data] : l.cods[cfe.data];
      const r = el('div', 'cf-row' + (mud ? ' sujo' : '')), m = el('div', 'cf-main'); m.appendChild(el('b', '', l.nome));
      if (l.semTecnico) m.appendChild(el('span', '', 'sem cadastro na aba Técnicos')); r.appendChild(m);
      const s = el('select', 'ctl'), id = 'esc_' + l.linha; s.id = id; s.setAttribute('aria-label', 'Código de ' + l.nome + ' em ' + rotEsc(cfe.data));
      [''].concat(d.codigos).forEach(c => { const o = el('option', '', c || '(vazio)'); o.value = c; s.appendChild(o); }); s.value = atual || '';
      s.onchange = () => {
        const a = cfe.alter[l.linha] || (cfe.alter[l.linha] = { versao: l.versao, celulas: {} });
        if (s.value === (l.cods[cfe.data] || '')) { delete a.celulas[cfe.data]; if (!Object.keys(a.celulas).length) delete cfe.alter[l.linha]; } else a.celulas[cfe.data] = s.value;
        r.classList.toggle('sujo', !!(cfe.alter[l.linha] && cfe.alter[l.linha].celulas[cfe.data] !== undefined)); salvar.disabled = !nSujo();
      };
      r.appendChild(s); g.appendChild(r);
    });
  };
  const carregar = () => comCarregando(area, async ativo => {
    const j = await postar('escala_listar', {}); if (!ativo()) return;
    cfe.dados = j; cfe.alter = {}; rest.hidden = !(eCoord() && j.backup);
    sd.innerHTML = ''; j.datas.slice().sort().forEach(iso => { const o = el('option', '', rotEsc(iso)); o.value = iso; sd.appendChild(o); });
    const h = hojeISO(); cfe.data = cfe.data && j.datas.indexOf(cfe.data) >= 0 ? cfe.data : (j.datas.slice().sort().find(x => x >= h) || j.datas[j.datas.length - 1] || '');
    sd.value = cfe.data;
    extra.innerHTML = '';
    if (j.podeAdicionar.length) {
      const ln = el('label', 'sr', 'Adicionar colaborador'); ln.htmlFor = 'esNovo'; ln.style.position = 'absolute'; ln.style.left = '-9999px';
      const ns = el('select', 'ctl'); ns.id = 'esNovo'; const o0 = el('option', '', 'Adicionar colaborador à escala…'); o0.value = ''; ns.appendChild(o0);
      j.podeAdicionar.forEach(n => { const o = el('option', '', n); o.value = n; ns.appendChild(o); });
      const ab = cfBtn('Adicionar', '', async () => {
        if (!ns.value) return;
        try { await postar('escala_novo', { nome: ns.value }); cfMsg('Colaborador adicionado à escala (sem códigos ainda).', 'ok'); carregar(); } catch (e) { cfMsg(msgErro(e), 'erro'); }
      }, 'plus');
      extra.appendChild(ln); extra.appendChild(ns); extra.appendChild(ab);
    }
    extra.appendChild(rest);
    if (!j.datas.length) { area.innerHTML = ''; area.appendChild(el('div', 'cf-vazio', 'A aba Escala_FDS não tem datas reconhecidas no cabeçalho.')); return; }
    desenhar();
  });
  sd.onchange = () => { cfe.data = sd.value; desenhar(); };
  salvar.onclick = async () => {
    const alteracoes = Object.keys(cfe.alter).map(k => ({ linha: Number(k), versao: cfe.alter[k].versao, celulas: cfe.alter[k].celulas }));
    salvar.disabled = true;
    try { const r = await postar('escala_salvar', { alteracoes: alteracoes }); cfMsg(r.semMudanca ? 'Nada mudou.' : 'Salvo.', 'ok'); carregar(); }
    catch (e) { cfMsg(msgErro(e), 'erro', conflito(e) ? cfRecarregarBtn(carregar) : null); salvar.disabled = !nSujo(); }
  };
  rest.onclick = async () => {
    if (!await confirmar({ titulo: 'Restaurar a aba Escala_FDS?', ok: 'Restaurar', perigo: true, texto: 'A aba volta ao conteúdo de antes da última mudança feita pelo sistema. Mudanças posteriores serão perdidas.' })) return;
    try { await postar('backup_restaurar', { aba: 'Escala_FDS' }); cfMsg('Backup restaurado.', 'ok'); carregar(); } catch (e) { cfMsg(msgErro(e), 'erro'); }
  };
  carregar();
}

/* ----- Prioridades (só adicionar e editar: apagar linha faria a prioridade deixar de ser contada) ----- */
const cfp = { busca: '', dados: null };
function cfPrio() {
  const box = $('cfBody'); box.innerHTML = '';
  box.appendChild(el('h2', 'cf-h', 'Prioridades'));
  box.appendChild(el('p', 'cf-sub', 'Uma linha por pedido. Só é possível adicionar e editar: apagar uma linha faria a prioridade deixar de ser contada.'));
  const bar = el('form', 'cf-bar'); bar.setAttribute('role', 'search');
  const lb = el('label', 'search'); lb.innerHTML = ic('search'); const inp = el('input'); inp.type = 'search'; inp.placeholder = 'Protocolo, solicitante ou justificativa'; inp.setAttribute('aria-label', 'Pesquisar prioridades'); inp.value = cfp.busca; inp.autocomplete = 'off'; lb.appendChild(inp);
  const bb = cfBtn('Buscar', ''); bb.type = 'submit'; const add = cfBtn('Adicionar', 'pri', null, 'plus'); const rest = cfBtn('Restaurar último backup', ''); rest.hidden = true;
  bar.appendChild(lb); bar.appendChild(bb); bar.appendChild(add); bar.appendChild(rest);
  const cont = el('div', 'cf-cont'); cont.setAttribute('aria-live', 'polite'); const lista = el('div', 'cf-prio');
  box.appendChild(bar); box.appendChild(cont); box.appendChild(lista);
  const desenhar = () => {
    const d = cfp.dados; lista.innerHTML = '';
    cont.textContent = d.total + ' pedido(s)' + (cfp.busca ? ' na busca' : '') + (d.mostrando < d.total ? '; mostrando os ' + d.mostrando + ' mais recentes (use a busca para os outros)' : '');
    if (!d.itens.length) { lista.appendChild(el('div', 'cf-vazio', 'Nenhum pedido encontrado.')); return; }
    d.itens.forEach(x => {
      const r = el('div', 'cf-row'), a = el('div', 'cf-main'); a.appendChild(el('b', '', x.protocolo || '(sem protocolo)')); a.appendChild(el('span', '', x.solicitante + (x.setor ? ' · ' + x.setor : ''))); r.appendChild(a);
      r.appendChild(el('div', 'cf-cel', x.justificativa || '—'));
      r.appendChild(el('div', 'cf-cel', x.dt ? x.dt.slice(8, 10) + '/' + x.dt.slice(5, 7) + '/' + x.dt.slice(0, 4) : ''));
      const ac = el('div', 'cf-acts'), ed = cfBtn('Editar', '', () => formPrio(x, d, carregar)); ed.setAttribute('aria-label', 'Editar pedido ' + (x.protocolo || '')); ac.appendChild(ed); r.appendChild(ac); lista.appendChild(r);
    });
  };
  const carregar = () => comCarregando(lista, async ativo => {
    const j = await postar('prio_listar', { busca: cfp.busca }); if (!ativo()) return; cfp.dados = j; rest.hidden = !(eCoord() && j.backup); desenhar();
  });
  bar.onsubmit = e => { e.preventDefault(); cfp.busca = inp.value.trim(); carregar(); };
  add.onclick = () => formPrio(null, cfp.dados, carregar);
  rest.onclick = async () => {
    if (!await confirmar({ titulo: 'Restaurar a aba Prioridades?', ok: 'Restaurar', perigo: true, texto: 'A aba volta ao conteúdo de antes da última mudança feita pelo sistema. Mudanças posteriores serão perdidas.' })) return;
    try { await postar('backup_restaurar', { aba: 'Prioridades' }); cfMsg('Backup restaurado.', 'ok'); carregar(); } catch (e) { cfMsg(msgErro(e), 'erro'); }
  };
  carregar();
}
function formPrio(x, d, recarregar) {
  const c = (d && d.colunas) || {}, campos = [{ k: 'protocolo', rot: 'Protocolo', obrig: true, tipo: 'text', modo: 'numeric', valor: x && /^\d+$/.test(x.protocolo) ? x.protocolo : '', max: 25, ajuda: 'Só dígitos (8 ou mais).' }];
  if (c.solicitante) campos.push({ k: 'solicitante', rot: 'Solicitante', tipo: 'text', valor: x ? x.solicitante : '', max: 120 });
  if (c.setor) campos.push({ k: 'setor', rot: 'Setor solicitante', tipo: 'text', valor: x ? x.setor : '', max: 120 });
  if (c.justificativa) campos.push({ k: 'justificativa', rot: 'Justificativa', tipo: 'text', valor: x ? x.justificativa : '', max: 300 });
  if (c.relato) campos.push({ k: 'relato', rot: 'Relato da justificativa', tipo: 'textarea', valor: x ? x.relato : '', max: 2000 });
  if (c.dt) campos.push({ k: 'dt', rot: 'Data do pedido', tipo: 'date', valor: x ? x.dt : isoMenos(0) });
  abrirForm({
    titulo: x ? 'Editar pedido de prioridade' : 'Novo pedido de prioridade', sub: x ? 'Protocolo ' + x.protocolo : 'Uma linha por pedido', campos: campos, onRecarregar: recarregar,
    onSalvar: async dados => {
      if (!/^\d{8,25}$/.test(dados.protocolo.trim())) throw new Error('O protocolo deve ter só dígitos (8 ou mais).');
      await postar('prio_salvar', { linha: x ? x.linha : 0, versao: x ? x.versao : '', dados: dados }); cfMsg('Salvo.', 'ok'); recarregar();
    }
  });
}

aplicarTema();
bnavAtualizar();
loginPreencher();
if (state.cred) {
  if (store.get(K.view, '') === 'blk') { document.body.classList.add('v-blk'); carregarBacklog(); }
  else carregar();
}

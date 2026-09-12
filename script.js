// Painel Administrativo Central — Torque (Incremento 2.2, frontend mínimo).
//
// Fala com o MESMO backend Supabase do site principal (config.js reusa a
// mesma URL pública e a mesma anon key) - a separação é só de frontend, não
// de banco. Todo acesso passa por RPCs SECURITY DEFINER que verificam, no
// próprio banco, se o usuário autenticado é administrador ativo da
// plataforma (public.administradores_plataforma) - este arquivo nunca
// decide sozinho quem é administrador, só reage ao que a RPC responde.
//
// Este painel NUNCA lista, busca ou linka dados operacionais de empresas
// clientes (clientes, veículos, ordens de serviço, financeiro etc.) - só
// gerencia autorizações de onboarding (public.autorizacoes_onboarding) e a
// própria sessão do administrador.
//
// Envio de convite (Supabase Auth "Invite user") continua manual até o
// Incremento 2.3 - este painel só registra a autorização no banco.

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TELAS = ['loginScreen', 'verificandoScreen', 'bloqueadoScreen', 'dashboardScreen'];
function mostrarTela(id){
  TELAS.forEach(t => document.getElementById(t).classList.toggle('hidden', t !== id));
}

const MENSAGENS_TRQ = {
  TRQ61: 'Sua sessão expirou. Atualize a página e faça login novamente.',
  TRQ62: 'Esta conta não tem (ou não tem mais) permissão de administrador da plataforma.',
  TRQ63: 'Dados inválidos. Confira o e-mail informado.',
  TRQ64: 'Autorização não encontrada ou já não está mais pendente (pode já ter sido consumida ou revogada).',
  TRQ65: 'Não foi possível concluir agora. Tente novamente em alguns segundos.'
};
// mapaExtra (opcional): sobrepõe o texto de um código TRQ específico para
// esta chamada - o mapa acima é compartilhado por todo o painel, e alguns
// códigos têm sentidos diferentes dependendo de quem chamou (ex.: TRQ63
// significa "e-mail inválido" no formulário de autorização, mas "parâmetro
// p_meses_serie inválido" na Visão Geral).
function mensagemErroRpc(erro, mapaExtra){
  const codigo = erro && erro.code;
  if(mapaExtra && codigo && mapaExtra[codigo]) return mapaExtra[codigo];
  return (codigo && MENSAGENS_TRQ[codigo]) || 'Não foi possível concluir a operação agora. Tente novamente.';
}

function formatarDataHora(iso){
  if(!iso) return '—';
  try{
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
  } catch(erro){
    return iso;
  }
}

let filtroAtual = 'pendente';
let carregandoLista = false;

async function sairDaConta(){
  try{ await sb.auth.signOut(); } catch(erro){ /* best-effort */ }
  location.reload();
}
document.getElementById('logoutBtn').addEventListener('click', sairDaConta);
document.getElementById('bloqueadoLogoutBtn').addEventListener('click', sairDaConta);

// ---------------- LOGIN ----------------

document.getElementById('loginForm').addEventListener('submit', async (evento)=>{
  evento.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const senha = document.getElementById('loginSenha').value;
  const erroEl = document.getElementById('loginError');
  erroEl.classList.add('hidden');

  if(!email || !senha){
    erroEl.textContent = 'Informe e-mail e senha.';
    erroEl.classList.remove('hidden');
    return;
  }

  const submitBtn = document.getElementById('loginSubmitBtn');
  submitBtn.disabled = true;
  try{
    const { error } = await sb.auth.signInWithPassword({ email, password: senha });
    if(error){
      erroEl.textContent = 'E-mail ou senha inválidos.';
      erroEl.classList.remove('hidden');
      return;
    }
    await verificarAdminEIniciar();
  } catch(erroInesperado){
    erroEl.textContent = 'Não foi possível entrar agora. Tente novamente.';
    erroEl.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
  }
});

// ---------------- VERIFICAÇÃO DE ADMINISTRADOR ----------------

async function verificarAdminEIniciar(){
  mostrarTela('verificandoScreen');

  const { data: userData } = await sb.auth.getUser();
  const user = (userData && userData.user) ? userData.user : null;
  if(!user){
    mostrarTela('loginScreen');
    return;
  }

  let ehAdmin = false;
  try{
    const { data: ehAdminRpc, error } = await sb.rpc('sou_administrador_plataforma');
    if(error) throw error;
    ehAdmin = ehAdminRpc === true;
  } catch(erro){
    ehAdmin = false;
  }

  if(!ehAdmin){
    // Bloqueio + logout: nunca deixa uma conta sem o papel administrativo
    // ver o painel, mesmo que a senha esteja correta.
    await sb.auth.signOut();
    mostrarTela('bloqueadoScreen');
    return;
  }

  document.getElementById('adminEmailLabel').textContent = user.email || '';
  document.getElementById('adminAvatar').textContent = (user.email || '?').trim().charAt(0).toUpperCase();
  mostrarTela('dashboardScreen');
  mostrarView('viewVisaoGeral');
  carregarVisaoGeral();
}

// ---------------- NAVEGAÇÃO ENTRE VIEWS (sem recarregar a página) ----------------

const VIEWS = ['viewVisaoGeral', 'viewOnboarding'];
let onboardingCarregado = false;

function mostrarView(nome){
  VIEWS.forEach(v => document.getElementById(v).classList.toggle('hidden', v !== nome));
  document.querySelectorAll('.nav-item[data-view]').forEach(botao=>{
    botao.classList.toggle('active', botao.dataset.view === nome);
  });

  // Onboarding só carrega na primeira vez que a view é aberta - a Visão
  // Geral é carregada uma única vez logo no login (ver
  // verificarAdminEIniciar), nunca a cada troca de aba.
  if(nome === 'viewOnboarding' && !onboardingCarregado){
    onboardingCarregado = true;
    aplicarFiltro('pendente');
  }
}

document.querySelectorAll('.nav-item[data-view]').forEach(botao=>{
  botao.addEventListener('click', ()=> mostrarView(botao.dataset.view));
});

// ---------------- VISÃO GERAL ----------------
//
// Chama admin_visao_geral_empresas UMA ÚNICA VEZ por sessão (ver
// visaoGeralCarregada abaixo) - trocar de view depois não repete a
// chamada. Só exibe dados reais retornados pela RPC: nenhum valor
// fictício, nenhum fallback numérico inventado, nenhum dado individual de
// empresa ou usuário.

let visaoGeralCarregada = false;

document.getElementById('vgTentarNovamenteBtn').addEventListener('click', ()=>{
  visaoGeralCarregada = false;
  carregarVisaoGeral();
});

async function carregarVisaoGeral(){
  if(visaoGeralCarregada) return;
  visaoGeralCarregada = true;

  const carregandoEl = document.getElementById('vgCarregando');
  const erroEl = document.getElementById('vgErro');
  const vaziaEl = document.getElementById('vgVazia');
  const conteudoEl = document.getElementById('vgConteudo');

  carregandoEl.classList.remove('hidden');
  erroEl.classList.add('hidden');
  vaziaEl.classList.add('hidden');
  conteudoEl.classList.add('hidden');

  try{
    const { data, error } = await sb.rpc('admin_visao_geral_empresas', { p_meses_serie: 12 });
    if(error) throw error;

    // jsonb retornado pelo PostgREST já chega como objeto JS - nenhum
    // JSON.parse manual necessário.
    if(!data || typeof data.total_empresas !== 'number' || data.total_empresas === 0){
      vaziaEl.classList.remove('hidden');
      return;
    }

    renderizarVisaoGeral(data);
    conteudoEl.classList.remove('hidden');
  } catch(erro){
    document.getElementById('vgErroTexto').textContent = mensagemErroRpc(erro, {
      TRQ63: 'Não foi possível carregar os indicadores agora. Tente novamente.'
    });
    erroEl.classList.remove('hidden');
    visaoGeralCarregada = false; // permite "Tentar novamente"
  } finally {
    carregandoEl.classList.add('hidden');
  }
}

// Soma o total de uma categoria pelo valor real (comparação sem
// diferenciar maiúsculas/minúsculas) - se a categoria não existir na
// resposta, o resultado é 0 (calculado a partir do array real, nunca um
// número inventado).
function totalPorValor(itens, valorAlvo){
  return (Array.isArray(itens) ? itens : [])
    .filter(item => String(item.valor).toLowerCase() === valorAlvo.toLowerCase())
    .reduce((soma, item) => soma + (Number(item.total) || 0), 0);
}

function renderizarVisaoGeral(resultado){
  const serieMeses = Array.isArray(resultado.novas_empresas_por_mes) ? resultado.novas_empresas_por_mes : [];
  const distribuicaoStatus = Array.isArray(resultado.distribuicao_status_assinatura) ? resultado.distribuicao_status_assinatura : [];
  const distribuicaoPlano = Array.isArray(resultado.distribuicao_plano) ? resultado.distribuicao_plano : [];

  const novasNoMesAtual = serieMeses.length > 0 ? (Number(serieMeses[serieMeses.length - 1].total) || 0) : 0;

  document.getElementById('vgStatTotalEmpresas').textContent = resultado.total_empresas;
  document.getElementById('vgStatNovasNoMes').textContent = novasNoMesAtual;
  document.getElementById('vgStatEmpresasAtivas').textContent = totalPorValor(distribuicaoStatus, 'ativo');
  document.getElementById('vgStatPlanoTeste').textContent = totalPorValor(distribuicaoPlano, 'teste');
  renderizarRodapeAtualizacao(resultado.gerado_em);

  renderizarGraficoMeses(serieMeses);
  renderizarDistribuicao('vgDistribuicaoStatus', distribuicaoStatus);
  renderizarDistribuicao('vgDistribuicaoPlano', distribuicaoPlano);
}

// "2026-09-11T22:00:00.000Z" -> "11/09/2026 às 19:00" (America/Sao_Paulo) -
// só formatação de exibição da mesma data real devolvida pela RPC.
function formatarDataHoraCompleta(iso){
  if(!iso) return '—';
  try{
    const data = new Date(iso);
    const dataFormatada = data.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const horaFormatada = data.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    return dataFormatada + ' às ' + horaFormatada;
  } catch(erro){
    return iso;
  }
}

// Icone estatico (sem dado dinamico interpolado) - seguro usar como HTML
// fixo; a data real sempre entra como textContent, nunca concatenada em
// HTML.
const ICONE_ATUALIZACAO_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>';

function renderizarRodapeAtualizacao(iso){
  const el = document.getElementById('vgGeradoEm');
  el.replaceChildren();
  el.insertAdjacentHTML('afterbegin', ICONE_ATUALIZACAO_SVG);
  const texto = document.createElement('span');
  texto.textContent = 'Atualizado em ' + formatarDataHoraCompleta(iso);
  el.appendChild(texto);
}

// "2026-09" -> "set/26" (só formatação de exibição do mesmo valor real
// devolvido pela RPC - não altera nem inventa o dado).
function formatarRotuloMes(mesAno){
  const partes = String(mesAno).split('-');
  if(partes.length !== 2) return mesAno;
  const data = new Date(Number(partes[0]), Number(partes[1]) - 1, 1);
  if(isNaN(data.getTime())) return mesAno;
  return data.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
}

// Calcula um teto "redondo" para o eixo Y a partir do maior valor real da
// série - nunca um número fixo. Ex.: maior valor 8 -> teto 10; maior valor
// 46 -> teto 50. Com todos os meses zerados (maior valor 0), usa 5 como
// teto neutro só para desenhar uma escala, nunca inventando dado de barra.
function calcularTetoEscala(maiorValor){
  if(maiorValor <= 0) return 5;
  const passo = Math.pow(10, Math.floor(Math.log10(maiorValor)));
  const candidatos = [1, 2, 5, 10].map(multiplicador => multiplicador * passo);
  for(const candidato of candidatos){
    if(candidato >= maiorValor) return candidato;
  }
  return candidatos[candidatos.length - 1] * 2;
}

// Eixo Y (6 rótulos: teto até 0) e as linhas horizontais pontilhadas (5
// linhas - a de "0" coincide com a base do gráfico, não precisa de linha
// própria). Ambos calculados a partir do MESMO teto da série real.
function renderizarEixoYEGrade(teto){
  const eixoEl = document.getElementById('vgEixoY');
  const linhasEl = document.getElementById('vgLinhas');
  eixoEl.replaceChildren();
  linhasEl.replaceChildren();

  const passos = 5;
  for(let i = passos; i >= 0; i--){
    const valor = Math.round((teto / passos) * i);
    const rotulo = document.createElement('span');
    rotulo.textContent = valor;
    eixoEl.appendChild(rotulo);

    if(i > 0){
      const linha = document.createElement('div');
      linha.className = 'linha';
      linha.style.top = (((passos - i) / passos) * 100) + '%';
      linhasEl.appendChild(linha);
    }
  }
}

function renderizarGraficoMeses(pontos){
  const container = document.getElementById('vgGraficoMeses');
  container.replaceChildren();

  if(pontos.length === 0){
    renderizarEixoYEGrade(5);
    const vazio = document.createElement('p');
    vazio.className = 'texto-secundario';
    vazio.textContent = 'Sem dados no período.';
    container.appendChild(vazio);
    return;
  }

  const maiorValor = pontos.reduce((maior, ponto)=> Math.max(maior, ponto.total), 0);
  const teto = calcularTetoEscala(maiorValor);
  renderizarEixoYEGrade(teto);

  pontos.forEach(ponto=>{
    const coluna = document.createElement('div');
    coluna.className = 'barra-mes';

    const valorEl = document.createElement('div');
    valorEl.className = 'barra-valor';
    valorEl.textContent = ponto.total;

    const trilhaEl = document.createElement('div');
    trilhaEl.className = 'barra-trilha';
    trilhaEl.title = ponto.mes + ': ' + ponto.total;
    // Mês com total=0 fica sem nenhuma barra dentro da trilha - nenhuma
    // barra artificial de altura mínima para "zero".
    if(ponto.total > 0){
      const barraEl = document.createElement('div');
      barraEl.className = 'barra';
      const alturaPercentual = teto > 0 ? (ponto.total / teto) * 100 : 0;
      barraEl.style.height = alturaPercentual + '%';
      trilhaEl.appendChild(barraEl);
    }

    const rotuloEl = document.createElement('div');
    rotuloEl.className = 'barra-rotulo';
    rotuloEl.textContent = formatarRotuloMes(ponto.mes);

    coluna.appendChild(valorEl);
    coluna.appendChild(trilhaEl);
    coluna.appendChild(rotuloEl);
    container.appendChild(coluna);
  });
}

// Paleta determinística por índice (posição no array já ordenado pela RPC
// por total DESC) - a categoria com mais empresas sempre recebe a primeira
// cor (laranja, igual à referência quando há só 1 categoria), e cada
// categoria seguinte recebe uma cor diferente e estável, mesmo que no
// futuro existam mais de 4 categorias.
const PALETA_DISTRIBUICAO = ['var(--accent)', 'var(--info)', 'var(--ok)', 'var(--danger)', '#B18CFF', '#2DD4BF'];
function corDaCategoria(indice){
  return PALETA_DISTRIBUICAO[indice % PALETA_DISTRIBUICAO.length];
}

// Gráfico de rosca (conic-gradient puro, sem biblioteca) + legenda com
// contagem e percentual - suporta 0, 1 ou várias categorias reais, sempre
// calculando o percentual a partir da própria soma dos itens (nunca do
// total_empresas geral, que pode divergir se a soma das categorias for
// diferente). Total 0 nunca gera divisão por zero, NaN ou dado inventado -
// mostra a rosca neutra e "Sem dados.".
function renderizarDistribuicao(containerId, itens){
  const container = document.getElementById(containerId);
  container.replaceChildren();

  const somaTotal = itens.reduce((soma, item)=> soma + (Number(item.total) || 0), 0);

  const roscaWrap = document.createElement('div');
  roscaWrap.className = 'rosca-wrap';
  const centro = document.createElement('div');
  centro.className = 'rosca-centro';
  const totalNum = document.createElement('div');
  totalNum.className = 'rosca-total-num';
  totalNum.textContent = somaTotal;
  const totalLabel = document.createElement('div');
  totalLabel.className = 'rosca-total-label';
  totalLabel.textContent = 'Total';
  centro.appendChild(totalNum);
  centro.appendChild(totalLabel);

  const legenda = document.createElement('div');
  legenda.className = 'legenda-distribuicao';

  if(itens.length === 0 || somaTotal === 0){
    roscaWrap.style.background = 'var(--surface-2)';
    roscaWrap.appendChild(centro);
    const vazio = document.createElement('p');
    vazio.className = 'texto-secundario';
    vazio.textContent = 'Sem dados.';
    legenda.appendChild(vazio);
    container.appendChild(roscaWrap);
    container.appendChild(legenda);
    return;
  }

  let acumulado = 0;
  const fatias = itens.map((item, indice)=>{
    const total = Number(item.total) || 0;
    const percentual = (total / somaTotal) * 100;
    const inicio = acumulado;
    acumulado += percentual;
    return { valor: item.valor, total: total, percentual: percentual, cor: corDaCategoria(indice), inicio: inicio, fim: acumulado };
  });

  roscaWrap.style.background = 'conic-gradient(' +
    fatias.map(f => f.cor + ' ' + f.inicio + '% ' + f.fim + '%').join(', ') +
  ')';
  roscaWrap.appendChild(centro);

  fatias.forEach(fatia=>{
    const linha = document.createElement('div');
    linha.className = 'legenda-linha';

    const ponto = document.createElement('span');
    ponto.className = 'legenda-ponto';
    ponto.style.background = fatia.cor;

    const categoria = document.createElement('span');
    categoria.className = 'legenda-categoria';
    categoria.textContent = fatia.valor;
    categoria.title = fatia.valor;

    const barra = document.createElement('span');
    barra.className = 'legenda-barra';
    const preenchimento = document.createElement('span');
    preenchimento.className = 'legenda-barra-preenchimento';
    preenchimento.style.width = fatia.percentual + '%';
    preenchimento.style.background = fatia.cor;
    barra.appendChild(preenchimento);

    const numeros = document.createElement('span');
    numeros.className = 'legenda-numeros';
    const totalSpan = document.createElement('span');
    totalSpan.className = 'legenda-total';
    totalSpan.textContent = fatia.total;
    const percentualSpan = document.createElement('span');
    percentualSpan.className = 'legenda-percentual';
    percentualSpan.textContent = Math.round(fatia.percentual) + '%';
    numeros.appendChild(totalSpan);
    numeros.appendChild(percentualSpan);

    linha.appendChild(ponto);
    linha.appendChild(categoria);
    linha.appendChild(barra);
    linha.appendChild(numeros);
    legenda.appendChild(linha);
  });

  container.appendChild(roscaWrap);
  container.appendChild(legenda);
}

// ---------------- LISTAGEM E FILTROS ----------------

document.getElementById('filtros').addEventListener('click', (evento)=>{
  const botao = evento.target.closest('.filtro-btn');
  if(!botao) return;
  aplicarFiltro(botao.dataset.filtro);
});

function aplicarFiltro(filtro){
  filtroAtual = filtro;
  document.querySelectorAll('.filtro-btn').forEach(botao=>{
    botao.classList.toggle('ativo', botao.dataset.filtro === filtro);
  });
  carregarLista(filtro);
}

async function carregarLista(filtro){
  if(carregandoLista) return;
  carregandoLista = true;

  const carregandoEl = document.getElementById('listaCarregando');
  const erroEl = document.getElementById('listaErro');
  const vaziaEl = document.getElementById('listaVazia');
  const tabelaEl = document.getElementById('listaTabela');

  carregandoEl.classList.remove('hidden');
  erroEl.classList.add('hidden');
  vaziaEl.classList.add('hidden');
  tabelaEl.classList.add('hidden');

  try{
    // Sempre busca o histórico completo (p_apenas_pendentes=false) - os
    // indicadores (Pendentes/Consumidas/Expiradas/Revogadas) são calculados
    // a partir deste MESMO retorno, sem nenhuma RPC adicional. Filtrar
    // 'pendente' aqui por situacao === 'pendente' é equivalente ao que a
    // RPC faria com p_apenas_pendentes=true (mesma condição: consumido_em e
    // revogado_em nulos e expira_em > now()), então não há necessidade de
    // uma segunda chamada só para esse filtro.
    const { data, error } = await sb.rpc('admin_listar_autorizacoes_onboarding', {
      p_apenas_pendentes: false
    });
    if(error) throw error;

    const todasAsLinhas = Array.isArray(data) ? data : [];
    atualizarIndicadores(todasAsLinhas);

    const linhas = filtro === 'todas'
      ? todasAsLinhas
      : todasAsLinhas.filter(linha => linha.situacao === filtro);

    if(linhas.length === 0){
      vaziaEl.classList.remove('hidden');
      return;
    }

    renderizarTabela(linhas);
    tabelaEl.classList.remove('hidden');
  } catch(erro){
    erroEl.textContent = mensagemErroRpc(erro);
    erroEl.classList.remove('hidden');
  } finally {
    carregandoEl.classList.add('hidden');
    carregandoLista = false;
  }
}

const SITUACAO_LABEL = {
  pendente: 'Pendente',
  consumida: 'Utilizada',
  expirada: 'Expirada',
  revogada: 'Revogada'
};

// Indicadores compactos - calculados aqui a partir do MESMO array já
// retornado por admin_listar_autorizacoes_onboarding (histórico completo),
// nunca por uma RPC própria e nunca a partir de dado operacional de empresa.
function atualizarIndicadores(linhas){
  const contagem = { pendente: 0, consumida: 0, expirada: 0, revogada: 0 };
  linhas.forEach(linha=>{
    if(contagem.hasOwnProperty(linha.situacao)) contagem[linha.situacao]++;
  });
  document.getElementById('statPendentes').textContent = contagem.pendente;
  document.getElementById('statConsumidas').textContent = contagem.consumida;
  document.getElementById('statExpiradas').textContent = contagem.expirada;
  document.getElementById('statRevogadas').textContent = contagem.revogada;
}

function renderizarTabela(linhas){
  const corpo = document.getElementById('listaTabelaBody');
  corpo.replaceChildren();

  linhas.forEach(linha=>{
    const tr = document.createElement('tr');

    const tdEmail = document.createElement('td');
    tdEmail.className = 'col-email-valor';
    tdEmail.dataset.label = 'E-mail';
    tdEmail.textContent = linha.email;
    tr.appendChild(tdEmail);

    const tdSituacao = document.createElement('td');
    tdSituacao.dataset.label = 'Situação';
    const badge = document.createElement('span');
    badge.className = 'situacao-badge situacao-' + linha.situacao;
    badge.textContent = SITUACAO_LABEL[linha.situacao] || linha.situacao;
    tdSituacao.appendChild(badge);
    tr.appendChild(tdSituacao);

    const tdAutorizado = document.createElement('td');
    tdAutorizado.className = 'col-data-valor';
    tdAutorizado.dataset.label = 'Autorizado';
    tdAutorizado.textContent = formatarDataHora(linha.autorizado_em);
    tr.appendChild(tdAutorizado);

    const tdExpira = document.createElement('td');
    tdExpira.className = 'col-data-valor';
    tdExpira.dataset.label = 'Expira';
    tdExpira.textContent = formatarDataHora(linha.expira_em);
    tr.appendChild(tdExpira);

    const tdConsumido = document.createElement('td');
    tdConsumido.className = 'col-data-valor';
    tdConsumido.dataset.label = 'Utilizado';
    tdConsumido.textContent = formatarDataHora(linha.consumido_em);
    tr.appendChild(tdConsumido);

    const tdRevogado = document.createElement('td');
    tdRevogado.className = 'col-data-valor';
    tdRevogado.dataset.label = 'Revogado';
    tdRevogado.textContent = formatarDataHora(linha.revogado_em);
    tr.appendChild(tdRevogado);

    const tdAcao = document.createElement('td');
    tdAcao.className = 'col-acao-valor';
    tdAcao.dataset.label = 'Ação';
    if(linha.situacao === 'pendente'){
      const btnRevogar = document.createElement('button');
      btnRevogar.type = 'button';
      btnRevogar.className = 'btn btn-perigo btn-sm';
      btnRevogar.textContent = 'Revogar';
      btnRevogar.dataset.id = linha.id;
      btnRevogar.dataset.email = linha.email;
      tdAcao.appendChild(btnRevogar);
    } else {
      tdAcao.textContent = '—';
    }
    tr.appendChild(tdAcao);

    corpo.appendChild(tr);
  });
}

document.getElementById('listaTabelaBody').addEventListener('click', async (evento)=>{
  const botao = evento.target.closest('button[data-id]');
  if(!botao) return;

  const confirmado = window.confirm(
    'Revogar a autorização pendente de "' + botao.dataset.email + '"?\n\nEsta ação não pode ser desfeita - se precisar autorizar este e-mail de novo depois, será uma nova autorização.'
  );
  if(!confirmado) return;

  const mensagemEl = document.getElementById('acaoMensagem');
  mensagemEl.classList.add('hidden');
  botao.disabled = true;

  try{
    const { error } = await sb.rpc('admin_revogar_autorizacao_onboarding', {
      p_autorizacao_id: botao.dataset.id
    });
    if(error) throw error;

    mensagemEl.textContent = 'Autorização de "' + botao.dataset.email + '" revogada.';
    mensagemEl.className = 'mensagem mensagem-sucesso';
    mensagemEl.classList.remove('hidden');
    carregarLista(filtroAtual);
  } catch(erro){
    mensagemEl.textContent = mensagemErroRpc(erro);
    mensagemEl.className = 'mensagem mensagem-erro';
    mensagemEl.classList.remove('hidden');
    botao.disabled = false;
  }
});

// ---------------- AUTORIZAR / RENOVAR ----------------

document.getElementById('autorizarForm').addEventListener('submit', async (evento)=>{
  evento.preventDefault();

  const emailInput = document.getElementById('autorizarEmail');
  const email = emailInput.value.trim();
  const mensagemEl = document.getElementById('autorizarMensagem');
  mensagemEl.classList.add('hidden');

  if(!email){
    mensagemEl.textContent = 'Informe um e-mail.';
    mensagemEl.className = 'mensagem mensagem-erro';
    mensagemEl.classList.remove('hidden');
    return;
  }

  const submitBtn = document.getElementById('autorizarSubmitBtn');
  submitBtn.disabled = true;

  try{
    // p_horas_validade não é informado de propósito - usa o padrão de 72
    // horas da RPC (decisão já tomada: validade padrão de 72 horas).
    const { data, error } = await sb.rpc('admin_autorizar_onboarding', { p_email: email });
    if(error) throw error;

    const resultado = Array.isArray(data) ? data[0] : data;
    const validaAte = resultado ? formatarDataHora(resultado.expira_em) : '—';
    const renovada = !!(resultado && resultado.renovada);

    mensagemEl.textContent = (renovada ? 'Autorização renovada' : 'Autorização criada') +
      ' para "' + email + '", válida até ' + validaAte + '. Envie o convite manualmente pelo Supabase (Authentication → Invite user).';
    mensagemEl.className = 'mensagem mensagem-sucesso';
    mensagemEl.classList.remove('hidden');

    emailInput.value = '';
    aplicarFiltro('pendente');
  } catch(erro){
    mensagemEl.textContent = mensagemErroRpc(erro);
    mensagemEl.className = 'mensagem mensagem-erro';
    mensagemEl.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
  }
});

// ---------------- BOOT ----------------

(async function iniciar(){
  const { data } = await sb.auth.getSession();
  if(data && data.session){
    await verificarAdminEIniciar();
  } else {
    mostrarTela('loginScreen');
  }
})();

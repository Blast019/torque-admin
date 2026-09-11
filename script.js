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
function mensagemErroRpc(erro){
  const codigo = erro && erro.code;
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
  mostrarTela('dashboardScreen');
  aplicarFiltro('pendente');
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
  consumida: 'Consumida',
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
    tdConsumido.dataset.label = 'Consumido';
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

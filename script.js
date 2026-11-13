// ============================================================
// DADOS DE CONFIGURAÇÃO
// No OpenStack real, essas listas vêm de serviços diferentes:
// as imagens ficam no Glance e os flavors (tamanhos de VM) no Nova.
// ============================================================

// Imagens de sistema operacional disponíveis (o que o Glance guardaria).
const availableImages = [
  { imageId: 'cirros', displayName: 'CirrOS 0.6', sizeLabel: '20 MB', note: 'mínima, para testes' },
  { imageId: 'ubuntu', displayName: 'Ubuntu 24.04', sizeLabel: '600 MB', note: 'servidor Linux' },
  { imageId: 'debian', displayName: 'Debian 12', sizeLabel: '400 MB', note: 'servidor Linux' }
];

// Flavors: "tamanhos" pré-definidos de VM. O usuário não escolhe CPU e RAM
// soltos; escolhe um pacote, como na AWS (t2.micro, t2.small...).
const availableFlavors = [
  { flavorId: 'm1.tiny', virtualCpus: 1, memoryMegabytes: 512, diskGigabytes: 1 },
  { flavorId: 'm1.small', virtualCpus: 1, memoryMegabytes: 2048, diskGigabytes: 20 },
  { flavorId: 'm1.medium', virtualCpus: 2, memoryMegabytes: 4096, diskGigabytes: 40 },
  { flavorId: 'm1.large', virtualCpus: 4, memoryMegabytes: 8192, diskGigabytes: 80 }
];

// Os serviços que aparecem na coluna "Bastidores", na ordem em que agem.
// O RabbitMQ não é um projeto do OpenStack, mas é a fila de mensagens
// que os serviços usam para conversar internamente.
const pipelineServices = [
  { serviceKey: 'horizon', label: 'Horizon', role: 'painel web' },
  { serviceKey: 'keystone', label: 'Keystone', role: 'identidade' },
  { serviceKey: 'nova', label: 'Nova', role: 'computação' },
  { serviceKey: 'rabbitmq', label: 'RabbitMQ', role: 'fila de mensagens' },
  { serviceKey: 'glance', label: 'Glance', role: 'imagens' },
  { serviceKey: 'neutron', label: 'Neutron', role: 'rede' },
  { serviceKey: 'cinder', label: 'Cinder', role: 'discos' },
  { serviceKey: 'kvm', label: 'KVM', role: 'hypervisor' }
];

// Uma cor por serviço no log, para a plateia distinguir quem está falando.
const serviceLogColors = {
  horizon: '#f4f2ee', keystone: '#f2c14e', nova: '#f08a5d', rabbitmq: '#c792ea',
  glance: '#7fd1b9', neutron: '#6cb6ff', cinder: '#ff9ea8', kvm: '#a3e635'
};

// Cota do projeto: o limite que o administrador da nuvem define para cada
// equipe. No OpenStack real isso é configurado por projeto no Nova/Keystone.
const projectQuota = { maximumInstances: 15, maximumVirtualCpus: 40, maximumMemoryMegabytes: 81920 };

// ============================================================
// ESTADO DA SIMULAÇÃO
// Tudo o que a "nuvem" sabe fica neste objeto. As telas são sempre
// redesenhadas a partir dele, então ele é a única fonte da verdade.
// ============================================================
const simulationState = {
  isLoggedIn: false,
  isOperationRunning: false,
  currentView: 'overview',
  speedMultiplier: 2.2,
  nextIpSuffix: 11,
  nextHostNumber: 4,
  highlightedHostName: null,
  newestHostName: null,
  selectedImageId: 'cirros',
  selectedFlavorId: 'm1.tiny',
  computeHosts: [
    { hostName: 'compute-01', totalVirtualCpus: 4, totalMemoryMegabytes: 8192 },
    { hostName: 'compute-02', totalVirtualCpus: 4, totalMemoryMegabytes: 8192 },
    { hostName: 'compute-03', totalVirtualCpus: 2, totalMemoryMegabytes: 4096 }
  ],
  instances: [
    { instanceName: 'servidor-web', imageName: 'Ubuntu 24.04', flavorId: 'm1.medium', ipAddress: '10.0.0.10', hostName: 'compute-01', status: 'active', hasExtraVolume: false }
  ]
};

// Referências aos elementos da página que o script altera com frequência.
const mainArea = document.getElementById('mainArea');
const logPanel = document.getElementById('logPanel');
const servicePipelineElement = document.getElementById('servicePipeline');
const createModal = document.getElementById('createModal');

// ============================================================
// FUNÇÕES DE CÁLCULO
// ============================================================

function findFlavor(flavorId) {
  return availableFlavors.find(flavor => flavor.flavorId === flavorId);
}

// Soma quanta CPU e memória as VMs de um servidor físico estão usando.
// É o que o serviço Placement do OpenStack acompanha para o Nova saber
// onde ainda cabe uma VM nova.
function calculateHostUsage(hostName) {
  const instancesOnHost = simulationState.instances.filter(instance => instance.hostName === hostName && instance.status !== 'deleting-done');
  return instancesOnHost.reduce((usageTotals, instance) => {
    const flavor = findFlavor(instance.flavorId);
    usageTotals.usedVirtualCpus += flavor.virtualCpus;
    usageTotals.usedMemoryMegabytes += flavor.memoryMegabytes;
    return usageTotals;
  }, { usedVirtualCpus: 0, usedMemoryMegabytes: 0 });
}

// Soma o uso do projeto inteiro, para comparar com a cota.
function calculateProjectUsage() {
  return simulationState.instances.reduce((usageTotals, instance) => {
    const flavor = findFlavor(instance.flavorId);
    usageTotals.instanceCount += 1;
    usageTotals.usedVirtualCpus += flavor.virtualCpus;
    usageTotals.usedMemoryMegabytes += flavor.memoryMegabytes;
    return usageTotals;
  }, { instanceCount: 0, usedVirtualCpus: 0, usedMemoryMegabytes: 0 });
}

// Converte MB em um texto legível: 512 MB, 2 GB, 1.5 GB.
function formatMemory(memoryMegabytes) {
  return memoryMegabytes >= 1024 ? (memoryMegabytes / 1024).toFixed(memoryMegabytes % 1024 === 0 ? 0 : 1) + ' GB' : memoryMegabytes + ' MB';
}

// ============================================================
// LOG E ANIMAÇÃO DOS BASTIDORES
// ============================================================

// Cria uma pausa. Usada com "await" para os passos acontecerem um de cada
// vez, em vez de todos de uma vez. O multiplicador vem do seletor de
// velocidade (Normal, Lenta, Rápida).
function waitForStep(baseMilliseconds) {
  return new Promise(resolve => setTimeout(resolve, baseMilliseconds * simulationState.speedMultiplier));
}

function currentTimeLabel() {
  return new Date().toLocaleTimeString('pt-BR');
}

// Escreve uma linha no log: a mensagem técnica (parecida com a do
// OpenStack real) e, embaixo, uma explicação em português simples.
function writeLog(serviceKey, technicalMessage, plainExplanation) {
  const logLine = document.createElement('div');
  logLine.className = 'log-line';
  const serviceColor = serviceLogColors[serviceKey] || '#f4f2ee';
  logLine.innerHTML = '<span class="log-time">' + currentTimeLabel() + '</span> '
    + '<span class="log-service" style="color:' + serviceColor + '">[' + serviceKey + ']</span> '
    + escapeHtml(technicalMessage)
    + (plainExplanation ? '<span class="log-explain">↳ ' + escapeHtml(plainExplanation) + '</span>' : '');
  logPanel.appendChild(logLine);
  logPanel.scrollTop = logPanel.scrollHeight;
}

// Impede que um texto digitado pelo usuário (como o nome da VM) seja
// interpretado como HTML. Sem isso, um nome como "<b>x</b>" quebraria a tela.
function escapeHtml(rawText) {
  return rawText.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function renderPipeline() {
  servicePipelineElement.innerHTML = pipelineServices.map(service =>
    '<div class="service-node" id="node-' + service.serviceKey + '"><strong>' + service.label + '</strong><small>' + service.role + '</small></div>'
  ).join('');
}

// Muda a aparência de um serviço: trabalhando (laranja), concluído (azul) ou parado.
function setServiceState(serviceKey, nodeState) {
  const serviceNode = document.getElementById('node-' + serviceKey);
  if (!serviceNode) return;
  serviceNode.classList.remove('is-working', 'is-done');
  if (nodeState) serviceNode.classList.add(nodeState);
}

function resetPipeline() {
  pipelineServices.forEach(service => setServiceState(service.serviceKey, null));
}

// Um "passo" completo: acende o serviço, escreve no log, espera e marca
// como concluído. Todas as operações são montadas encadeando esses passos.
async function runServiceStep(serviceKey, technicalMessage, plainExplanation, durationMilliseconds) {
  setServiceState(serviceKey, 'is-working');
  writeLog(serviceKey, technicalMessage, plainExplanation);
  await waitForStep(durationMilliseconds);
  setServiceState(serviceKey, 'is-done');
}

function showToast(message, isError) {
  const toastElement = document.getElementById('toast');
  toastElement.textContent = message;
  toastElement.classList.toggle('is-error', Boolean(isError));
  toastElement.classList.add('is-visible');
  clearTimeout(showToast.hideTimer);
  showToast.hideTimer = setTimeout(() => toastElement.classList.remove('is-visible'), 3200);
}

// ============================================================
// TELAS
// Cada função desenha uma tela inteira a partir do simulationState.
// ============================================================

// Barra de uso. Fica laranja quando passa de 80%, como alerta.
function renderUsageBar(usedAmount, totalAmount) {
  const usagePercentage = totalAmount === 0 ? 0 : Math.min(100, Math.round((usedAmount / totalAmount) * 100));
  return '<div class="usage-bar"><div class="usage-bar-fill' + (usagePercentage >= 80 ? ' is-high' : '') + '" style="width:' + usagePercentage + '%"></div></div>';
}

function renderLoginScreen() {
  mainArea.innerHTML = `
    <div class="login-screen">
      <div class="card login-card">
        <div class="brand-mark" style="margin:0 auto;width:52px;height:52px;font-size:20px">OS</div>
        <h2>Entrar na nuvem</h2>
        <p>Antes de qualquer coisa, o <b>Keystone</b> precisa confirmar quem você é e em qual projeto vai trabalhar.</p>
        <div class="login-detail">
          <div><span>Usuário</span><b>aluno</b></div>
          <div><span>Projeto</span><b>turma-a</b></div>
          <div><span>Domínio</span><b>Default</b></div>
        </div>
        <button class="primary-button" id="loginButton" style="width:100%">Entrar</button>
      </div>
    </div>`;
  document.getElementById('loginButton').addEventListener('click', performLogin);
}

// Login: no OpenStack real, todo uso começa pedindo um token ao Keystone.
// Esse token acompanha cada pedido seguinte, como um crachá temporário.
async function performLogin() {
  if (simulationState.isOperationRunning) return;
  simulationState.isOperationRunning = true;
  document.getElementById('loginButton').disabled = true;
  resetPipeline();
  await runServiceStep('horizon', 'Enviando credenciais do usuário "aluno"', 'O painel repassa o login para o serviço de identidade.', 700);
  await runServiceStep('keystone', 'POST /v3/auth/tokens → 201 Created', 'Senha conferida. O Keystone emite um token, um "crachá" temporário.', 1100);
  writeLog('keystone', 'Token válido por 1h, projeto turma-a, papel member', 'Todo pedido daqui pra frente leva esse token junto.');
  simulationState.isLoggedIn = true;
  simulationState.isOperationRunning = false;
  document.getElementById('sessionLabel').textContent = 'Usuário: aluno | Projeto: turma-a';
  showToast('Conectado. O Keystone emitiu o token.');
  renderCurrentView();
}

function renderOverview() {
  const projectUsage = calculateProjectUsage();
  mainArea.innerHTML = `
    <div class="page-header">
      <div><h2>Visão geral</h2><p>Quanto do limite do projeto turma-a já está em uso</p></div>
      <button class="primary-button" id="openCreateFromOverview">+ Criar instância</button>
    </div>
    <div class="quota-grid">
      <div class="card"><div class="quota-title">Instâncias</div><div class="quota-value">${projectUsage.instanceCount} <span>de ${projectQuota.maximumInstances}</span></div>${renderUsageBar(projectUsage.instanceCount, projectQuota.maximumInstances)}</div>
      <div class="card"><div class="quota-title">vCPUs</div><div class="quota-value">${projectUsage.usedVirtualCpus} <span>de ${projectQuota.maximumVirtualCpus}</span></div>${renderUsageBar(projectUsage.usedVirtualCpus, projectQuota.maximumVirtualCpus)}</div>
      <div class="card"><div class="quota-title">Memória RAM</div><div class="quota-value">${formatMemory(projectUsage.usedMemoryMegabytes)} <span>de ${formatMemory(projectQuota.maximumMemoryMegabytes)}</span></div>${renderUsageBar(projectUsage.usedMemoryMegabytes, projectQuota.maximumMemoryMegabytes)}</div>
    </div>
    <div class="card">
      <h3 style="font-size:18px;margin-bottom:8px">Como usar esta demonstração</h3>
      <ol style="margin:0;padding-left:20px;line-height:1.8;color:#3d4a5c">
        <li>Clique em <b>Criar instância</b>, escolha imagem e tamanho e confirme.</li>
        <li>Acompanhe na coluna escura cada serviço do OpenStack agindo, em ordem.</li>
        <li>Abra <b>Servidores físicos</b> para ver em qual máquina a VM foi parar.</li>
        <li>Crie VMs grandes até a nuvem lotar e depois clique em <b>Adicionar servidor físico</b>: é a escala horizontal.</li>
      </ol>
    </div>`;
  document.getElementById('openCreateFromOverview').addEventListener('click', openCreateModal);
}

function renderInstanceStatus(instanceStatus) {
  if (instanceStatus === 'active') return '<span class="status-pill is-active"><span class="status-dot"></span>Ativa</span>';
  if (instanceStatus === 'building') return '<span class="status-pill is-building"><span class="status-dot"></span>Construindo</span>';
  return '<span class="status-pill is-deleting"><span class="status-dot"></span>Excluindo</span>';
}

function renderInstances() {
  const instanceRows = simulationState.instances.map(instance => `
    <tr>
      <td><b>${escapeHtml(instance.instanceName)}</b></td>
      <td>${instance.imageName}<span class="cell-detail mono">${instance.flavorId}</span></td>
      <td class="mono">${instance.ipAddress || '...'}<span class="cell-detail">${instance.hostName || 'aguardando scheduler'}</span></td>
      <td>${renderInstanceStatus(instance.status)}</td>
      <td class="cell-action"><button class="danger-button" data-delete="${escapeHtml(instance.instanceName)}" ${instance.status !== 'active' || simulationState.isOperationRunning ? 'disabled' : ''}>Excluir</button></td>
    </tr>`).join('');
  mainArea.innerHTML = `
    <div class="page-header">
      <div><h2>Instâncias</h2><p>Máquinas virtuais do projeto turma-a</p></div>
      <button class="primary-button" id="openCreateFromInstances" ${simulationState.isOperationRunning ? 'disabled' : ''}>+ Criar instância</button>
    </div>
    <div class="card table-card">
      <table>
        <tr><th>Nome</th><th>Imagem / Flavor</th><th>IP / Servidor físico</th><th>Status</th><th></th></tr>
        ${instanceRows || '<tr><td colspan="5" class="empty-row">Nenhuma instância. Crie a primeira!</td></tr>'}
      </table>
    </div>`;
  document.getElementById('openCreateFromInstances').addEventListener('click', openCreateModal);
  mainArea.querySelectorAll('[data-delete]').forEach(deleteButton => {
    deleteButton.addEventListener('click', () => deleteInstance(deleteButton.dataset.delete));
  });
}

function renderHosts() {
  const hostCards = simulationState.computeHosts.map(computeHost => {
    const hostUsage = calculateHostUsage(computeHost.hostName);
    const instancesOnHost = simulationState.instances.filter(instance => instance.hostName === computeHost.hostName);
    const cardClasses = ['card', 'host-card'];
    if (simulationState.highlightedHostName === computeHost.hostName) cardClasses.push('is-chosen');
    if (simulationState.newestHostName === computeHost.hostName) cardClasses.push('is-new');
    return `
      <div class="${cardClasses.join(' ')}">
        <div class="host-name"><h3>${computeHost.hostName}</h3><span class="host-tag">KVM</span></div>
        <div class="host-metric"><span>vCPUs</span><span>${hostUsage.usedVirtualCpus} / ${computeHost.totalVirtualCpus}</span></div>
        ${renderUsageBar(hostUsage.usedVirtualCpus, computeHost.totalVirtualCpus)}
        <div class="host-metric"><span>Memória</span><span>${formatMemory(hostUsage.usedMemoryMegabytes)} / ${formatMemory(computeHost.totalMemoryMegabytes)}</span></div>
        ${renderUsageBar(hostUsage.usedMemoryMegabytes, computeHost.totalMemoryMegabytes)}
        <div class="host-vm-list">${instancesOnHost.map(instance => '<span class="host-vm-chip">' + escapeHtml(instance.instanceName) + '</span>').join('') || '<span style="font-size:12px;color:#6b7484">sem VMs</span>'}</div>
      </div>`;
  }).join('');
  mainArea.innerHTML = `
    <div class="page-header">
      <div><h2>Servidores físicos</h2><p>As máquinas reais onde as VMs rodam. O usuário comum nem vê esta tela.</p></div>
      <button class="primary-button" id="addHostButton" ${simulationState.isOperationRunning ? 'disabled' : ''}>+ Adicionar servidor físico</button>
    </div>
    <div class="host-grid">${hostCards}</div>
    <div class="explain-box"><b>Escala horizontal:</b> quando a nuvem lota, a empresa não troca o servidor por um maior. Ela coloca mais um servidor no conjunto e o Nova passa a usá-lo automaticamente.</div>`;
  document.getElementById('addHostButton').addEventListener('click', addComputeHost);
}

// Decide qual tela desenhar. Sem login, sempre mostra a tela de entrada,
// porque sem token do Keystone nada funciona.
function renderCurrentView() {
  document.querySelectorAll('.nav-button').forEach(navButton => {
    navButton.classList.toggle('is-active', navButton.dataset.view === simulationState.currentView);
  });
  if (!simulationState.isLoggedIn) { renderLoginScreen(); return; }
  if (simulationState.currentView === 'overview') renderOverview();
  if (simulationState.currentView === 'instances') renderInstances();
  if (simulationState.currentView === 'hosts') renderHosts();
}

// ============================================================
// FORMULÁRIO DE CRIAÇÃO
// ============================================================

function renderOptionCards() {
  document.getElementById('imageOptions').innerHTML = availableImages.map(image =>
    '<button type="button" class="option-card' + (image.imageId === simulationState.selectedImageId ? ' is-selected' : '') + '" data-image="' + image.imageId + '"><strong>' + image.displayName + '</strong><span>' + image.sizeLabel + ' - ' + image.note + '</span></button>'
  ).join('');
  document.getElementById('flavorOptions').style.gridTemplateColumns = 'repeat(4, 1fr)';
  document.getElementById('flavorOptions').innerHTML = availableFlavors.map(flavor =>
    '<button type="button" class="option-card' + (flavor.flavorId === simulationState.selectedFlavorId ? ' is-selected' : '') + '" data-flavor="' + flavor.flavorId + '"><strong>' + flavor.flavorId + '</strong><span>' + flavor.virtualCpus + ' vCPU, ' + formatMemory(flavor.memoryMegabytes) + '</span></button>'
  ).join('');
  document.querySelectorAll('[data-image]').forEach(imageButton => imageButton.addEventListener('click', () => {
    simulationState.selectedImageId = imageButton.dataset.image; renderOptionCards();
  }));
  document.querySelectorAll('[data-flavor]').forEach(flavorButton => flavorButton.addEventListener('click', () => {
    simulationState.selectedFlavorId = flavorButton.dataset.flavor; renderOptionCards();
  }));
}

function openCreateModal() {
  if (simulationState.isOperationRunning) return;
  const suggestedNumber = simulationState.instances.length + 1;
  document.getElementById('instanceNameInput').value = 'vm-demo-' + suggestedNumber;
  document.getElementById('nameError').style.display = 'none';
  document.getElementById('volumeCheckbox').checked = false;
  renderOptionCards();
  createModal.classList.add('is-open');
  document.getElementById('instanceNameInput').focus();
}

function closeCreateModal() {
  createModal.classList.remove('is-open');
}

// ============================================================
// AGENDADOR (a parte mais parecida com o OpenStack real)
// Imita o nova-scheduler, que trabalha em duas etapas:
//   1. Filtragem: descarta os servidores sem CPU ou RAM livres suficientes.
//   2. Pesagem: entre os que sobraram, escolhe o de mais memória livre
//      (no OpenStack real isso é o "RAM weigher").
// Se nenhum servidor passa no filtro, o real responde "No valid host was found".
// ============================================================
function chooseHostWithScheduler(requiredFlavor) {
  const eligibleHosts = simulationState.computeHosts.filter(computeHost => {
    const hostUsage = calculateHostUsage(computeHost.hostName);
    const hasEnoughCpu = computeHost.totalVirtualCpus - hostUsage.usedVirtualCpus >= requiredFlavor.virtualCpus;
    const hasEnoughMemory = computeHost.totalMemoryMegabytes - hostUsage.usedMemoryMegabytes >= requiredFlavor.memoryMegabytes;
    return hasEnoughCpu && hasEnoughMemory;
  });
  const hostsSortedByFreeMemory = eligibleHosts.sort((firstHost, secondHost) => {
    const firstFreeMemory = firstHost.totalMemoryMegabytes - calculateHostUsage(firstHost.hostName).usedMemoryMegabytes;
    const secondFreeMemory = secondHost.totalMemoryMegabytes - calculateHostUsage(secondHost.hostName).usedMemoryMegabytes;
    return secondFreeMemory - firstFreeMemory;
  });
  return { eligibleHosts: hostsSortedByFreeMemory, chosenHost: hostsSortedByFreeMemory[0] || null };
}

// ============================================================
// OPERAÇÕES
// ============================================================

// Cria uma VM seguindo a mesma ordem do OpenStack real.
// É "async" porque cada passo espera o anterior terminar (await).
async function createInstance(instanceName, chosenImage, chosenFlavor, wantsExtraVolume) {
  simulationState.isOperationRunning = true;
  simulationState.highlightedHostName = null;
  resetPipeline();
  const startTimestamp = Date.now();

  await runServiceStep('horizon', 'Pedido: criar "' + instanceName + '" (' + chosenImage.displayName + ', ' + chosenFlavor.flavorId + ')', 'O painel transforma o formulário numa chamada de API.', 700);
  await runServiceStep('keystone', 'Token conferido: usuário aluno, projeto turma-a', 'Antes de fazer qualquer coisa, o OpenStack confere quem está pedindo.', 800);

  // Antes de criar, o Nova confere se o projeto ainda está dentro da cota.
  const projectUsage = calculateProjectUsage();
  if (projectUsage.usedVirtualCpus + chosenFlavor.virtualCpus > projectQuota.maximumVirtualCpus
    || projectUsage.usedMemoryMegabytes + chosenFlavor.memoryMegabytes > projectQuota.maximumMemoryMegabytes
    || projectUsage.instanceCount + 1 > projectQuota.maximumInstances) {
    setServiceState('nova', 'is-working');
    writeLog('nova', 'POST /v2.1/servers → 403 Forbidden: Quota exceeded', 'O projeto passou do limite que o administrador definiu.');
    await waitForStep(600);
    setServiceState('nova', null);
    showToast('Cota do projeto excedida. Exclua alguma VM.', true);
    simulationState.isOperationRunning = false;
    renderCurrentView();
    return;
  }

  // A VM já aparece na lista como "Construindo" antes de estar pronta,
  // igual ao painel real (status BUILD).
  const newInstance = { instanceName, imageName: chosenImage.displayName, flavorId: chosenFlavor.flavorId, ipAddress: null, hostName: null, status: 'building', hasExtraVolume: wantsExtraVolume };
  simulationState.instances.push(newInstance);
  simulationState.currentView = 'instances';
  renderCurrentView();
  await runServiceStep('nova', 'nova-api: POST /v2.1/servers → 202 Accepted (status BUILD)', 'Pedido aceito. A VM entra na fila como "Construindo".', 900);

  setServiceState('nova', 'is-working');
  // O scheduler decide em qual servidor físico a VM vai rodar.
  const schedulerResult = chooseHostWithScheduler(chosenFlavor);
  if (!schedulerResult.chosenHost) {
    writeLog('nova', 'nova-scheduler: No valid host was found', 'Nenhum servidor físico tem CPU e memória livres para esse tamanho de VM.');
    await waitForStep(900);
    setServiceState('nova', null);
    simulationState.instances = simulationState.instances.filter(instance => instance !== newInstance);
    showToast('Nuvem cheia! Vá em Servidores físicos e adicione um.', true);
    simulationState.isOperationRunning = false;
    simulationState.currentView = 'hosts';
    renderCurrentView();
    return;
  }
  const eligibleHostNames = schedulerResult.eligibleHosts.map(computeHost => computeHost.hostName).join(', ');
  writeLog('nova', 'nova-scheduler: aptos [' + eligibleHostNames + '] → escolhido ' + schedulerResult.chosenHost.hostName, 'Filtra quem tem recurso livre e escolhe o servidor com mais memória sobrando.');
  newInstance.hostName = schedulerResult.chosenHost.hostName;
  simulationState.highlightedHostName = schedulerResult.chosenHost.hostName;
  renderCurrentView();
  await waitForStep(1100);
  setServiceState('nova', 'is-done');

  // A ordem de criar a VM chega ao servidor escolhido por fila de mensagens.
  await runServiceStep('rabbitmq', 'nova-conductor → ' + schedulerResult.chosenHost.hostName + ': build_and_run_instance', 'A ordem vai por fila de mensagens até o nova-compute do servidor escolhido.', 900);
  await runServiceStep('glance', 'GET /v2/images/' + chosenImage.imageId + '/file (' + chosenImage.sizeLabel + ')', 'O servidor físico baixa a imagem do sistema operacional.', 1000);

  const assignedIpAddress = '10.0.0.' + simulationState.nextIpSuffix;
  simulationState.nextIpSuffix += 1;
  await runServiceStep('neutron', 'Porta criada em rede-interna, IP ' + assignedIpAddress, 'A VM ganha uma placa de rede virtual e um endereço.', 900);
  newInstance.ipAddress = assignedIpAddress;
  renderCurrentView();

  // O Cinder só entra se o usuário pediu um disco extra.
  if (wantsExtraVolume) {
    await runServiceStep('cinder', 'Volume de 10 GB criado e anexado como /dev/vdb', 'Um disco extra, que continua existindo mesmo se a VM for apagada.', 1000);
  }

  await runServiceStep('kvm', 'libvirt: domínio "' + instanceName + '" iniciado em ' + schedulerResult.chosenHost.hostName, 'O hypervisor finalmente liga a máquina virtual.', 1100);
  newInstance.status = 'active';
  const elapsedSeconds = ((Date.now() - startTimestamp) / 1000).toFixed(1);
  writeLog('nova', 'Instância "' + instanceName + '" → ACTIVE (' + elapsedSeconds + ' s)', 'Pronto. Para o usuário, só apareceu "Ativa".');
  showToast('"' + instanceName + '" está ativa em ' + elapsedSeconds + ' s');
  simulationState.isOperationRunning = false;
  renderCurrentView();
}

// Exclui uma VM. O volume do Cinder, se existir, não é apagado junto:
// no OpenStack real o disco extra sobrevive à VM, e isso é proposital.
async function deleteInstance(instanceName) {
  const instanceToDelete = simulationState.instances.find(instance => instance.instanceName === instanceName);
  if (!instanceToDelete || simulationState.isOperationRunning) return;
  simulationState.isOperationRunning = true;
  resetPipeline();
  instanceToDelete.status = 'deleting';
  renderCurrentView();
  await runServiceStep('horizon', 'Pedido: excluir "' + instanceName + '"', null, 500);
  await runServiceStep('keystone', 'Token conferido', null, 500);
  await runServiceStep('nova', 'DELETE /v2.1/servers/' + instanceName + ' → 204', 'O Nova manda desligar e apagar a VM.', 700);
  await runServiceStep('kvm', 'libvirt: domínio "' + instanceName + '" destruído em ' + instanceToDelete.hostName, null, 700);
  await runServiceStep('neutron', 'Porta removida, IP ' + instanceToDelete.ipAddress + ' liberado', null, 600);
  if (instanceToDelete.hasExtraVolume) {
    writeLog('cinder', 'Volume desanexado (continua disponível)', 'O disco extra não some junto com a VM.');
  }
  simulationState.instances = simulationState.instances.filter(instance => instance !== instanceToDelete);
  writeLog('nova', 'Recursos de ' + instanceToDelete.hostName + ' liberados', 'A CPU e a memória voltam a ficar livres para outras VMs.');
  showToast('"' + instanceName + '" excluída');
  simulationState.isOperationRunning = false;
  renderCurrentView();
}

// Escala horizontal: adiciona mais um servidor físico ao conjunto.
// O Nova passa a usá-lo automaticamente, sem mudar nada nas VMs existentes.
async function addComputeHost() {
  if (simulationState.isOperationRunning) return;
  simulationState.isOperationRunning = true;
  resetPipeline();
  const newHostName = 'compute-' + String(simulationState.nextHostNumber).padStart(2, '0');
  simulationState.nextHostNumber += 1;
  writeLog('kvm', 'Novo servidor físico ligado: ' + newHostName + ' (8 vCPU, 16 GB)', 'Alguém instalou mais uma máquina no rack.');
  await waitForStep(700);
  await runServiceStep('nova', 'nova-compute em ' + newHostName + ' registrado no Placement', 'O Nova passa a enxergar o novo servidor e o que ele tem livre.', 1000);
  simulationState.computeHosts.push({ hostName: newHostName, totalVirtualCpus: 8, totalMemoryMegabytes: 16384 });
  simulationState.newestHostName = newHostName;
  simulationState.highlightedHostName = null;
  showToast(newHostName + ' entrou na nuvem');
  simulationState.isOperationRunning = false;
  renderCurrentView();
  simulationState.newestHostName = null;
}

// ============================================================
// EVENTOS DA PÁGINA
// ============================================================

// Envio do formulário: valida o nome e dispara a criação.
// preventDefault() impede o navegador de recarregar a página.
document.getElementById('createForm').addEventListener('submit', submitEvent => {
  submitEvent.preventDefault();
  const typedName = document.getElementById('instanceNameInput').value.trim();
  const nameIsValid = /^[a-z0-9][a-z0-9-]{0,30}$/.test(typedName) && !simulationState.instances.some(instance => instance.instanceName === typedName);
  if (!nameIsValid) {
    document.getElementById('nameError').style.display = 'block';
    return;
  }
  const chosenImage = availableImages.find(image => image.imageId === simulationState.selectedImageId);
  const chosenFlavor = findFlavor(simulationState.selectedFlavorId);
  const wantsExtraVolume = document.getElementById('volumeCheckbox').checked;
  closeCreateModal();
  createInstance(typedName, chosenImage, chosenFlavor, wantsExtraVolume);
});

document.getElementById('cancelCreateButton').addEventListener('click', closeCreateModal);
createModal.addEventListener('click', clickEvent => { if (clickEvent.target === createModal) closeCreateModal(); });

document.querySelectorAll('.nav-button').forEach(navButton => {
  navButton.addEventListener('click', () => {
    simulationState.currentView = navButton.dataset.view;
    renderCurrentView();
  });
});

document.getElementById('speedSelect').addEventListener('change', changeEvent => {
  simulationState.speedMultiplier = Number(changeEvent.target.value);
});

document.getElementById('clearLogButton').addEventListener('click', () => {
  logPanel.innerHTML = '';
  resetPipeline();
});

// ============================================================
// INÍCIO
// ============================================================
renderPipeline();
writeLog('horizon', 'Painel carregado. Aguardando login.', 'Clique em Entrar para começar.');
renderCurrentView();
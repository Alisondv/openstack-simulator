# Simulador OpenStack

Simulação didática, feita no navegador, de como o OpenStack cria uma máquina virtual. Ela foi feita para a apresentação sobre OpenStack da disciplina de Sistemas Distribuídos (Engenharia de Software, UNAERP).

> **Importante:** este projeto é uma simulação. Nenhum OpenStack real roda por trás. Os nomes dos serviços, a ordem dos passos e as mensagens seguem o funcionamento real da plataforma.

## O que dá para fazer

- **Entrar no painel:** o Keystone confere o usuário e emite um token.
- **Criar uma instância (VM):** você escolhe a imagem, o tamanho (flavor) e se quer um disco extra. A coluna "Bastidores" mostra cada serviço agindo, em ordem:

  `Horizon → Keystone → Nova → RabbitMQ → Glance → Neutron → Cinder → KVM`

- **Ver os servidores físicos:** mostra em qual máquina cada VM foi parar e quanto de CPU e memória está em uso.
- **Lotar a nuvem e escalar:** criando VMs grandes, o agendador do Nova acaba respondendo `No valid host was found`. Depois de clicar em "Adicionar servidor físico", a criação volta a funcionar. Isso é a escala horizontal.
- **Excluir instâncias:** os recursos voltam a ficar livres.

No topo da página há um seletor de velocidade. O modo "Lenta" é o melhor para explicar cada passo durante a apresentação.

## Como rodar

Não precisa instalar nada. Há duas opções:

- **Online:** [openstack-simulator-vcd7.vercel.app](https://openstack-simulator-vcd7.vercel.app)
- **Local:** baixe a pasta do projeto e abra o `index.html` com dois cliques. Os três arquivos precisam ficar na mesma pasta. Funciona sem internet; nesse caso só as fontes mudam para as padrão do sistema.

## Tecnologias

HTML, CSS e JavaScript puro, sem framework e sem backend.

| Arquivo | Conteúdo |
|---|---|
| `index.html` | Estrutura da página: barra do topo, menu, área central, coluna "Bastidores" e formulário de criação. |
| `style.css` | Visual e animações. |
| `script.js` | Toda a lógica da simulação. |

## Como o `script.js` está organizado

| Parte | O que faz |
|---|---|
| `simulationState` | Guarda o estado da nuvem: servidores físicos, VMs, login e velocidade. |
| `createInstance()` | Executa os passos de criação de uma VM em ordem, com pausas entre eles (`async`/`await`). |
| `chooseHostWithScheduler()` | Imita o agendador do Nova: filtra os servidores com CPU e memória livres e escolhe o que tem mais memória sobrando. |
| `deleteInstance()` | Apaga a VM e libera os recursos. |
| `addComputeHost()` | Adiciona um servidor físico à nuvem (escala horizontal). |
| `writeLog()` | Escreve as mensagens coloridas na coluna "Bastidores". |
| `renderOverview()`, `renderInstances()`, `renderHosts()` | Redesenham cada tela a partir do `simulationState`. |

Para mudar imagens, tamanhos de VM ou servidores iniciais, edite as listas `availableImages`, `availableFlavors` e `simulationState` no começo do `script.js`.

## Equipe

- Alison Wellington Pereira Xavier dos Santos
- [Integrante 2]
- [Integrante 3]
- [Integrante 4]

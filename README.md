# Task Graph — plugin para o Paperclip

Mostra as tarefas da empresa como um grafo, no estilo da visualização em grafo do Obsidian. A empresa fica no centro e se liga aos projetos. Cada projeto se liga às suas tarefas, e cada tarefa às suas subtarefas.

## O que a página mostra

- **Nós:** a empresa, os projetos (com borda), as tarefas e as subtarefas. O tamanho de um nó cresce com o número de filhas.
- **Cores por status:** backlog, a fazer, em andamento, em revisão, bloqueada, concluída e cancelada. A legenda fica no topo da página.
- **Dependências:** uma linha vermelha tracejada com seta vai da tarefa que bloqueia até a tarefa bloqueada.
- **Interação:**
  - roda do mouse para zoom;
  - arrastar o fundo para mover a tela;
  - arrastar um nó para reposicioná-lo;
  - passar o mouse para destacar os vizinhos;
  - clicar para abrir a tarefa ou o projeto.
- **Filtros:**
  - projeto e agente. A tarefa pai que não passa no filtro continua visível, mais clara, para manter a árvore;
  - concluídas e canceladas, que ficam escondidas por padrão;
  - liga/desliga das dependências.
- **Busca:** digite, por exemplo, `SIM-190` e aperte Enter. A página destaca o nó e centraliza a tela nele.
- **Atualização:** a página recarrega a cada 60 segundos. Também há um botão "Recarregar".

## Requisitos

- Paperclip com suporte a plugins (instância local ou Docker).
- Node.js 24.11 ou mais recente, para compilar. O contêiner do Paperclip já tem essa versão.

## Instalação

### 1. Baixar e compilar

```sh
git clone <url-do-repo> paperclip-task-graph
cd paperclip-task-graph
npm install --include=dev
npm run build
```

O build gera a pasta `dist/` com o manifesto, o worker e a interface.

### 2. Instalar no Paperclip

**Paperclip rodando direto na máquina:**

```sh
npx paperclipai plugin install --local "$(pwd)" --api-base http://localhost:3100
```

**Paperclip rodando em Docker:** o servidor precisa enxergar a pasta do plugin. Clone o plugin numa pasta montada como volume no contêiner, ou adicione um volume para ela no `docker-compose.yml`. Depois, compile e instale de dentro do contêiner com o usuário `node`:

```sh
docker exec -u node -e HOME=/paperclip -w /caminho/para/paperclip-task-graph <container> \
  sh -c 'npm install --include=dev && npm run build'

docker exec -it -u node -e HOME=/paperclip -w /paperclip <container> \
  npx paperclipai plugin install --local /caminho/para/paperclip-task-graph --api-base http://localhost:3100
```

A pasta do plugin precisa pertencer ao mesmo usuário do servidor (UID 1000 na imagem oficial). Se você clonou como root, corrija o dono:

```sh
sudo chown -R 1000:1000 /caminho/para/paperclip-task-graph
```

### 3. Conferir

```sh
npx paperclipai plugin list --api-base http://localhost:3100
```

O resultado deve conter `key=paperclip-task-graph status=ready`. Recarregue o Paperclip no navegador: o item **"Grafo de tarefas"** aparece na barra lateral da empresa. A página também fica em `/<prefixo-da-empresa>/task-graph`.

## Atualizar depois de mudar o código

```sh
npm run build
```

O Paperclip detecta o novo `dist/` e recarrega o plugin sozinho. Se ele não recarregar, desinstale e instale de novo:

```sh
npx paperclipai plugin uninstall paperclip-task-graph --api-base http://localhost:3100
npx paperclipai plugin install --local "$(pwd)" --api-base http://localhost:3100
```

## Permissões usadas

| Capability | Para quê |
| --- | --- |
| `companies.read` | nome da empresa (nó central) |
| `projects.read` | nós dos projetos |
| `issues.read` | tarefas e subtarefas |
| `issue.relations.read` | dependências (`blockedBy`) |
| `agents.read` | nome do agente responsável e filtro por agente |
| `ui.page.register`, `ui.sidebar.register` | página e link na barra lateral |

O plugin só lê dados. Ele não cria, altera nem apaga nada no Paperclip.

## Estrutura

```
src/
  manifest.ts      # id, capabilities e slots de UI
  worker.ts        # busca projetos, tarefas, agentes e dependências
  shared.ts        # tipos compartilhados entre worker e UI
  ui/
    index.tsx      # exporta a página e o link da barra lateral
    GraphPage.tsx  # página: filtros, canvas, interação
    force.ts       # simulação de forças (sem dependências externas)
```

## Limites conhecidos

- O plugin carrega no máximo 5000 tarefas por empresa.
- As dependências só aparecem para tarefas abertas. Tarefas concluídas ou canceladas não têm bloqueios ativos.

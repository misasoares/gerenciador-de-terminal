# Gerenciador de Terminal — Atualização pelo próprio app — Design

Data: 2026-10-08
Status: aprovado em conversa (3 seções), aguardando revisão da spec escrita
Base: `main` (e71f74e), versão 0.1.0, sem releases nem tags. Item 1b da ordem de 01/10. Tem de funcionar no macOS e no Linux.

## 1. Objetivo

O app descobre sozinho que há versão nova, baixa em segundo plano sem perguntar e mostra um botão. Um clique em "Atualizar" fecha, troca a versão, reabre e retoma todas as sessões — sem passos manuais, sem o macOS pedir de novo as permissões de pastas.

Decisões do usuário:
- origem: **Releases no GitHub**; o repositório **será tornado público** (pré-requisito, etapa separada — seção 8);
- download **automático**; instalação **só no clique** ("Avisa e você decide");
- após reiniciar, **retoma todas as sessões sozinho**;
- Linux: o **AppImage se atualiza**; `.deb`/`.rpm` só avisam e abrem a página da release;
- publicar: **um comando local** (`npm run release -- 0.2.0`);
- abordagem: **atualizador próprio** (não electron-updater: no Mac ele exige Developer ID da Apple e não sabe salvar/retomar sessões nem encerrar o daemon). Conta paga da Apple fica para o futuro, se o app for distribuído a mais gente.

Fora do escopo: instalar ao sair do app (pode vir depois); canais beta; atualizações delta; notarização da Apple; atualizar `.deb`/`.rpm` sozinho; Windows.

### Critérios de sucesso
- Com uma release nova publicada, em até 6 h (ou ao abrir o app) aparece "Versão X pronta · Atualizar", com o arquivo já baixado e conferido.
- Um clique (mais uma confirmação se houver sessões trabalhando) leva a app reaberta na versão nova, com todas as sessões retomadas e o aviso "Atualizado para X · N sessões retomadas".
- Se a versão nova não abrir, o app volta sozinho para a anterior e avisa.
- Depois da troca, o macOS não pede de novo permissão de pastas.
- Nenhuma falha de rede ou do GitHub gera erro visível ou trava o app.

## 2. Experiência

1. **Verificação**: ao abrir o app e a cada 6 h. Silenciosa.
2. **Download**: se a release mais nova for maior que `app.getVersion()`, baixa o arquivo da plataforma e confere o SHA-256. Silencioso.
3. **Aviso**: na barra de status, `● Versão 0.2.0 pronta · Atualizar`, e "Ver novidades" (notas da release, num modal).
4. **Clique em Atualizar**:
   - nenhuma sessão trabalhando → segue direto;
   - alguma trabalhando ou pedindo algo → confirmação: "3 sessões trabalhando. Elas param agora e são retomadas na nova versão. Atualizar?".
5. **Troca**: o app fecha, a versão é trocada e o app reabre (poucos segundos).
6. **Retomada**: todas as sessões retomáveis são retomadas; aviso "Atualizado para 0.2.0 · 5 sessões retomadas".
7. **Falha**: volta para a versão anterior; aviso "A atualização falhou; você continua na 0.1.0".

`.deb`/`.rpm`: o passo 2 não baixa nada; o aviso é `● Versão 0.2.0 disponível · Baixar`, que abre a página da release no navegador.

## 3. Componentes

### 3.1 `src/main/updater/release-check.ts` (puro)
- `compareVersions(a, b)`: semver `maior.menor.correção` numérico (0.10.0 > 0.9.0); ignora prefixo `v`.
- `parseRelease(json)`: da resposta de `GET https://api.github.com/repos/misasoares/gerenciador-de-terminal/releases/latest` extrai `version`, `notes`, `htmlUrl` e a lista de assets (`name`, `url`, `size`).
- `pickAsset(release, { platform, arch, appImage })` → `{ kind: 'mac-zip' | 'appimage', asset } | { kind: 'notify-only' } | null`:
  - `darwin` → `gerenciador-de-terminal-<versão>-mac-<arch>.zip`;
  - `linux` com `APPIMAGE` definido → `gerenciador-de-terminal-<versão>-x86_64.AppImage` (o nome que o electron-builder já gera);
  - `linux` sem `APPIMAGE` → `notify-only`;
  - asset ausente → `null` (nada acontece).
- `parseSums(text)`: lê `SHA256SUMS` (`<hash>  <arquivo>` por linha).

### 3.2 `src/main/updater/download.ts`
- Baixa para `~/.gerenciador-terminal/updates/<versão>/` (respeita `GT_HOME`), em `.part`, renomeando só após o SHA-256 bater com o `SHA256SUMS` da mesma release.
- Hash diferente ou download interrompido → apaga e tenta na próxima verificação.
- Ao concluir, remove pastas de outras versões.
- Se o arquivo da versão já existe e confere, não baixa de novo.

### 3.3 `src/main/updater/index.ts` (orquestração)
- Liga no `app.whenReady` só quando `app.isPackaged`; intervalo de 6 h.
- Estado enviado ao renderer por IPC: `idle | downloading | ready(version, notes) | notify-only(version, url) | blocked(reason) | failed-last(version)`.
- `blocked('not-writable')`: a pasta do bundle (Mac) ou do AppImage não é gravável (ex.: rodando de dentro do `.dmg`) → aviso "Mova o app para Aplicativos para atualizar".

### 3.4 `src/main/updater/install.ts` (ao clicar)
1. Backup de `state.json` em `updates/state-<horário>.json`.
2. Grava `updates/pending.json`: `{ from, to, at }`.
3. Pede ao daemon para encerrar pelo mesmo caminho do SIGTERM (já salva as sessões como retomáveis).
4. Inicia o script auxiliar destacado (`detached`, `unref`) com: PID do app, PID do daemon, caminho do bundle atual, caminho do arquivo baixado, tipo (`mac-zip`/`appimage`), pasta `updates`.
5. `app.quit()`.

### 3.5 Script auxiliar `resources/update-helper.sh` (POSIX sh, Mac e Linux)
1. Espera os PIDs do app e do daemon terminarem (limite 30 s; se passar, desiste sem trocar e grava a falha).
2. Troca:
   - **mac-zip**: `ditto -x -k` numa pasta ao lado do bundle; renomeia o atual para `Gerenciador de Terminal.anterior.app` (substituindo uma anterior antiga); move o novo para o lugar; `open -n` no novo (repassando `GT_HOME`/`GT_UPDATE_URL` com `--env`, para os testes isolados).
   - **appimage**: copia o atual para `<nome>.anterior`; move o novo sobre o caminho de `APPIMAGE`; `chmod +x`; executa destacado.
3. Espera o arquivo `updates/ok-<versão>` (gravado pelo app novo após a janela carregar) por até 60 s.
4. Sem `ok` → no Mac fecha a versão nova (`pkill` pelo caminho do bundle, que também pega o daemon dela), restaura o anterior, grava `updates/failed.json` `{ from, to, at }`, abre o anterior.
5. Com `ok` → apaga `.anterior` e encerra.
6. Registra tudo em `updates/helper.log`.

### 3.6 Retomada após reabrir (`src/main/updater/after-update.ts`)
- Na inicialização, lê `pending.json`:
  - versão atual = `to` → grava `ok-<to>` após a janela principal carregar, pede ao renderer para retomar todas as sessões (o mesmo `resumeAll` de "Retomar todas", em todos os espaços) e mostrar "Atualizado para X · N sessões retomadas"; apaga `pending.json`.
  - versão atual = `from` e existe `failed.json` → estado `failed-last(to)`, aviso "A atualização para Y falhou; você continua na X"; apaga ambos.
  - versão atual = `from` sem `failed.json` → nada (o script ainda pode estar esperando a nova); não apaga nada.
- Sessão que não retomar continua na lista de "Retomar" (sem tratamento novo).

### 3.7 Renderer
- `StatusBar.tsx`: item de atualização (pronta / disponível / bloqueada / falhou), botão "Atualizar" e "Ver novidades".
- Confirmação quando há sessões trabalhando ou pedindo algo: diálogo nativo do processo principal (como o "Encerrar tudo"), contando as sessões de **todos** os espaços pelo resumo que o processo principal já recebe.
- Modal "Novidades" com as notas da release (texto simples, sem HTML).
- Aviso pós-atualização como notícia na ilha/barra de status.

### 3.8 Assinatura estável no Mac
- Certificado de assinatura de código autoassinado e fixo ("Gerenciador de Terminal Local") no Keychain de login, criado uma vez por um script (`scripts/mac-cert.sh`).
- O script `pack` assina com ele em vez de ad hoc (`codesign --sign "Gerenciador de Terminal Local"`); se o certificado não existir, falha com instrução de criar.
- Efeito: o requisito designado do app fica igual entre versões, e o macOS mantém as permissões já concedidas.

## 4. Publicar: `npm run release -- <versão>`
`scripts/release.sh`:
1. Confere: branch `main`, árvore limpa, `gh` autenticado, versão maior que a atual, Docker disponível.
2. `npm test`.
3. Atualiza `version` no `package.json`.
4. Gera o `.zip` do Mac (arquitetura da máquina) assinado com o certificado fixo, e AppImage/`.deb`/`.rpm` do Linux via `scripts/build-linux.sh`, todos com os nomes da seção 3.1.
5. Gera `SHA256SUMS` de todos os arquivos.
6. Commit `chore(release): <versão>`, tag `v<versão>`, push de main e da tag.
7. `gh release create v<versão>` com os arquivos e notas geradas dos commits desde a tag anterior (`feat`/`fix` em linguagem simples).
Falha em qualquer passo antes do 6 → nada é publicado e a versão volta ao valor anterior.

## 5. Erros

| Situação | Comportamento |
|---|---|
| Sem internet / GitHub fora | Nada visível; nova tentativa em 6 h |
| Limite da API (60/h sem token) | Igual: espera a próxima verificação |
| Download interrompido / SHA-256 diferente | Apaga; tenta na próxima verificação; botão só com arquivo conferido |
| Pasta do app sem escrita | "Mova o app para Aplicativos para atualizar" |
| App/daemon não encerram em 30 s | Não troca; app anterior reaberto; aviso de falha |
| Versão nova não confirma em 60 s | Restaura a anterior; "A atualização falhou; você continua na X" |
| Sessão não retoma | Fica em "Retomar" para nova tentativa |
| `npm run dev` / não empacotado | Atualizador desligado |

## 6. Testes
- **Unitários (vitest)**: `compareVersions`; `parseRelease`; `pickAsset` (Mac arm64/x64, AppImage, deb/rpm → notify-only, asset ausente); `parseSums`; decisão do `after-update` (pending → ok/retomar; failed → aviso; nada → nada); texto do aviso ("N sessões retomadas", singular/plural); conferência de hash no download (arquivo bom, ruim, `.part`).
- **Script auxiliar**: em pasta temporária com bundles falsos — troca bem-sucedida; sem `ok` (restaura); arquivo corrompido (não troca); PIDs que não terminam (desiste).
- **Ponta a ponta no Mac, isolado**: 0.1.0 de teste numa pasta temporária, `GT_HOME` separado, URL da API sobrescrita por variável de ambiente (`GT_UPDATE_URL`) para uma release falsa servida localmente; conferir aviso → clique → troca → reabertura → sessões retomadas → aviso final; e o caminho de falha. Depois, fechar todos os Electrons de teste.
- **Linux**: `npm run pack:linux` sem erro; script auxiliar no modo AppImage dentro do Docker. Teste real em Linux na primeira release (usuário/Victor).

## 7. Primeira release
A versão instalada hoje (0.1.0) não tem atualizador: a 0.2.0 é instalada manualmente uma última vez (app fechado, SIGTERM no daemon com backup do `state.json`, troca, reabrir). A partir dela, as atualizações são pelo app.

## 8. Pré-requisito: repositório público
Etapa separada, irreversível e pública: varrer o histórico do git em busca de chaves, tokens e dados de clientes; apresentar o resultado; mudar a visibilidade só com confirmação explícita do usuário. Até lá, o atualizador é testado só com a release falsa local.

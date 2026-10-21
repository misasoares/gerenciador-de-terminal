# abrir_midia (agente abre e compara mídia no painel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ferramenta MCP `abrir_midia` que abre uma mídia avulsa ou uma galeria de comparações (grupos lado a lado, navegáveis com ← →) num painel na aba da sessão que chamou.

**Architecture:** A validação dos argumentos fica num módulo puro do daemon (`media-open.ts`). O `mcpCall` do daemon grava o painel em `persisted.filePanes` com um campo novo, `gallery`, e o põe no layout com `insertBeside`. Se a mesma sessão já tem uma galeria no layout, ele reaproveita. No renderer, `FilePane` vira um despachante: com galeria de mais de um item, mostra `GalleryPane`; senão, o visualizador atual.

**Tech Stack:** TypeScript, Electron, React, vitest. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-21-abrir-midia-pelo-agente-design.md`

## Global Constraints

- Qualquer sessão pode chamar `abrir_midia` (não exige líder nem equipe).
- Use `caminhos` ou `grupos`, nunca os dois. Caminho inválido recusa a chamada inteira, antes de qualquer efeito, listando os ruins.
- Caminhos relativos resolvem a partir do `cwd` da sessão que chamou.
- Não muda a aba ativa. Sessão flutuante cai na aba ativa (comportamento atual do `insertBeside`).
- Reaproveita a galeria da mesma sessão se ela ainda está no layout. Volta para o grupo 1.
- Até 4 mídias por grupo ficam numa linha. Acima disso, grade com ⌈√n⌉ colunas. Ajuste para caber, sem rolagem horizontal.
- Título padrão do grupo = nome do primeiro arquivo do grupo sem extensão.
- Teclado com o painel focado: ← → trocam de grupo, Esc fecha.
- Copy e comentários em português, no tom dos arquivos vizinhos.

## Review Focus

- Caminho com espaço ou acento (`/Volumes/SSD MISA/…`): precisa abrir (é o caso real do usuário). Teste na Task 1.
- Caminho com `~/`: agentes escrevem assim. Expande para a home. Teste na Task 1.
- Usuário fechou a galeria e o agente chama de novo: abre um painel novo, sem reaproveitar um id que saiu do layout. Teste na Task 2.
- Trocar ver/editar (`filepane.set`) num id com galeria não pode apagar a galeria. Teste na Task 2.
- Argumentos vazios ou malformados (`grupos: []`, grupo vazio, os dois campos, nenhum, `rotulos` que não é lista de strings): recusa com mensagem clara. Teste na Task 1.

---

### Task 1: Validação dos argumentos (`media-open.ts`)

**Files:**
- Create: `src/daemon/media-open.ts`
- Test: `tests/daemon/media-open.test.ts`

**Interfaces:**
- Consumes: `mediaKind(p)` de `src/shared/media.ts`.
- Produces:
  - `export interface MediaGallery { groups: string[][]; labels: string[] | null; titles: string[] | null }`
  - `export function parseOpenMedia(args: Record<string, unknown>, o: { cwd: string; home: string; isFile(p: string): boolean }): MediaGallery`. Devolve caminhos absolutos. `caminhos: [a, b]` vira `groups: [[a], [b]]`. Lança `Error` em qualquer problema.

- [ ] **Step 1: Escrever os testes que falham**

```ts
const files = new Set(['/p/a.png', '/p/b.png', '/Volumes/SSD MISA/x/ç.png', '/h/s.jpg', '/p/n.txt'])
const o = { cwd: '/p', home: '/h', isFile: (p: string) => files.has(p) }

it('caminhos: cada um vira um grupo; relativo resolve pelo cwd; ~/ pela home', () => {
  expect(parseOpenMedia({ caminhos: ['a.png', '~/s.jpg'] }, o)).toEqual({ groups: [['/p/a.png'], ['/h/s.jpg']], labels: null, titles: null })
})
it('grupos com rótulos e títulos; espaço e acento no caminho passam', () => {
  expect(parseOpenMedia({ grupos: [['/p/a.png', '/Volumes/SSD MISA/x/ç.png']], rotulos: ['iOS', 'Android'], titulos: ['home'] }, o))
    .toEqual({ groups: [['/p/a.png', '/Volumes/SSD MISA/x/ç.png']], labels: ['iOS', 'Android'], titles: ['home'] })
})
it('recusa a chamada inteira listando os caminhos ruins', () => {
  expect(() => parseOpenMedia({ caminhos: ['/p/a.png', '/p/zz.png', '/p/n.txt'] }, o)).toThrow('não abri nada: /p/zz.png (não existe), /p/n.txt (não é imagem, vídeo, áudio ou PDF)')
})
it('formato inválido', () => {
  for (const bad of [{}, { caminhos: [] }, { grupos: [] }, { grupos: [[]] }, { caminhos: ['a.png'], grupos: [['a.png']] }, { caminhos: 'a.png' }, { grupos: [['a.png']], rotulos: [1] }])
    expect(() => parseOpenMedia(bad, o)).toThrow('passe caminhos (lista) ou grupos (lista de listas)')
})
```

(A última mensagem é o prefixo comum. A mensagem pode trazer detalhe depois do prefixo, desde que o `toThrow` com substring passe.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/daemon/media-open.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar `parseOpenMedia` em `src/daemon/media-open.ts`**

Use `path.resolve(o.cwd, p)` depois de expandir `~/`. O motivo de recusa é "não existe" quando `!isFile` e "não é imagem, vídeo, áudio ou PDF" quando `mediaKind` dá null. `titulos`/`rotulos` ausentes viram `null`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/daemon/media-open.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/daemon/media-open.ts tests/daemon/media-open.test.ts
git commit -m "feat(midia): validação dos caminhos do abrir_midia"
```

---

### Task 2: Daemon abre a galeria no layout

**Files:**
- Modify: `src/shared/types.ts:342-345` (`FilePaneMeta`)
- Modify: `src/daemon/daemon.ts` (`mcpCall`, por volta da linha 606, ao lado de `uso_da_maquina`; `case 'filepane.set'`, linha ~1128)
- Test: `tests/daemon/daemon.test.ts` (novo `it` perto de `uso_da_maquina: qualquer sessão consulta`)

**Interfaces:**
- Consumes: `parseOpenMedia`, `MediaGallery` (Task 1). `insertBeside(layout, anchorId, newId)` de `src/daemon/hire.ts`.
- Produces:
  - `FilePaneMeta` ganha `gallery?: MediaGallery & { createdBy: string }` (importar o tipo para `shared/types.ts` ou declarar lá e reexportar em `media-open.ts`, já que `shared` não importa de `daemon`: **declare `MediaGallery` em `src/shared/types.ts`** e faça `media-open.ts` importar de lá).
  - Resultado da ferramenta: `{ aberto: string /* id file:<uuid> */, grupos: number }`.

- [ ] **Step 1: Escrever o teste que falha**

Seguindo o padrão de `leaderIn(repo.dir)` + `call(...)`, numa sessão **não líder**. Crie `a.png` e `b.png` no repositório de teste (pode ser byte qualquer: a validação só olha extensão e existência).

```ts
it('abrir_midia: qualquer sessão abre ao lado dela; reaproveita a galeria; fechada, abre outra; filepane.set não apaga a galeria', async () => {
  // a.png, b.png criados em repo.dir
  const r1 = await call('abrir_midia', { grupos: [['a.png', 'b.png']], rotulos: ['iOS', 'Android'] })
  expect(r1).toMatchObject({ grupos: 1 })
  let s = await app.waitState((x) => !!x.filePanes[r1.aberto as string])
  expect(s.filePanes[r1.aberto as string]).toMatchObject({ path: `${repo.dir}/a.png`, gallery: { groups: [[`${repo.dir}/a.png`, `${repo.dir}/b.png`]], labels: ['iOS', 'Android'], createdBy: leader } })
  // folha na mesma aba da sessão, aba ativa intocada
  const tab = s.layout.tabs.find((t) => JSON.stringify(t.root).includes(leader))!
  expect(JSON.stringify(tab.root)).toContain(r1.aberto as string)

  const r2 = await call('abrir_midia', { caminhos: ['b.png'] })
  expect(r2.aberto).toBe(r1.aberto)
  s = await app.waitState((x) => x.filePanes[r1.aberto as string]?.path === `${repo.dir}/b.png`)

  await app.client.request({ t: 'filepane.set', id: r1.aberto, path: `${repo.dir}/b.png`, mode: 'view' })
  s = await app.waitState((x) => x.filePanes[r1.aberto as string]?.mode === 'view')
  expect(s.filePanes[r1.aberto as string].gallery).toBeTruthy()

  // usuário fecha: some do layout → nova chamada cria outro id
  // (tire a folha do layout pelo mesmo request que o renderer usa ao fechar painel)
  const r3 = await call('abrir_midia', { caminhos: ['a.png'] })
  expect(r3.aberto).not.toBe(r1.aberto)

  await expect(call('abrir_midia', { caminhos: ['zz.png'] })).rejects.toThrow('não abri nada')
})
```

Antes, confira qual request o renderer manda ao fechar um painel (`hidePaneAnimated` → `updateLayout`) e use o mesmo no teste.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/daemon/daemon.test.ts -t abrir_midia`
Expected: FAIL com `ferramenta desconhecida: abrir_midia`.

- [ ] **Step 3: Implementar**

- Em `mcpCall`, antes do bloco da equipe: `if (tool === 'abrir_midia') return this.openMedia(caller, w, args)`.
- `private openMedia(caller: PaneRecord, w: Workspace, args): { aberto: string; grupos: number }`:
  1. `parseOpenMedia(args, { cwd: caller.cwd, home: os.homedir(), isFile: (p) => fs.statSync(p, { throwIfNoEntry: false })?.isFile() ?? false })`.
  2. Procura em `persisted.filePanes` um id com `gallery.createdBy === caller.id` que esteja numa folha de `w.layout`. Se achar, troca o registro. Se não, cria `file:${randomUUID()}` e faz `w.layout = insertBeside(w.layout, caller.id, id)`.
  3. Grava `{ path: groups[0][0], mode: 'edit', gallery: { ...g, createdBy: caller.id } }` e chama `this.changed()`.
- `case 'filepane.set'`: preserva `gallery` do registro anterior com o mesmo id.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/daemon/daemon.test.ts -t abrir_midia && npx tsc --noEmit -p .`
Expected: PASS, sem erro de tipo.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/daemon/daemon.ts src/daemon/media-open.ts tests/daemon/daemon.test.ts
git commit -m "feat(midia): daemon abre a galeria do abrir_midia ao lado da sessão"
```

---

### Task 3: Ferramenta e instrução no MCP

**Files:**
- Modify: `src/mcp/protocol.ts` (`INSTRUCTIONS`, `TOOLS`)
- Test: `tests/mcp/protocol.test.ts`

**Interfaces:**
- Consumes: nome da ferramenta `abrir_midia` e argumentos `caminhos`, `grupos`, `rotulos`, `titulos` (Task 2).

- [ ] **Step 1: Atualizar os testes**

- `tools/list traz as 8 ferramentas`: a lista termina em `'uso_da_maquina', 'abrir_midia'`.
- Novo `it`:

```ts
it('abrir_midia: schema e instrução de abrir em vez de mandar caminho', async () => {
  const t = TOOLS.find((x) => x.name === 'abrir_midia')!.inputSchema as { properties: Record<string, unknown>; required?: string[] }
  expect(Object.keys(t.properties)).toEqual(['caminhos', 'grupos', 'rotulos', 'titulos'])
  expect(t.required ?? []).toEqual([])
  const r = (await handleMessage({ jsonrpc: '2.0', id: 9, method: 'initialize', params: {} }, noCall)) as { result: { instructions: string } }
  for (const k of ['abrir_midia', 'em vez de mandar caminhos', 'Não monte imagens lado a lado']) expect(r.result.instructions).toContain(k)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/mcp/protocol.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Linha em `INSTRUCTIONS`, texto exato do spec:

> Quando o usuário pedir para ver, abrir, mostrar ou comparar imagens, vídeos, áudios ou PDFs, use abrir_midia em vez de mandar caminhos no texto. Para comparar, passe grupos (um por tela) e rótulos (ex.: iOS, Android). Não monte imagens lado a lado: o painel já compara. Só edite uma imagem (recortar, marcar) quando precisar apontar um detalhe, e abra o resultado com abrir_midia.

Ferramenta no fim de `TOOLS`. A descrição diz que abre no painel ao lado desta sessão, que qualquer sessão pode usar, que usa `caminhos` ou `grupos` e que caminho inválido recusa tudo. Inclui o exemplo `grupos: [["ios/home.png","android/home.png"],["ios/eq.png","android/eq.png"]], rotulos: ["iOS","Android"]`. Tipos: `caminhos` `array` de `string`, `grupos` `array` de `array` de `string`, `rotulos`/`titulos` `array` de `string`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/mcp/protocol.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/protocol.ts tests/mcp/protocol.test.ts
git commit -m "feat(midia): ferramenta abrir_midia no MCP, com instrução para abrir em vez de mandar link"
```

---

### Task 4: Painel em modo galeria (renderer)

**Files:**
- Create: `src/renderer/src/gallery-model.ts`
- Create: `src/renderer/src/components/GalleryPane.tsx`
- Modify: `src/renderer/src/components/FilePane.tsx` (renomear o componente atual para `FileView`; `FilePane` vira despachante)
- Modify: `src/renderer/src/styles.css` (estilos da galeria, ao lado dos de `.media-box`)
- Test: `tests/renderer/gallery-model.test.ts`

**Interfaces:**
- Consumes: `FilePaneMeta.gallery` (Task 2). `MediaView`, `mediaKind`, `onFileChanged`, `requestCloseFile`, `focusPane`, `floatPane`, `FloatControls` (já existem).
- Produces (`gallery-model.ts`):
  - `isGalleryView(g: FilePaneMeta['gallery']): boolean`: true se houver mais de um grupo ou algum grupo com mais de uma mídia. Uma mídia só cai no `FileView` atual.
  - `gridColumns(n: number): number`: `n <= 4 ? n : Math.ceil(Math.sqrt(n))`.
  - `groupTitle(g: MediaGallery, i: number): string`: `titles?.[i]` ou o nome do primeiro arquivo sem extensão.
  - `stepGroup(i: number, delta: 1 | -1, total: number): number`: fica preso entre 0 e total-1, sem dar a volta.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('galeria só com mais de uma mídia', () => {
  expect(isGalleryView(undefined)).toBe(false)
  expect(isGalleryView({ groups: [['/a.png']], labels: null, titles: null, createdBy: 'x' })).toBe(false)
  expect(isGalleryView({ groups: [['/a.png'], ['/b.png']], labels: null, titles: null, createdBy: 'x' })).toBe(true)
  expect(isGalleryView({ groups: [['/a.png', '/b.png']], labels: null, titles: null, createdBy: 'x' })).toBe(true)
})
it('colunas: até 4 numa linha, depois grade √n', () => {
  expect([1, 2, 3, 4, 5, 6, 9, 10].map(gridColumns)).toEqual([1, 2, 3, 4, 3, 3, 3, 4])
})
it('título: o dado ou o nome do primeiro arquivo sem extensão', () => {
  const g = { groups: [['/x/cmp-01-equalizer.png'], ['/y/b.png']], labels: null, titles: null }
  expect(groupTitle(g, 0)).toBe('cmp-01-equalizer')
  expect(groupTitle({ ...g, titles: ['eq'] }, 0)).toBe('eq')
})
it('navegação presa nas pontas', () => {
  expect(stepGroup(0, -1, 6)).toBe(0)
  expect(stepGroup(5, 1, 6)).toBe(5)
  expect(stepGroup(2, 1, 6)).toBe(3)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/renderer/gallery-model.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `gallery-model.ts`**

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/renderer/gallery-model.test.ts`
Expected: PASS

- [ ] **Step 5: `GalleryPane` e despachante**

- `FilePane({ paneId, floating })` lê `meta.gallery`. Com `isGalleryView`, renderiza `<GalleryPane paneId floating />`. Senão, `<FileView … />` (o componente de hoje, renomeado, sem outra mudança).
- `GalleryPane`:
  - Mesma casca do `FileView`: `pane file-pane`, `focused`, `onMouseDown → focusPane`, arrastar pelo cabeçalho, ⧉ flutuar, ✕ `requestCloseFile`, `FloatControls` quando flutuante.
  - Cabeçalho: botões `‹`/`›` e `{i+1} / {total} · {groupTitle}`.
  - Estado `i` local, que volta a 0 quando `meta.gallery` muda (chave pelo JSON dos grupos).
  - Corpo: grade CSS com `grid-template-columns: repeat(gridColumns(n), 1fr)`. Cada célula tem o rótulo `labels?.[j]` em cima e `<MediaView>` com `fit` local por célula. Clicar alterna ajustar ↔ tamanho real, como hoje.
  - `version` por caminho via `file.watch` + `onFileChanged` dos caminhos do grupo atual, como o `FileView` faz para um arquivo. Arquivo sumido mostra "Arquivo não encontrado" só na célula dele.
  - `tabIndex={0}` e `onKeyDown`: `ArrowLeft`/`ArrowRight` → `stepGroup`; `Escape` → `requestCloseFile(paneId)`. Antes, confira em `src/shared/keybindings.ts` e no tratamento global de teclas se Esc já tem dono quando um painel de arquivo está focado. Se tiver, não feche no Esc e registre isso no commit.
- CSS: células com `min-width: 0` e imagens com `object-fit: contain` e altura máxima da célula, para não haver rolagem horizontal. Use as variáveis de tema que `.media-box` já usa.

- [ ] **Step 6: Verificar tipos e a suíte**

Run: `npx tsc --noEmit -p . && npm test`
Expected: tudo PASS. (O `tests/daemon/daemon.test.ts` tem mudança local do usuário que não é deste trabalho: não faça commit dela.)

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/gallery-model.ts src/renderer/src/components/GalleryPane.tsx src/renderer/src/components/FilePane.tsx src/renderer/src/styles.css tests/renderer/gallery-model.test.ts
git commit -m "feat(midia): painel de galeria para comparar mídias lado a lado"
```

---

### Task 5: Verificação no app de verdade

**Files:** nenhum de código.

- [ ] **Step 1:** Rodar o app de desenvolvimento isolado (`GT_HOME=<pasta temporária>`), como no teste de ponta a ponta do `CLAUDE.md`. Numa sessão Claude dentro dele, pedir "abre a.png" e depois "compara a.png com b.png, iOS e Android" com dois prints reais (pode usar os de `promo-videos/assets/`). Esperado: um painel só, ao lado da sessão, com rótulos. ← → navegam, Esc fecha, um novo pedido reaproveita o painel e a aba ativa não muda.
- [ ] **Step 2:** Encerrar os Electrons de teste (`pkill -f node_modules/electron/dist`) e confirmar com `pgrep`.
- [ ] **Step 3:** Não instalar em `/Applications` nem publicar release. Isso fica a pedido do usuário.

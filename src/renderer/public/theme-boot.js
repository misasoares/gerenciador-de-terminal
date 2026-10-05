// Aplica o último tema (cache de appearance.ts) antes da primeira pintura: o app é um módulo e roda depois,
// tarde demais para o primeiro quadro (o Claro piscaria escuro). Falha em silêncio: fica o Padrão do CSS.
;(function () {
  try {
    var c = JSON.parse(localStorage.getItem('gt-theme') || 'null')
    if (!c || typeof c.id !== 'string' || (c.scheme !== 'light' && c.scheme !== 'dark') || !c.vars) return
    var el = document.documentElement
    for (var k in c.vars) el.style.setProperty(k, c.vars[k])
    el.dataset.theme = c.id
    el.style.colorScheme = c.scheme
  } catch (e) {
    // sem armazenamento ou cache inválido
  }
})()

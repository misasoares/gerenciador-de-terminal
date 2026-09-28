declare const __BUILD_ID__: string | undefined

/** gerado no build (commit + horário); 'dev' fora do bundle, 'test' no vitest */
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'

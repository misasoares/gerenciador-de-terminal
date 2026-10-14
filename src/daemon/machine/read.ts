import fs from 'node:fs'
import os from 'node:os'
import type { MemPressure } from '../../shared/types'
import { run } from '../platform/procs'
import type { MemSample } from './monitor'
import { parseMeminfo, parsePressureLevel, parsePsi, parseSwapUsage, parseVmStatUsed } from './parse'

export function makeMemReader(platform: NodeJS.Platform = process.platform): () => Promise<MemSample> {
  if (platform === 'linux') {
    return async () => {
      const mem = parseMeminfo(fs.readFileSync('/proc/meminfo', 'utf8'))
      if (!mem) throw new Error('/proc/meminfo inesperado')
      let pressure: MemPressure = null
      try {
        pressure = parsePsi(fs.readFileSync('/proc/pressure/memory', 'utf8'))
      } catch {
        // kernel sem PSI: nível só por CPU e swap
      }
      return { ...mem, pressure }
    }
  }
  return async () => {
    const [vm, sc] = await Promise.all([run('/usr/bin/vm_stat', []), run('/usr/sbin/sysctl', ['vm.swapusage', 'kern.memorystatus_vm_pressure_level'])])
    const ramUsed = parseVmStatUsed(vm)
    const swap = parseSwapUsage(sc)
    if (ramUsed === null || swap === null) throw new Error('saída inesperada de vm_stat/sysctl')
    return { ramUsed, ramTotal: os.totalmem(), swapUsed: swap.used, swapTotal: swap.total, pressure: parsePressureLevel(sc) }
  }
}

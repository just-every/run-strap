// A QR code (ISO/IEC 18004) as inline SVG: byte mode, error correction L,
// versions 1-5 (one Reed-Solomon block each), mask 0. Enough for a member's
// 32-character check-in code. Construction follows Project Nayuki's QR Code
// generator (MIT), reduced to the single-block versions used here.

const versions = [[19, 7], [34, 10], [55, 15], [80, 20], [108, 26]] as const

function multiply(x: number, y: number) {
  let z = 0
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x }
  return z
}
function errorCorrection(data: number[], degree: number) {
  const divisor = Array(degree).fill(0); divisor[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) { divisor[j] = multiply(divisor[j], root); if (j + 1 < degree) divisor[j] ^= divisor[j + 1] }
    root = multiply(root, 2)
  }
  const result = Array(degree).fill(0)
  for (const byte of data) {
    const factor = byte ^ result.shift()!; result.push(0)
    divisor.forEach((coefficient, i) => { result[i] ^= multiply(coefficient, factor) })
  }
  return result
}

export function qrMatrix(value: string): boolean[][] {
  const bytes = [...new TextEncoder().encode(value)]
  const index = versions.findIndex(([data]) => 12 + 8 * bytes.length <= data * 8)
  if (index < 0) throw new Error('QR value too long')
  const version = index + 1, [dataLength, ecLength] = versions[index], size = 17 + 4 * version
  const bits: number[] = []
  const push = (value: number, length: number) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1) }
  push(4, 4); push(bytes.length, 8); for (const byte of bytes) push(byte, 8)
  push(0, Math.min(4, dataLength * 8 - bits.length)); while (bits.length % 8) bits.push(0)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2))
  for (let pad = 0xec; data.length < dataLength; pad ^= 0xec ^ 0x11) data.push(pad)
  const codewords = [...data, ...errorCorrection(data, ecLength)]

  const modules = Array.from({ length: size }, () => Array(size).fill(false))
  const fixed = Array.from({ length: size }, () => Array(size).fill(false))
  const set = (x: number, y: number, dark: boolean) => { modules[y][x] = dark; fixed[y][x] = true }
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0) }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const x = cx + dx, y = cy + dy, distance = Math.max(Math.abs(dx), Math.abs(dy))
    if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, distance !== 2 && distance !== 4)
  }
  if (version > 1) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(size - 7 + dx, size - 7 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  // Format information for level L (01) and mask 0, BCH(15,5) then the fixed XOR.
  const format = 1 << 3 | 0
  let remainder = format
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537)
  const formatBits = (format << 10 | remainder) ^ 0x5412, bit = (i: number) => ((formatBits >>> i) & 1) === 1
  for (let i = 0; i <= 5; i++) set(8, i, bit(i))
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8))
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i))
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i))
  set(8, size - 8, true)

  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vertical = 0; vertical < size; vertical++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vertical : vertical
      if (fixed[y][x]) continue
      const dark = i < codewords.length * 8 && ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1
      i++
      modules[y][x] = dark !== ((x + y) % 2 === 0)
    }
  }
  return modules
}

/** The code as a scalable SVG with the standard four-module quiet zone. */
export function qrSvg(value: string, label: string) {
  const matrix = qrMatrix(value), size = matrix.length + 8
  const path = matrix.flatMap((row, y) => row.map((dark, x) => dark ? `M${x + 4} ${y + 4}h1v1h-1z` : '')).join('')
  return `<svg class="qr" role="img" aria-label="${label.replace(/[&<>"']/g, '')}" viewBox="0 0 ${size} ${size}" width="${size * 5}" height="${size * 5}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`
}

/**
 * Animated ASCII background for the in-game view.
 * Falling characters shift color as they pass through random zones.
 */
import { useEffect, useRef } from 'react'

const CHARS = '01アイウエオカキクケコ░▒▓█◊◈⬡⬢⏣⎔'

interface Column {
  x: number
  y: number
  speed: number
  chars: string[]
  opacity: number
  fontSize: number
}

interface Zone {
  x: number
  y: number
  w: number
  h: number
  // Color shift: 0=white, 1=bright orange, 2=dim orange, 3=cool blue
  variant: number
  life: number
  maxLife: number
}

const ZONE_COLORS = [
  // [r, g, b] for each variant
  [220, 220, 230],   // white/cool
  [255, 160, 40],    // bright warm orange
  [140, 70, 10],     // dark amber
  [60, 80, 120],     // cool blue-gray
]

export function AsciiBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animFrame: number
    let columns: Column[] = []
    let zones: Zone[] = []
    let tick = 0

    function resize() {
      canvas!.width = canvas!.offsetWidth
      canvas!.height = canvas!.offsetHeight
      initColumns()
      zones = []
      for (let i = 0; i < 2; i++) spawnZone()
    }

    function initColumns() {
      columns = []
      const colCount = Math.floor(canvas!.width / 14)
      for (let i = 0; i < colCount; i++) {
        columns.push(makeColumn(i * 14, Math.random() * canvas!.height))
      }
    }

    function makeColumn(x: number, y: number): Column {
      const len = 3 + Math.floor(Math.random() * 12)
      const chars: string[] = []
      for (let i = 0; i < len; i++) {
        chars.push(CHARS[Math.floor(Math.random() * CHARS.length)])
      }
      return {
        x, y,
        speed: 0.2 + Math.random() * 0.6,
        chars,
        opacity: 0.02 + Math.random() * 0.06,
        fontSize: 10 + Math.floor(Math.random() * 4),
      }
    }

    function spawnZone() {
      // Large rectangles covering significant chunks of the screen
      const w = canvas!.width * (0.2 + Math.random() * 0.5)
      const h = canvas!.height * (0.2 + Math.random() * 0.5)
      zones.push({
        x: Math.random() * (canvas!.width - w * 0.5) - w * 0.25,
        y: Math.random() * (canvas!.height - h * 0.5) - h * 0.25,
        w, h,
        variant: Math.floor(Math.random() * ZONE_COLORS.length),
        life: 0,
        maxLife: 800 + Math.random() * 1200, // slow: 13-33 seconds at 60fps
      })
    }

    function getCharColor(cx: number, cy: number, baseAlpha: number): string {
      // Default: orange
      let r = 212, g = 113, b = 10
      let zoneAlpha = 0

      for (const zone of zones) {
        if (cx >= zone.x && cx <= zone.x + zone.w && cy >= zone.y && cy <= zone.y + zone.h) {
          // Slow fade in/out — breathe effect
          const fadeIn = Math.min(zone.life / 200, 1)
          const fadeOut = Math.min((zone.maxLife - zone.life) / 200, 1)
          const zoneFade = Math.min(fadeIn, fadeOut)

          if (zoneFade > zoneAlpha) {
            const zc = ZONE_COLORS[zone.variant]
            r = zc[0]
            g = zc[1]
            b = zc[2]
            zoneAlpha = zoneFade
          }
        }
      }

      // Blend: if inside a zone, shift toward zone color
      if (zoneAlpha > 0) {
        const or = 212, og = 113, ob = 10
        r = Math.round(or + (r - or) * zoneAlpha)
        g = Math.round(og + (g - og) * zoneAlpha)
        b = Math.round(ob + (b - ob) * zoneAlpha)
      }

      return `rgba(${r}, ${g}, ${b}, ${baseAlpha})`
    }

    function draw() {
      ctx!.fillStyle = 'rgba(17, 19, 24, 0.15)'
      ctx!.fillRect(0, 0, canvas!.width, canvas!.height)

      // Update zones
      tick++
      for (let i = zones.length - 1; i >= 0; i--) {
        zones[i].life++
        if (zones[i].life > zones[i].maxLife) {
          zones.splice(i, 1)
        }
      }
      // Spawn new zones slowly — they can overlap
      if (tick % 300 === 0 && zones.length < 5) {
        spawnZone()
      }

      // Draw columns
      for (const col of columns) {
        for (let i = 0; i < col.chars.length; i++) {
          const charY = col.y + i * (col.fontSize + 2)
          if (charY < -20 || charY > canvas!.height + 20) continue

          const fadeRatio = i / col.chars.length
          const alpha = col.opacity * (0.3 + fadeRatio * 0.7)

          ctx!.font = `${col.fontSize}px monospace`
          ctx!.fillStyle = getCharColor(col.x, charY, alpha)
          ctx!.fillText(col.chars[i], col.x, charY)

          if (Math.random() < 0.002) {
            col.chars[i] = CHARS[Math.floor(Math.random() * CHARS.length)]
          }
        }

        col.y += col.speed
        if (col.y > canvas!.height + 50) {
          col.y = -col.chars.length * (col.fontSize + 2)
          col.speed = 0.2 + Math.random() * 0.6
          col.opacity = 0.02 + Math.random() * 0.06
        }
      }

      animFrame = requestAnimationFrame(draw)
    }

    resize()
    ctx.fillStyle = '#111318'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    draw()

    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(animFrame)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        pointerEvents: 'none',
      }}
    />
  )
}

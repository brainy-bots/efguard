/**
 * Animated ASCII background for the in-game view.
 * Renders falling/drifting characters on a canvas, creating a
 * sci-fi atmosphere matching EVE Frontier's aesthetic.
 */
import { useEffect, useRef } from 'react'

const CHARS = '01アイウエオカキクケコ░▒▓█◊◈⬡⬢⏣⎔'
// Colors used inline in the draw loop

interface Column {
  x: number
  y: number
  speed: number
  chars: string[]
  opacity: number
  fontSize: number
}

export function AsciiBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animFrame: number
    let columns: Column[] = []

    function resize() {
      canvas!.width = canvas!.offsetWidth
      canvas!.height = canvas!.offsetHeight
      initColumns()
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
        x,
        y,
        speed: 0.2 + Math.random() * 0.6,
        chars,
        opacity: 0.02 + Math.random() * 0.06,
        fontSize: 10 + Math.floor(Math.random() * 4),
      }
    }

    function draw() {
      ctx!.fillStyle = 'rgba(17, 19, 24, 0.15)'
      ctx!.fillRect(0, 0, canvas!.width, canvas!.height)

      for (const col of columns) {
        for (let i = 0; i < col.chars.length; i++) {
          const charY = col.y + i * (col.fontSize + 2)
          if (charY < -20 || charY > canvas!.height + 20) continue

          // Fade: brightest at the head (last char), dimmer further back
          const fadeRatio = i / col.chars.length
          const alpha = col.opacity * (0.3 + fadeRatio * 0.7)

          ctx!.font = `${col.fontSize}px monospace`
          ctx!.fillStyle = `rgba(212, 113, 10, ${alpha})`
          ctx!.fillText(col.chars[i], col.x, charY)

          // Occasionally change a character
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
    // Initial clear
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

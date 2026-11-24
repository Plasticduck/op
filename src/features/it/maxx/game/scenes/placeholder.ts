// A stand-in for a scene that is not built yet: it names itself and goes back to the title.
import { VIEW_H, VIEW_W } from '../contract'
import type { Scene } from '../contract'
import { drawText } from '../engine/text'

export function placeholderScene(name: string, note: string, background = '#1b2253'): Scene {
  return {
    update(game, input) {
      if (input.pressed.confirm || input.pressed.cancel) {
        game.audio.sfx('menuBack')
        game.go('title')
      }
    },
    render(_game, g) {
      g.fillStyle = background
      g.fillRect(0, 0, VIEW_W, VIEW_H)
      drawText(g, name, VIEW_W / 2, 120, { scale: 4, align: 'center', color: '#ffe866', shadow: '#1e0d06' })
      drawText(g, note, VIEW_W / 2, 180, { align: 'center', color: '#b9ecff' })
      drawText(g, 'PRESS {confirm} TO GO BACK TO THE TITLE', VIEW_W / 2, 240, { align: 'center', color: '#f7f4f8' })
    },
  }
}

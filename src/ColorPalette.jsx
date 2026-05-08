import { useCallback } from 'react'
import './ColorPalette.css'

const THEME_COLORS = [
  { name: 'Coral', hex: '#F86F54' },
  { name: 'Paper', hex: '#F3F1E4' },
  { name: 'Charcoal', hex: '#212121' },
  { name: 'Royal Blue', hex: '#537CF7' },
  { name: 'Light Sea Green', hex: '#00A6A6' },
]

const MODE_OPTIONS = [
  { id: 'stroke', label: 'Stroke' },
  { id: 'background', label: 'Fill' },
]

const formatSwatchNumber = (index) => index.toString().padStart(2, '0')

const getTextColorForBackground = (hex, isDarkTheme) => {
  if (!hex || hex === 'transparent') {
    return isDarkTheme ? 'var(--color-paper)' : 'var(--color-charcoal)'
  }

  const sanitized = hex.replace('#', '')
  if (sanitized.length !== 6) return '#212121'

  const r = parseInt(sanitized.slice(0, 2), 16)
  const g = parseInt(sanitized.slice(2, 4), 16)
  const b = parseInt(sanitized.slice(4, 6), 16)

  const luminance = 0.299 * r + 0.587 * g + 0.114 * b
  return luminance > 180 ? '#212121' : '#ffffff'
}

function ColorPalette({ selectedColor, onColorSelect, colorMode, onModeChange, isDarkTheme }) {
  const handleColorClick = useCallback(
    (color) => {
      onColorSelect(color)
    },
    [onColorSelect]
  )

  const colors = colorMode === 'background'
    ? [{ name: 'Transparent', hex: 'transparent' }, ...THEME_COLORS]
    : THEME_COLORS

  return (
    <div className={`color-palette${isDarkTheme ? ' color-palette--dark' : ''}`}>
      <div className="color-palette__header">
        <div className="color-mode-toggle" role="group" aria-label="Color mode toggle">
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`color-mode-toggle__option${colorMode === option.id ? ' color-mode-toggle__option--active' : ''}`}
              onClick={() => onModeChange(option.id)}
              aria-pressed={colorMode === option.id}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="color-palette__swatches">
        {colors.map((color, index) => (
          <button
            key={color.hex}
            type="button"
            className={`color-swatch${selectedColor === color.hex ? ' color-swatch--active' : ''}${color.hex === 'transparent' ? ' color-swatch--transparent' : ''}`}
            style={{
              backgroundColor: color.hex === 'transparent' ? 'transparent' : color.hex,
            }}
            onClick={() => handleColorClick(color.hex)}
            aria-label={`Select ${color.name} color`}
            title={color.name}
          />
        ))}
      </div>
    </div>
  )
}

export default ColorPalette

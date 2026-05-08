import {
  Cursor,
  // ImageSquare,
  TextT,
  Square,
  Circle,
  ArrowRight,
  ScribbleLoop,
  FrameCorners,
  Browsers,
} from '@phosphor-icons/react'

import './CustomToolbar.css'

const TOOL_CONFIG = [
  {
    type: 'selection',
    label: 'Pointer',
    icon: Cursor,
  },
  // {
  //   type: 'image',
  //   label: 'Image',
  //   icon: ImageSquare,
  // },
  {
    type: 'text',
    label: 'Text',
    icon: TextT,
  },
  {
    type: 'rectangle',
    label: 'Rectangle',
    icon: Square,
  },
  {
    type: 'ellipse',
    label: 'Circle',
    icon: Circle,
  },
  {
    type: 'arrow',
    label: 'Arrow',
    icon: ArrowRight,
  },
  {
    type: 'freedraw',
    label: 'Free draw',
    icon: ScribbleLoop,
  },
  {
    type: 'frame',
    label: 'Frame',
    icon: FrameCorners,
  },
  {
    type: 'embeddable',
    label: 'Web embed',
    icon: Browsers,
  },
]

function CustomToolbar({ activeTool, onSelect, isDarkTheme }) {
  const containerClasses = ['custom-toolbar']
  if (isDarkTheme) {
    containerClasses.push('custom-toolbar--dark')
  }

  return (
    <div className={containerClasses.join(' ')}>
      {TOOL_CONFIG.map(({ type, label, icon }) => {
        const IconComponent = icon

        return (
          <button
            key={type}
            type="button"
            className={[
              'custom-toolbar__button',
              activeTool === type ? 'custom-toolbar__button--active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => onSelect(type)}
            aria-pressed={activeTool === type}
            aria-label={label}
          >
            <IconComponent size={18} weight={activeTool === type ? 'fill' : 'regular'} />
          </button>
        )
      })}
    </div>
  )
}

export default CustomToolbar

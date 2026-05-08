/* global __APP_VERSION__ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Excalidraw, exportToBlob } from '@excalidraw/excalidraw'
import {
  MoonStars,
  Sun,
  GridFour,
  Eye,
  EyeSlash,
  ChartLineUp,
  MagnifyingGlass,
  ClockClockwise,
  DiscordLogo,
} from '@phosphor-icons/react'
import '@excalidraw/excalidraw/index.css'

import './App.css'
import { useCollaboration } from './useCollaboration'
import { handleImageUpload, uploadAvatarToStorage } from './imageHandler'
import AvatarSetup from './AvatarSetup'
import CustomToolbar from './CustomToolbar'
import ColorPalette from './ColorPalette'
import { saveCanvasSnapshot } from './canvasSnapshots'
import { useAuth } from './AuthContext'

const APP_NAME = 'arcadia'

// Version info injected at build time
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'

function App() {
  const { drawingId } = useParams()
  const { user, userProfile } = useAuth()
  const excalidrawRef = useRef(null)
  const [excalidrawAPI, setExcalidrawAPI] = useState(null)
  const [theme, setTheme] = useState('dark')
  const [gridMode, setGridMode] = useState(false)
  const [viewMode, setViewMode] = useState(false)
  const [zenMode] = useState(true)
  const [activeTool, setActiveTool] = useState('selection')
  const pendingFilesRef = useRef({})
  const hoverInfoRef = useRef(null)
  const lastCursorUpdateRef = useRef(0)
  const lastSentCursorRef = useRef({ x: null, y: null })
  const [hoveredOwner, setHoveredOwner] = useState(null)
  const [viewportState, setViewportState] = useState({
    scrollX: 0,
    scrollY: 0,
    zoom: 1,
    offsetLeft: 0,
    offsetTop: 0,
  })
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isAvatarSetupOpen, setIsAvatarSetupOpen] = useState(false)
  const [hasDismissedAvatarPrompt, setHasDismissedAvatarPrompt] = useState(true)
  const [isManualAvatarEdit, setIsManualAvatarEdit] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [selectedColor, setSelectedColor] = useState('#212121')
  const [selectedBackgroundColor, setSelectedBackgroundColor] = useState('transparent')
  const [hasSelectedElements, setHasSelectedElements] = useState(false)
  const [colorMode, setColorMode] = useState('stroke') // 'stroke' or 'background'
  const [isExportingCanvas, setIsExportingCanvas] = useState(false)
  const menuRef = useRef(null)

  // Build an authUser object for the collaboration hook (memoized to avoid re-render loops)
  const authUser = useMemo(() => {
    if (!user) return null
    return {
      uid: user.uid,
      displayName: userProfile?.displayName || user.displayName || 'Anonymous',
      color: userProfile?.color || '#4ECDC4',
      photoURL: userProfile?.photoURL || user.photoURL || null,
    }
  }, [user?.uid, user?.displayName, user?.photoURL, userProfile?.displayName, userProfile?.color, userProfile?.photoURL])

  // Enable real-time collaboration
  const {
    isLoaded,
    userIdentity,
    onlineUsers,
    isAdmin,
    updateCursorPosition,
    updateUserProfile,
    saveChanges,
    isSaving,
    hasPendingChanges,
    lastSyncInfo,
  } = useCollaboration(
    excalidrawAPI,
    pendingFilesRef,
    { drawingId, authUser }
  )

  const syncIndicatorVariant = lastSyncInfo?.hadRemoteUpdates ? 'active' : 'idle'
  const syncIndicatorKey = lastSyncInfo?.timestamp ?? null

  const handleManualSave = useCallback(() => {
    if (!saveChanges) {
      return
    }
    const result = saveChanges('manual')
    if (result && typeof result.then === 'function') {
      result.catch((error) => {
        console.error('Manual save failed:', error)
      })
    }
  }, [saveChanges])

  const handleCanvasExport = useCallback(async () => {
    if (!isAdmin) {
      console.warn('Canvas export is restricted to admins.')
      return
    }

    if (!excalidrawAPI || isExportingCanvas) {
      return
    }

    setIsExportingCanvas(true)

    try {
      const elements =
        excalidrawAPI
          .getSceneElements()
          ?.filter((element) => element && !element.isDeleted) ?? []

      const appState = excalidrawAPI.getAppState() || {}
      const files =
        typeof excalidrawAPI.getFiles === 'function' ? excalidrawAPI.getFiles() : undefined

      const blob = await exportToBlob({
        elements,
        appState: {
          ...appState,
          exportBackground: true,
          viewBackgroundColor:
            appState?.viewBackgroundColor || (theme === 'dark' ? '#212121' : '#F3F1E4'),
        },
        files,
        mimeType: 'image/png',
        exportPadding: 16,
      })

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      link.href = url
      link.download = `${APP_NAME}-canvas-${timestamp}.png`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)

      await saveCanvasSnapshot(blob, {
        user: userIdentity,
        appVersion: APP_VERSION,
        theme,
        elementsCount: elements.length,
      })
    } catch (error) {
      console.error('Failed to export canvas:', error)
    } finally {
      setIsExportingCanvas(false)
    }
  }, [excalidrawAPI, isAdmin, isExportingCanvas, theme, userIdentity])

  useEffect(() => {
    if (!saveChanges) {
      return undefined
    }

    const interval = setInterval(() => {
      if (hasPendingChanges && !isSaving) {
        const result = saveChanges('autosave')
        if (result && typeof result.then === 'function') {
          result.catch((error) => {
            console.error('Autosave failed:', error)
          })
        }
      }
    }, 10000)

    return () => {
      clearInterval(interval)
    }
  }, [saveChanges, hasPendingChanges, isSaving])

  const handleThemeToggle = useCallback(() => {
    setTheme((current) => (current === 'light' ? 'dark' : 'light'))
  }, [])

  const handleGridToggle = useCallback(() => {
    setGridMode((current) => !current)
  }, [])

  const handleViewToggle = useCallback(() => {
    setViewMode((current) => !current)
  }, [])

  const closeMenu = useCallback(() => {
    setIsMenuOpen(false)
  }, [])

  const handleMenuToggle = useCallback(() => {
    setIsMenuOpen((previous) => !previous)
  }, [])

  const handleMenuThemeToggle = useCallback(() => {
    handleThemeToggle()
    closeMenu()
  }, [handleThemeToggle, closeMenu])

  const handleMenuGridToggle = useCallback(() => {
    handleGridToggle()
    closeMenu()
  }, [handleGridToggle, closeMenu])

  const handleMenuViewToggle = useCallback(() => {
    handleViewToggle()
    closeMenu()
  }, [handleViewToggle, closeMenu])

  const handleToolSelect = useCallback(
    (toolType) => {
      if (!excalidrawAPI) {
        return
      }
      excalidrawAPI.setActiveTool({ type: toolType })
      setActiveTool(toolType)
    },
    [excalidrawAPI]
  )

  const handleColorModeChange = useCallback((mode) => {
    setColorMode(mode)
  }, [])

  const handleColorSelect = useCallback(
    (color) => {
      if (!excalidrawAPI) {
        return
      }

      // Excalidraw automatically inverts very light and dark colors based on theme
      // To prevent Paper and Charcoal from swapping in dark mode, we pre-swap them
      let actualColor = color
      if (theme === 'dark') {
        if (color === '#F3F1E4') { // Paper in light mode -> Charcoal for dark mode
          actualColor = '#212121'
        } else if (color === '#212121') { // Charcoal in light mode -> Paper for dark mode
          actualColor = '#F3F1E4'
        }
      }

      if (colorMode === 'stroke') {
        setSelectedColor(color)
      } else {
        setSelectedBackgroundColor(color)
      }

      // Get currently selected elements
      const appState = excalidrawAPI.getAppState()
      const selectedElementIds = appState.selectedElementIds || {}
      const selectedIds = Object.keys(selectedElementIds).filter(id => selectedElementIds[id])

      if (selectedIds.length > 0) {
        // Update colors of selected elements
        const elements = excalidrawAPI.getSceneElements()
        const updatedElements = elements.map(element => {
          if (selectedIds.includes(element.id)) {
            if (colorMode === 'stroke') {
              return {
                ...element,
                strokeColor: actualColor,
                version: element.version + 1,
                versionNonce: Math.floor(Math.random() * 2 ** 31),
              }
            } else {
              // Background mode
              return {
                ...element,
                backgroundColor: actualColor,
                version: element.version + 1,
                versionNonce: Math.floor(Math.random() * 2 ** 31),
              }
            }
          }
          return element
        })

        excalidrawAPI.updateScene({
          elements: updatedElements,
          appState: {
            currentItemStrokeColor: colorMode === 'stroke' ? actualColor : appState.currentItemStrokeColor,
            currentItemBackgroundColor: colorMode === 'background' ? actualColor : appState.currentItemBackgroundColor,
          },
        })
      } else {
        // No selection, just update the current color for new elements
        excalidrawAPI.updateScene({
          appState: {
            currentItemStrokeColor: colorMode === 'stroke' ? actualColor : appState.currentItemStrokeColor,
            currentItemBackgroundColor: colorMode === 'background' ? actualColor : appState.currentItemBackgroundColor,
          },
        })
      }
    },
    [excalidrawAPI, colorMode, theme]
  )

  useEffect(() => {
    if (!isMenuOpen) {
      return undefined
    }

    const handleClickOutside = (event) => {
      if (!menuRef.current) {
        return
      }
      if (!menuRef.current.contains(event.target)) {
        closeMenu()
      }
    }

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        closeMenu()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isMenuOpen, closeMenu])

  useEffect(() => {
    if (userIdentity?.color && selectedColor === '#212121') {
      setSelectedColor(userIdentity.color)
    }
  }, [userIdentity, selectedColor])

  useEffect(() => {
    if (!excalidrawAPI || !selectedColor) {
      return
    }

    const currentAppState = excalidrawAPI.getAppState()

    if (currentAppState?.currentItemStrokeColor === selectedColor) {
      return
    }

    const nextAppState = {
      ...currentAppState,
      currentItemStrokeColor: selectedColor,
    }

    excalidrawAPI.updateScene({ appState: nextAppState })
  }, [excalidrawAPI, selectedColor])

  useEffect(() => {
    if (!userIdentity) {
      return
    }

    if (!userIdentity.avatarUrl && !hasDismissedAvatarPrompt) {
      setIsAvatarSetupOpen(true)
    } else if (!isManualAvatarEdit) {
      setIsAvatarSetupOpen(false)
    }
  }, [userIdentity, hasDismissedAvatarPrompt, isManualAvatarEdit])

  // Handle image paste/upload - upload to Firebase Storage
  const handlePaste = useCallback(
    async (data, event) => {
      // Check if clipboard contains files (images)
      const items = event?.clipboardData?.items
      if (!items || !userIdentity) return false

      for (let i = 0; i < items.length; i++) {
        const item = items[i]

        // Check if the item is an image
        if (item.type.indexOf('image') !== -1) {
          event.preventDefault()

          const file = item.getAsFile()
          if (!file) continue

          try {
            // Upload image to Firebase Storage
            console.log('Uploading pasted image...')
            const uploadedImage = await handleImageUpload(file, userIdentity.browserId)
            console.log('Image uploaded successfully:', uploadedImage.dataURL)

            // Create an image element directly without using Excalidraw's addFiles
            // This bypasses the Pica resizing that causes fingerprinting issues
            if (excalidrawAPI) {
              // Get viewport center to place image at cursor/center
              const appState = excalidrawAPI.getAppState()
              const viewportX = appState.scrollX || 0
              const viewportY = appState.scrollY || 0

              const imageElement = {
                type: 'image',
                id: uploadedImage.id,
                x: -viewportX + 100,
                y: -viewportY + 100,
                width: uploadedImage.width,
                height: uploadedImage.height,
                angle: 0,
                strokeColor: 'transparent',
                backgroundColor: 'transparent',
                fillStyle: 'hachure',
                strokeWidth: 1,
                strokeStyle: 'solid',
                roughness: 0,
                opacity: 100,
                groupIds: [],
                roundness: null,
                seed: Math.floor(Math.random() * 2 ** 31),
                version: 1,
                versionNonce: Math.floor(Math.random() * 2 ** 31),
                isDeleted: false,
                boundElements: null,
                updated: Date.now(),
                link: null,
                locked: false,
                fileId: uploadedImage.id,
                scale: [1, 1],
                status: 'saved',
                customData: {
                  createdBy: userIdentity.browserId,
                  createdByUsername: userIdentity.username,
                  createdByColor: userIdentity.color,
                },
              }

              // Store the file in pending files ref for collaboration sync
              pendingFilesRef.current[uploadedImage.id] = {
                id: uploadedImage.id,
                dataURL: uploadedImage.dataURL,
                mimeType: uploadedImage.mimeType,
                created: uploadedImage.created,
              }

              // Register the uploaded asset with Excalidraw so it can render immediately
              const newFile = {
                id: uploadedImage.id,
                dataURL: uploadedImage.dataURL,
                mimeType: uploadedImage.mimeType,
                created: uploadedImage.created,
                lastRetrieved: Date.now(),
              }

              excalidrawAPI.addFiles([newFile])

              const currentElements = excalidrawAPI.getSceneElements()

              // Inject the uploaded file and new element into the scene
              // The file will be synced via Firebase collaboration using pendingFilesRef
              excalidrawAPI.updateScene({
                elements: [...currentElements, imageElement],
              })

              // Explicitly trigger a save — updateScene fires onChange with source='api'
              // which is skipped by the collaboration handler, so we must manually flush
              // to ensure the file gets uploaded to Storage and written to RTDB
              setTimeout(() => {
                if (saveChanges) {
                  saveChanges('image-paste')
                }
              }, 100)

              console.log('Image element added to canvas, file stored for sync')
            }

            return true
          } catch (error) {
            console.error('Failed to upload image:', error)
            return false
          }
        }
      }

      return false
    },
    [excalidrawAPI, userIdentity]
  )

  const onlineCount = onlineUsers.length
  const visibleOnlineUsers = onlineUsers.slice(0, 5)
  const overflowCount = Math.max(onlineCount - visibleOnlineUsers.length, 0)

  const handleSearchToggle = useCallback(() => {
    if (!excalidrawAPI) {
      return
    }
    const open = excalidrawAPI.getAppState()?.openSidebar?.tab === 'search'
    excalidrawAPI.updateScene({
      appState: {
        openSidebar: open ? null : { name: 'default', tab: 'search' },
      },
    })
  }, [excalidrawAPI])

  const handleMenuSearchToggle = useCallback(() => {
    handleSearchToggle()
    closeMenu()
  }, [handleSearchToggle, closeMenu])

  const handleAvatarSave = useCallback(
    async (blob) => {
      if (!userIdentity?.browserId) {
        throw new Error('User identity not ready')
      }
      try {
        const avatarUrl = await uploadAvatarToStorage(blob, userIdentity.browserId)
        await updateUserProfile({ avatarUrl })
        setHasDismissedAvatarPrompt(true)
        setIsAvatarSetupOpen(false)
        setIsManualAvatarEdit(false)
      } catch (error) {
        console.error('Error saving avatar:', error)
        throw error
      }
    },
    [updateUserProfile, userIdentity]
  )

  const handleAvatarSkip = useCallback(() => {
    if (!userIdentity?.avatarUrl) {
      setHasDismissedAvatarPrompt(true)
    }
    setIsAvatarSetupOpen(false)
    setIsManualAvatarEdit(false)
  }, [userIdentity])

  const handleAvatarEdit = useCallback(() => {
    setIsManualAvatarEdit(true)
    setIsAvatarSetupOpen(true)
  }, [])

  useEffect(() => {
    if (!excalidrawAPI) {
      return undefined
    }

    const initialState = excalidrawAPI.getAppState()
    if (initialState) {
      setViewportState((prev) => ({
        ...prev,
        scrollX: initialState.scrollX ?? 0,
        scrollY: initialState.scrollY ?? 0,
        zoom: initialState.zoom?.value ?? initialState.zoom ?? 1,
        offsetLeft: initialState.offsetLeft ?? 0,
        offsetTop: initialState.offsetTop ?? 0,
      }))
    }

    const unsubscribe = excalidrawAPI.onScrollChange((scrollX, scrollY, zoom) => {
      const zoomValue =
        typeof zoom === 'number' ? zoom : typeof zoom?.value === 'number' ? zoom.value : 1

      setViewportState((prev) => {
        if (prev.scrollX === scrollX && prev.scrollY === scrollY && prev.zoom === zoomValue) {
          return prev
        }
        return {
          ...prev,
          scrollX,
          scrollY,
          zoom: zoomValue,
        }
      })
    })

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe()
      }
    }
  }, [excalidrawAPI])

  useEffect(() => {
    if (!excalidrawAPI) {
      return
    }

    const currentTool = excalidrawAPI.getAppState()?.activeTool?.type
    if (currentTool) {
      setActiveTool(currentTool)
    }
  }, [excalidrawAPI])

  useEffect(() => {
    if (!excalidrawAPI) {
      return undefined
    }

    const unsubscribe = excalidrawAPI.onChange((_, appState) => {
      const open = appState.openSidebar?.tab === 'search'
      setIsSearchOpen((prev) => (prev === open ? prev : open))

      const nextTool = appState.activeTool?.type || 'selection'
      setActiveTool((prev) => (prev === nextTool ? prev : nextTool))

      // Track if any elements are selected
      const selectedElementIds = appState.selectedElementIds || {}
      const hasSelection = Object.keys(selectedElementIds).some(id => selectedElementIds[id])
      setHasSelectedElements((prev) => (prev === hasSelection ? prev : hasSelection))
    })

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe()
      }
    }
  }, [excalidrawAPI])

  useEffect(() => {
    if (!excalidrawAPI) {
      return undefined
    }

    const updateOffsets = () => {
      const appState = excalidrawAPI.getAppState()
      if (!appState) {
        return
      }

      setViewportState((prev) => {
        const offsetLeft = appState.offsetLeft ?? 0
        const offsetTop = appState.offsetTop ?? 0
        if (prev.offsetLeft === offsetLeft && prev.offsetTop === offsetTop) {
          return prev
        }
        return {
          ...prev,
          offsetLeft,
          offsetTop,
        }
      })
    }

    updateOffsets()
    window.addEventListener('resize', updateOffsets)

    return () => {
      window.removeEventListener('resize', updateOffsets)
    }
  }, [excalidrawAPI])

  useEffect(() => {
    if (!excalidrawAPI || typeof window === 'undefined') {
      return
    }

    const clearHoverInfo = () => {
      hoverInfoRef.current = null
      setHoveredOwner(null)
    }

    const handlePointerMove = (event) => {
      const appState = excalidrawAPI.getAppState()
      if (!appState) {
        clearHoverInfo()
        return
      }

      if (appState.cursorButton === 'down') {
        clearHoverInfo()
        return
      }

      const { offsetLeft = 0, offsetTop = 0, width = 0, height = 0 } = appState
      const viewportX = event.clientX - offsetLeft
      const viewportY = event.clientY - offsetTop

      if (viewportX < 0 || viewportY < 0 || viewportX > width || viewportY > height) {
        clearHoverInfo()
        return
      }

      const zoom = appState.zoom?.value ?? 1
      const sceneX = viewportX / zoom - (appState.scrollX ?? 0)
      const sceneY = viewportY / zoom - (appState.scrollY ?? 0)

      setViewportState((prev) => {
        const offsetLeftValue = appState.offsetLeft ?? 0
        const offsetTopValue = appState.offsetTop ?? 0
        if (prev.offsetLeft === offsetLeftValue && prev.offsetTop === offsetTopValue) {
          return prev
        }
        return {
          ...prev,
          offsetLeft: offsetLeftValue,
          offsetTop: offsetTopValue,
        }
      })

      if (userIdentity && updateCursorPosition) {
        const now = performance.now()
        if (now - lastCursorUpdateRef.current > 50) {
          lastCursorUpdateRef.current = now
          const lastSent = lastSentCursorRef.current
          if (
            lastSent.x === null ||
            Math.abs(sceneX - lastSent.x) > 0.5 ||
            Math.abs(sceneY - lastSent.y) > 0.5
          ) {
            lastSentCursorRef.current = { x: sceneX, y: sceneY }
            updateCursorPosition({
              x: sceneX,
              y: sceneY,
              color: userIdentity.color,
              username: userIdentity.username,
            })
          }
        }
      }

      const elements = excalidrawAPI.getSceneElements().filter(
        (element) => !element.isDeleted && element.type !== 'selection'
      )

      const getElementBounds = (element) => {
        const angle = element.angle || 0

        const calculateRotatedPoint = (pointX, pointY, centerX, centerY) => {
          const cosAngle = Math.cos(angle)
          const sinAngle = Math.sin(angle)
          const translatedX = pointX - centerX
          const translatedY = pointY - centerY

          return {
            x: translatedX * cosAngle - translatedY * sinAngle + centerX,
            y: translatedX * sinAngle + translatedY * cosAngle + centerY,
          }
        }

        const corners = [
          { x: element.x, y: element.y },
          { x: element.x + element.width, y: element.y },
          { x: element.x + element.width, y: element.y + element.height },
          { x: element.x, y: element.y + element.height },
        ]

        const centerX = element.x + element.width / 2
        const centerY = element.y + element.height / 2

        const rotatedCorners =
          angle === 0
            ? corners
            : corners.map(({ x, y }) => calculateRotatedPoint(x, y, centerX, centerY))

        const xs = rotatedCorners.map((corner) => corner.x)
        const ys = rotatedCorners.map((corner) => corner.y)

        const margin =
          Math.max(8 / zoom, (element.strokeWidth || 1) / zoom) +
          (element.type === 'arrow' || element.type === 'line' ? 4 / zoom : 0)

        return {
          minX: Math.min(...xs) - margin,
          maxX: Math.max(...xs) + margin,
          minY: Math.min(...ys) - margin,
          maxY: Math.max(...ys) + margin,
        }
      }

      let hoveredElement = null
      for (let index = elements.length - 1; index >= 0; index -= 1) {
        const element = elements[index]

        if (!element) {
          continue
        }

        const bounds = getElementBounds(element)

        if (
          sceneX >= bounds.minX &&
          sceneX <= bounds.maxX &&
          sceneY >= bounds.minY &&
          sceneY <= bounds.maxY
        ) {
          hoveredElement = element
          break
        }
      }

      if (!hoveredElement) {
        clearHoverInfo()
        return
      }

      const customData = hoveredElement.customData || {}
      const ownerId = customData.createdBy
      const presenceOwner = onlineUsers.find((user) => user.id === ownerId)
      const ownerName =
        customData.createdByUsername ||
        presenceOwner?.username ||
        (ownerId ? `User ${ownerId.substring(0, 6)}` : 'Unknown owner')
      const ownerColor =
        customData.createdByColor || presenceOwner?.color || '#4ECDC4'

      const offset = 16
      const maxWidth = 220
      const maxHeight = 72
      const targetX = Math.min(event.clientX + offset, window.innerWidth - maxWidth)
      const targetY = Math.min(event.clientY + offset, window.innerHeight - maxHeight)

      const nextHoverInfo = {
        elementId: hoveredElement.id,
        ownerId,
        ownerName,
        ownerColor,
        position: { x: targetX, y: targetY },
      }

      hoverInfoRef.current = nextHoverInfo
      setHoveredOwner((prev) => {
        if (
          prev &&
          prev.elementId === nextHoverInfo.elementId &&
          prev.ownerName === nextHoverInfo.ownerName &&
          prev.ownerColor === nextHoverInfo.ownerColor &&
          Math.abs(prev.position.x - nextHoverInfo.position.x) < 1 &&
          Math.abs(prev.position.y - nextHoverInfo.position.y) < 1
        ) {
          return prev
        }
        return nextHoverInfo
      })
    }

    const handlePointerDown = () => {
      clearHoverInfo()
    }
    const handlePointerLeave = () => {
      clearHoverInfo()
      if (updateCursorPosition) {
        updateCursorPosition(null)
      }
      lastSentCursorRef.current = { x: null, y: null }
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    window.addEventListener('pointerdown', handlePointerDown, { passive: true })
    window.addEventListener('pointerleave', handlePointerLeave, { passive: true })

    return () => {
      if (updateCursorPosition) {
        updateCursorPosition(null)
      }
      lastSentCursorRef.current = { x: null, y: null }
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('pointerleave', handlePointerLeave)
    }
  }, [excalidrawAPI, onlineUsers, updateCursorPosition, userIdentity])

  const now = Date.now()

  const remoteCursorElements = onlineUsers
    .filter((user) => user.id !== userIdentity?.browserId)
    .map((user) => {
      const cursor = user.cursor
      if (!cursor) {
        return null
      }

      if (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) {
        return null
      }

      const updatedAt = cursor.syncedAt ?? cursor.updatedAt ?? 0
      if (now - updatedAt > 15000) {
        return null
      }

      const screenX = (cursor.x + viewportState.scrollX) * viewportState.zoom + viewportState.offsetLeft
      const screenY = (cursor.y + viewportState.scrollY) * viewportState.zoom + viewportState.offsetTop

      if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) {
        return null
      }

      const label = cursor.username || user.username || 'Guest'
      const color = cursor.color || user.color || '#4ECDC4'

      return (
        <div
          key={`cursor-${user.id}`}
          className="remote-cursor"
          style={{ top: screenY, left: screenX }}
        >
          <span className="remote-cursor__icon" style={{ backgroundColor: color }} />
          <span className="remote-cursor__label" style={{ borderColor: color }}>
            {label}
          </span>
        </div>
      )
    })
    .filter(Boolean)

  return (
    <div className={`app app-${theme}`}>
      <div className="floating-brand" ref={menuRef}>
        <button
          type="button"
          className={`brand-trigger${isMenuOpen ? ' brand-trigger--open' : ''}`}
          onClick={handleMenuToggle}
          aria-expanded={isMenuOpen}
          aria-controls="brand-menu"
        >
          <img
            src="/arcadia-icon.png"
            alt="Arcadia logo"
            className="brand-trigger__logo"
            width="40"
            height="40"
          />
          <div className="brand-trigger__title">
            <span className="brand-trigger__name">{APP_NAME}</span>
            <span className="version-info">v{APP_VERSION}</span>
          </div>
        </button>
        <a
          href="https://discord.com/invite/kuzXr2Vh"
          className="brand-discord-link"
          target="_blank"
          rel="noreferrer"
        >
          <DiscordLogo size={18} weight="fill" />
          <span>Hang with us on Discord</span>
        </a>
        <div
          id="brand-menu"
          className={`brand-menu${isMenuOpen ? ' brand-menu--open' : ''}`}
          aria-hidden={!isMenuOpen}
        >
          <div className="brand-menu__section brand-menu__actions">
            <button
              type="button"
              className={`brand-menu__item${isSearchOpen ? ' brand-menu__item--active' : ''}`}
              onClick={handleMenuSearchToggle}
            >
              <MagnifyingGlass size={18} weight={isSearchOpen ? 'fill' : 'regular'} />
              <span>{isSearchOpen ? 'Close search' : 'Open search'}</span>
            </button>
            <button
              type="button"
              className="brand-menu__item"
              onClick={handleMenuThemeToggle}
            >
              {theme === 'light' ? <MoonStars size={18} weight="fill" /> : <Sun size={18} weight="fill" />}
              <span>{theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}</span>
            </button>
            <button
              type="button"
              className={`brand-menu__item${gridMode ? ' brand-menu__item--active' : ''}`}
              onClick={handleMenuGridToggle}
            >
              <GridFour size={18} weight={gridMode ? 'fill' : 'regular'} />
              <span>{gridMode ? 'Hide grid' : 'Show grid'}</span>
            </button>
            <button
              type="button"
              className={`brand-menu__item${viewMode ? ' brand-menu__item--active' : ''}`}
              onClick={handleMenuViewToggle}
            >
              {viewMode ? <EyeSlash size={18} weight="fill" /> : <Eye size={18} weight="regular" />}
              <span>{viewMode ? 'Exit view mode' : 'Enter view mode'}</span>
            </button>
            <a
              href="/analytics"
              className="brand-menu__item brand-menu__item--link"
              onClick={closeMenu}
            >
              <ChartLineUp size={18} weight="regular" />
              <span>Open analytics</span>
            </a>
            <a
              href="/timeline"
              className="brand-menu__item brand-menu__item--link"
              onClick={closeMenu}
            >
              <ClockClockwise size={18} weight="regular" />
              <span>View timeline</span>
            </a>
          </div>
        </div>
      </div>

      <CustomToolbar
        activeTool={activeTool}
        onSelect={handleToolSelect}
        isDarkTheme={theme === 'dark'}
      />

      {(hasSelectedElements || activeTool !== 'selection') && (
        <ColorPalette
          selectedColor={colorMode === 'stroke' ? selectedColor : selectedBackgroundColor}
          onColorSelect={handleColorSelect}
          colorMode={colorMode}
          onModeChange={handleColorModeChange}
          isDarkTheme={theme === 'dark'}
        />
      )}

      <main className="canvas-area">
        {syncIndicatorKey && (
          <div
            key={syncIndicatorKey}
            className={`sync-indicator sync-indicator--${syncIndicatorVariant}`}
            aria-hidden="true"
          />
        )}
        {!isLoaded && (
          <div className="loading-overlay">
            <div className="loading-message">Loading shared canvas...</div>
          </div>
        )}
        {userIdentity && (
          <div className="user-hud">
            <div className="user-tray">
              <button
                type="button"
                className="presence-toggle"
                onClick={() => setIsMenuOpen(false)}
                aria-label={`${onlineCount} ${onlineCount === 1 ? 'person' : 'people'} online`}
              >
                {onlineCount}
              </button>
              <div className="user-tray__panel">
                <div className="save-controls" aria-live="polite">
                  <button
                    type="button"
                    className="save-controls__button"
                    onClick={handleManualSave}
                    disabled={!hasPendingChanges && !isSaving}
                  >
                    {isSaving ? 'Saving…' : hasPendingChanges ? 'Save changes' : 'Save'}
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      className="save-controls__button save-controls__button--secondary"
                      onClick={handleCanvasExport}
                      disabled={!excalidrawAPI || isExportingCanvas}
                    >
                      {isExportingCanvas ? 'Exporting…' : 'Export image'}
                    </button>
                  )}
                </div>
                <div className="presence-summary" aria-live="polite">
                  <span className="presence-summary__dot" />
                  <div className="presence-summary__text">
                    <span className="presence-summary__count">{onlineCount}</span>
                    <span className="presence-summary__label">
                      {onlineCount === 1 ? 'person online' : 'people online'}
                    </span>
                  </div>
                  {visibleOnlineUsers.length > 0 && (
                    <div className="presence-summary__avatars" role="list">
                      {visibleOnlineUsers.map((user) => (
                        <span
                          role="listitem"
                          key={user.id}
                          className={`presence-summary__avatar${user.avatarUrl ? ' presence-summary__avatar--image' : ''}`}
                          style={{ backgroundColor: user.color }}
                          title={user.username}
                        >
                          {user.avatarUrl ? (
                            <img src={user.avatarUrl} alt={`${user.username ?? 'Guest'} avatar`} />
                          ) : (
                            user.username?.charAt(0)?.toUpperCase() ?? '?'
                          )}
                        </span>
                      ))}
                      {overflowCount > 0 && <span className="presence-summary__more">+{overflowCount}</span>}
                    </div>
                  )}
                </div>
                <div className="user-card">
                  <button
                    type="button"
                    className={`user-card__portrait${userIdentity.avatarUrl ? ' user-card__portrait--image' : ''}`}
                    onClick={handleAvatarEdit}
                    aria-label={userIdentity.avatarUrl ? 'Edit avatar' : 'Add avatar'}
                  >
                    {userIdentity.avatarUrl ? (
                      <img src={userIdentity.avatarUrl} alt={`${userIdentity.username} avatar`} />
                    ) : (
                      <span className="user-card__initial">
                        {userIdentity.username?.charAt(0)?.toUpperCase() ?? '?'}
                      </span>
                    )}
                  </button>
                  <div className="user-card__footer">
                    <span className="user-card__label">You are</span>
                    <span
                      className="user-card__name"
                      style={{ color: userIdentity.color }}
                    >
                      {userIdentity.username}
                    </span>
                    <div className="user-card__meta">
                      {isAdmin && <span className="user-role-badge">Admin</span>}
                      <button type="button" className="user-card__edit" onClick={handleAvatarEdit}>
                        {userIdentity.avatarUrl ? 'Edit avatar' : 'Add avatar'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        <Excalidraw
          ref={excalidrawRef}
          excalidrawAPI={setExcalidrawAPI}
          theme={theme}
          localStorageKey={null}
          viewModeEnabled={viewMode}
          zenModeEnabled={zenMode}
          gridModeEnabled={gridMode}
          onPaste={handlePaste}
          validateEmbeddable={() => true}
          UIOptions={{
            canvasActions: {
              toggleTheme: false,
              viewBackgroundColor: false,
            },
          }}
          initialData={{
            appState: {
              name: APP_NAME,
              currentItemStrokeColor: selectedColor,
              currentItemBackgroundColor: 'transparent',
            },
          }}
        />
      </main>
      {remoteCursorElements}
      {hoveredOwner && (
        <div
          className="element-owner-tooltip"
          style={{
            top: hoveredOwner.position.y,
            left: hoveredOwner.position.x,
          }}
        >
          <span
            className="owner-tooltip-dot"
            style={{ backgroundColor: hoveredOwner.ownerColor }}
          />
          <div className="owner-tooltip-text">
            <span className="owner-tooltip-label">Owned by</span>
            <span className="owner-tooltip-value">{hoveredOwner.ownerName}</span>
          </div>
        </div>
      )}
      <AvatarSetup
        isOpen={isAvatarSetupOpen}
        onSave={handleAvatarSave}
        onSkip={handleAvatarSkip}
        accentColor={userIdentity?.color}
        initialAvatarUrl={userIdentity?.avatarUrl || null}
      />
    </div>
  )
}

export default App

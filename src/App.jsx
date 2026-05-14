/* global __APP_VERSION__ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate } from 'react-router-dom'
import { ref, get, set, onValue, update as rtdbUpdate, serverTimestamp } from 'firebase/database'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { database, storage } from './firebase'
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
  House,
  CaretRight,
  ShareNetwork,
  Users,
  LinkSimple,
  Check,
} from '@phosphor-icons/react'
import '@excalidraw/excalidraw/index.css'

import './App.css'
import { useCollaboration } from './useCollaboration'
import { handleImageUpload, uploadAvatarToStorage } from './imageHandler'
import AvatarSetup from './AvatarSetup'
// import CustomToolbar from './CustomToolbar'
// import ColorPalette from './ColorPalette'
import { saveCanvasSnapshot } from './canvasSnapshots'
import { useAuth } from './AuthContext'

const APP_NAME = 'arcadia'

// Version info injected at build time
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'

function App() {
  const { drawingId } = useParams()
  const navigate = useNavigate()
  const { user, userProfile } = useAuth()
  const excalidrawRef = useRef(null)
  const [excalidrawAPI, setExcalidrawAPI] = useState(null)
  const [theme, setTheme] = useState('dark')
  const [gridMode, setGridMode] = useState(false)
  const [viewMode, setViewMode] = useState(false)
  const [zenMode] = useState(false)
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
  const [drawingMeta, setDrawingMeta] = useState({ name: '', workspaceName: '' })
  const lastThumbnailAtRef = useRef(0)
  const THUMBNAIL_THROTTLE_MS = 30_000 // generate thumbnail at most every 30s

  // Share dialog state
  const [isShareOpen, setIsShareOpen] = useState(false)
  const [shareEmail, setShareEmail] = useState('')
  const [shareRole, setShareRole] = useState('editor')
  const [shareStatus, setShareStatus] = useState(null) // null | 'sending' | 'success' | 'error'
  const [shareError, setShareError] = useState('')
  const [copiedLink, setCopiedLink] = useState(false)

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

  // Fetch drawing name + workspace name for breadcrumb
  useEffect(() => {
    if (!drawingId) return undefined

    const metaRef = ref(database, `drawings/${drawingId}/meta`)
    const unsubscribe = onValue(metaRef, async (snapshot) => {
      const meta = snapshot.val()
      if (!meta) return

      let wsName = ''
      if (meta.workspaceId) {
        try {
          const wsSnap = await get(ref(database, `workspaces/${meta.workspaceId}/meta/name`))
          wsName = wsSnap.val() || ''
        } catch (_) {
          wsName = ''
        }
      }

      setDrawingMeta({ name: meta.name || 'Untitled', workspaceName: wsName })
    })

    return () => unsubscribe()
  }, [drawingId])

  // Generate + upload a small thumbnail for the dashboard preview
  const generateThumbnail = useCallback(async () => {
    if (!excalidrawAPI || !drawingId) return

    // Throttle: only generate once per THUMBNAIL_THROTTLE_MS
    const now = Date.now()
    if (now - lastThumbnailAtRef.current < THUMBNAIL_THROTTLE_MS) return
    lastThumbnailAtRef.current = now

    try {
      const elements = excalidrawAPI
        .getSceneElements()
        ?.filter((el) => el && !el.isDeleted) ?? []

      if (elements.length === 0) return // skip empty canvases

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
        maxWidthOrHeight: 480,
      })

      // Upload to Storage
      const thumbRef = storageRef(storage, `drawings/${drawingId}/thumbnail.png`)
      await uploadBytes(thumbRef, blob, { contentType: 'image/png' })
      const downloadURL = await getDownloadURL(thumbRef)

      // Write URL to drawing meta
      await rtdbUpdate(ref(database, `drawings/${drawingId}/meta`), {
        thumbnailUrl: downloadURL,
        thumbnailUpdatedAt: now,
      })
    } catch (error) {
      // Thumbnail failures are non-critical — don't break the save flow
      console.warn('Thumbnail generation failed:', error)
    }
  }, [excalidrawAPI, drawingId, theme, THUMBNAIL_THROTTLE_MS])

  // Generate initial thumbnail ~5s after loading (lets canvas render first)
  const hasGeneratedInitialThumb = useRef(false)
  useEffect(() => {
    if (!excalidrawAPI || !drawingId || hasGeneratedInitialThumb.current) return undefined
    const timer = setTimeout(() => {
      hasGeneratedInitialThumb.current = true
      // Force-reset the throttle so it runs immediately
      lastThumbnailAtRef.current = 0
      generateThumbnail()
    }, 5000)
    return () => clearTimeout(timer)
  }, [excalidrawAPI, drawingId, generateThumbnail])

  // ── Share drawing handlers ──
  const handleOpenShare = useCallback(() => {
    setShareEmail('')
    setShareRole('editor')
    setShareStatus(null)
    setShareError('')
    setCopiedLink(false)
    setIsShareOpen(true)
  }, [])

  const handleCopyLink = useCallback(async () => {
    try {
      const url = `${window.location.origin}/draw/${drawingId}`
      await navigator.clipboard.writeText(url)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2500)
    } catch {
      // Fallback
      const url = `${window.location.origin}/draw/${drawingId}`
      const input = document.createElement('input')
      input.value = url
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      input.remove()
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2500)
    }
  }, [drawingId])

  const handleShareInvite = useCallback(async () => {
    if (!shareEmail.trim() || !drawingId || !user) return
    setShareStatus('sending')
    setShareError('')

    try {
      // Look up user by email
      const usersRef = ref(database, 'users')
      const snapshot = await get(usersRef)
      const usersData = snapshot.val() || {}

      const targetUid = Object.entries(usersData).find(
        ([, userData]) => userData.profile?.email?.toLowerCase() === shareEmail.trim().toLowerCase()
      )?.[0]

      if (!targetUid) {
        setShareStatus('error')
        setShareError('User not found. They need to sign in at least once.')
        return
      }

      if (targetUid === user.uid) {
        setShareStatus('error')
        setShareError("That's your own account!")
        return
      }

      // Grant access
      await set(ref(database, `drawing_access/${drawingId}/${targetUid}`), true)
      await rtdbUpdate(ref(database, `drawings/${drawingId}/members/${targetUid}`), {
        role: shareRole,
        addedAt: serverTimestamp(),
        addedBy: user.uid,
      })

      setShareStatus('success')
      setShareEmail('')
      setTimeout(() => setShareStatus(null), 3000)
    } catch (error) {
      console.error('Error sharing:', error)
      setShareStatus('error')
      setShareError('Something went wrong. Please try again.')
    }
  }, [shareEmail, shareRole, drawingId, user])

  const handleManualSave = useCallback(() => {
    if (!saveChanges) {
      return
    }
    const result = saveChanges('manual')
    if (result && typeof result.then === 'function') {
      result
        .then(() => generateThumbnail())
        .catch((error) => {
          console.error('Manual save failed:', error)
        })
    }
  }, [saveChanges, generateThumbnail])

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
          result
            .then(() => generateThumbnail())
            .catch((error) => {
              console.error('Autosave failed:', error)
            })
        }
      }
    }, 10000)

    return () => {
      clearInterval(interval)
    }
  }, [saveChanges, hasPendingChanges, isSaving, generateThumbnail])

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
  // IMPORTANT: Excalidraw's onPaste convention:
  //   return false  → BLOCK Excalidraw's native paste (we handled it)
  //   return true   → ALLOW Excalidraw to proceed with its own paste
  const handlePaste = useCallback(
    async (data, event) => {
      // Check if clipboard contains files (images)
      const items = event?.clipboardData?.items
      if (!items || !userIdentity) {
        // No clipboard items or no user identity — let Excalidraw handle it
        return true
      }

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

            // We handled the image paste — block Excalidraw's default paste
            return false
          } catch (error) {
            console.error('Failed to upload image:', error)
            // Error during image upload — let Excalidraw handle it
            return true
          }
        }
      }

      // No image items found — let Excalidraw handle the paste natively
      // (this is the path for element copy/paste, text paste, etc.)
      return true
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
      {/* ── Back to Home + Breadcrumb ── */}
      <div className="canvas-breadcrumb">
        <button
          type="button"
          className="back-home-btn"
          onClick={() => navigate('/')}
          title="Back to dashboard"
        >
          <House size={16} weight="fill" />
        </button>
        {drawingMeta.name && (
          <div className="canvas-breadcrumb__trail">
            <CaretRight size={12} weight="bold" className="canvas-breadcrumb__sep" />
            {drawingMeta.workspaceName ? (
              <>
                <span className="canvas-breadcrumb__workspace">{drawingMeta.workspaceName}</span>
                <CaretRight size={10} weight="bold" className="canvas-breadcrumb__sep" />
              </>
            ) : null}
            <span className="canvas-breadcrumb__drawing">{drawingMeta.name}</span>
          </div>
        )}
        <span className="canvas-breadcrumb__spacer" />
        <button
          type="button"
          className="canvas-breadcrumb__share-btn"
          onClick={handleOpenShare}
          title="Share this drawing"
        >
          <ShareNetwork size={14} weight="bold" />
          <span>Share</span>
        </button>
      </div>

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
        {/* <a
          href="https://discord.com/invite/kuzXr2Vh"
          className="brand-discord-link"
          target="_blank"
          rel="noreferrer"
        >
          <DiscordLogo size={18} weight="fill" />
          <span>Hang with us on Discord</span>
        </a> */}
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

        {/* ── Figma-style presence bar ── */}
        {userIdentity && (
          <div className="presence-bar" role="group" aria-label="People on this canvas">
            {/* Other online users — stacked avatars */}
            <div className="presence-bar__others" role="list">
              {visibleOnlineUsers
                .filter((u) => u.id !== userIdentity.browserId)
                .map((user, idx) => (
                  <span
                    role="listitem"
                    key={user.id}
                    className={`presence-bar__avatar${user.avatarUrl ? ' presence-bar__avatar--image' : ''}`}
                    style={{
                      backgroundColor: user.color,
                      borderColor: user.color,
                      zIndex: 10 - idx,
                    }}
                    title={user.username}
                  >
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt={`${user.username ?? 'Guest'}`} />
                    ) : (
                      user.username?.charAt(0)?.toUpperCase() ?? '?'
                    )}
                    <span className="presence-bar__online-dot" />
                  </span>
                ))}
              {overflowCount > 0 && (
                <span className="presence-bar__overflow">+{overflowCount}</span>
              )}
            </div>

            {/* Separator */}
            {visibleOnlineUsers.filter((u) => u.id !== userIdentity.browserId).length > 0 && (
              <span className="presence-bar__sep" />
            )}

            {/* "You" avatar — opens save/export tray */}
            <div className="presence-bar__self-wrap">
              <button
                type="button"
                className={`presence-bar__avatar presence-bar__avatar--self${userIdentity.avatarUrl ? ' presence-bar__avatar--image' : ''}`}
                style={{
                  backgroundColor: userIdentity.color,
                  borderColor: userIdentity.color,
                }}
                onClick={handleAvatarEdit}
                aria-label="Your profile"
                title={`${userIdentity.username} (you)`}
              >
                {userIdentity.avatarUrl ? (
                  <img src={userIdentity.avatarUrl} alt={`${userIdentity.username} avatar`} />
                ) : (
                  userIdentity.username?.charAt(0)?.toUpperCase() ?? '?'
                )}
                <span className="presence-bar__online-dot presence-bar__online-dot--you" />
              </button>

              {/* Save controls dropdown */}
              <div className="presence-bar__save-tray">
                <button
                  type="button"
                  className="save-controls__button"
                  onClick={handleManualSave}
                  disabled={!hasPendingChanges && !isSaving}
                >
                  {isSaving ? 'Saving…' : hasPendingChanges ? 'Save changes' : 'Saved'}
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
              toggleTheme: true,
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
      {/* ── Share Dialog Modal (portaled to body to escape Excalidraw z-index) ── */}
      {isShareOpen && createPortal(
        <div className="share-overlay" onClick={() => setIsShareOpen(false)}>
          <div className="share-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="share-dialog__header">
              <h2 className="share-dialog__title">
                <Users size={20} />
                <span>Share drawing</span>
              </h2>
              {drawingMeta.name && (
                <span className="share-dialog__drawing-name">{drawingMeta.name}</span>
              )}
            </div>

            {/* Copy link row */}
            <button
              type="button"
              className={`share-dialog__copy-link${copiedLink ? ' share-dialog__copy-link--copied' : ''}`}
              onClick={handleCopyLink}
            >
              {copiedLink ? (
                <><Check size={16} weight="bold" /> Link copied!</>
              ) : (
                <><LinkSimple size={16} weight="bold" /> Copy drawing link</>
              )}
            </button>

            {/* Invite by email */}
            <div className="share-dialog__invite-section">
              <span className="share-dialog__label">Invite by email</span>
              <div className="share-dialog__body">
                <input
                  type="email"
                  className="share-dialog__input"
                  placeholder="colleague@company.com"
                  value={shareEmail}
                  onChange={(e) => setShareEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleShareInvite() }}
                  autoFocus
                />
                <select
                  className="share-dialog__select"
                  value={shareRole}
                  onChange={(e) => setShareRole(e.target.value)}
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button
                  type="button"
                  className="share-dialog__btn"
                  onClick={handleShareInvite}
                  disabled={shareStatus === 'sending' || !shareEmail.trim()}
                >
                  {shareStatus === 'sending' ? 'Inviting…' : 'Invite'}
                </button>
              </div>
              {shareStatus === 'success' && (
                <span className="share-dialog__feedback share-dialog__feedback--success">
                  <Check size={14} weight="bold" /> Invited successfully!
                </span>
              )}
              {shareStatus === 'error' && (
                <span className="share-dialog__feedback share-dialog__feedback--error">
                  {shareError}
                </span>
              )}
            </div>

            <button
              type="button"
              className="share-dialog__close"
              onClick={() => setIsShareOpen(false)}
            >
              Done
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

export default App

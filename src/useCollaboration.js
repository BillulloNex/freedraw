import { useCallback, useEffect, useRef, useState } from 'react'
import {
  get,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  onDisconnect,
  onValue,
  push,
  ref,
  serverTimestamp,
  set,
  update,
} from 'firebase/database'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { database, storage } from './firebase'
import { getOrCreateUserIdentity, updateStoredUserIdentity } from './userIdentity'

// --- Firebase Storage helpers for image files ---

/**
 * Upload a base64 dataURL to Firebase Storage and return the download URL.
 * Path: drawings/{drawingId}/files/{fileId}
 */
const uploadFileToStorage = async (drawingId, fileId, dataURL, mimeType) => {
  try {
    // Convert base64 dataURL to a Blob
    const response = await fetch(dataURL)
    const blob = await response.blob()

    const fileRef = storageRef(storage, `drawings/${drawingId}/files/${fileId}`)
    await uploadBytes(fileRef, blob, { contentType: mimeType || 'image/png' })
    const downloadURL = await getDownloadURL(fileRef)
    return downloadURL
  } catch (error) {
    console.error(`Failed to upload file ${fileId} to Storage:`, error)
    return null
  }
}

/**
 * Fetch an image from a URL and convert it to a base64 dataURL string.
 * Falls back to Firebase Storage SDK if direct fetch fails (CORS/auth).
 */
const fetchFileAsDataURL = async (url, mimeType, storagePath) => {
  // Attempt 1: Direct fetch (works if CORS is configured)
  try {
    const response = await fetch(url)
    if (response.ok) {
      const blob = await response.blob()
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
    }
  } catch (error) {
    console.warn('Direct fetch failed, trying SDK fallback:', error.message)
  }

  // Attempt 2: Use Firebase Storage SDK to get a fresh download URL
  if (storagePath) {
    try {
      const fileRef = storageRef(storage, storagePath)
      const freshUrl = await getDownloadURL(fileRef)
      const response = await fetch(freshUrl)
      const blob = await response.blob()
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
    } catch (error) {
      console.error('SDK fallback also failed:', error)
    }
  }

  console.error('Failed to fetch file from Storage via all methods')
  return null
}

/**
 * Check if a file record is a storage reference (not a full dataURL).
 */
const isStorageReference = (fileValue) => {
  return fileValue && fileValue.storageUrl && !fileValue.dataURL
}

/**
 * Resolve a storage reference into a full Excalidraw file object.
 */
const resolveStorageFile = async (fileValue) => {
  if (!isStorageReference(fileValue)) return fileValue
  const dataURL = await fetchFileAsDataURL(fileValue.storageUrl, fileValue.mimeType, fileValue.storagePath)
  if (!dataURL) return null
  return {
    id: fileValue.id,
    mimeType: fileValue.mimeType || 'image/png',
    dataURL,
    created: fileValue.created || Date.now(),
    lastRetrieved: Date.now(),
  }
}

// Path builders — parameterized by drawingId
const buildPaths = (drawingId) => {
  const root = `drawings/${drawingId}/canvas`
  return {
    CANVAS_ROOT_PATH: root,
    CANVAS_ELEMENTS_PATH: `${root}/elements`,
    CANVAS_APP_STATE_PATH: `${root}/appState`,
    CANVAS_FILES_PATH: `${root}/files`,
    CANVAS_METADATA_PATH: `${root}/metadata`,
    LEGACY_CANVAS_PATH: `${root}/scene`,
    PRESENCE_PATH: `presence/${drawingId}/users`,
    SESSIONS_PATH: `sessions/${drawingId}`,
  }
}
const ADMIN_PATH = 'roles/admins'
const HEARTBEAT_INTERVAL = 20000

const cloneElement = (element) => {
  if (typeof structuredClone === 'function') {
    return structuredClone(element)
  }
  return JSON.parse(JSON.stringify(element))
}

const cloneElements = (elements = []) => elements.map((el) => cloneElement(el))

const normalizeElementForCompare = (element) => {
  if (!element) {
    return null
  }
  const normalized = { ...element }
  delete normalized.updated
  return normalized
}

const elementsAreEqual = (a, b) => {
  if (!a && !b) return true
  if (!a || !b) return false
  return JSON.stringify(normalizeElementForCompare(a)) === JSON.stringify(normalizeElementForCompare(b))
}

const sanitizeElement = (element) => {
  if (!element || typeof element !== 'object') {
    return null
  }
  if (typeof element.id !== 'string' || typeof element.type !== 'string') {
    return null
  }

  const sanitized = { ...element }

  sanitized.groupIds = Array.isArray(element.groupIds)
    ? element.groupIds.filter((groupId) => typeof groupId === 'string')
    : []

  if (Array.isArray(element.boundElements)) {
    sanitized.boundElements = element.boundElements.filter((binding) => {
      if (!binding || typeof binding !== 'object') {
        return false
      }
      const { id, type } = binding
      return typeof id === 'string' && typeof type === 'string'
    })
  } else {
    sanitized.boundElements = Array.isArray(element.boundElements) ? [] : null
  }

  if (typeof element.width !== 'number' || Number.isNaN(element.width)) {
    sanitized.width = 0
  }
  if (typeof element.height !== 'number' || Number.isNaN(element.height)) {
    sanitized.height = 0
  }
  if (typeof element.x !== 'number' || Number.isNaN(element.x)) {
    sanitized.x = 0
  }
  if (typeof element.y !== 'number' || Number.isNaN(element.y)) {
    sanitized.y = 0
  }

  if (typeof element.angle !== 'number' || Number.isNaN(element.angle)) {
    sanitized.angle = 0
  }

  const needsPoints = element.type === 'line' || element.type === 'arrow' || element.type === 'freedraw'
  const rawPoints = Array.isArray(element.points) ? element.points : needsPoints ? [] : undefined

  if (needsPoints) {
    const normalizedPoints = (rawPoints || []).map((point) => {
      if (!Array.isArray(point)) {
        return null
      }
      const [x = 0, y = 0] = point
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null
      }
      return [x, y]
    }).filter(Boolean)

    sanitized.points = normalizedPoints.length > 0 ? normalizedPoints : [[0, 0], [sanitized.width, sanitized.height]]
  } else if (rawPoints) {
    sanitized.points = rawPoints.filter((point) => Array.isArray(point))
  } else if ('points' in sanitized) {
    delete sanitized.points
  }

  return sanitized
}

const normalizeFileForCompare = (file) => {
  if (!file) {
    return null
  }
  const normalized = { ...file }
  delete normalized.lastRetrieved
  return normalized
}

const filesAreEqual = (a, b) => {
  if (!a && !b) return true
  if (!a || !b) return false
  return JSON.stringify(normalizeFileForCompare(a)) === JSON.stringify(normalizeFileForCompare(b))
}

export function useCollaboration(excalidrawAPI, pendingFilesRef, { drawingId = null, authUser = null } = {}) {
  // Compute drawing-specific paths
  const effectiveDrawingId = drawingId || '__global__'
  const PATHS = buildPaths(effectiveDrawingId)
  const [isLoaded, setIsLoaded] = useState(false)
  const [userIdentity, setUserIdentity] = useState(null)
  const [onlineUsers, setOnlineUsers] = useState([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [hasPendingChanges, setHasPendingChanges] = useState(false)
  const [isSavingScene, setIsSavingScene] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [lastSyncInfo, setLastSyncInfo] = useState(null)

  const presenceRefRef = useRef(null)
  const userIdRef = useRef(null)
  const previousSceneRef = useRef(null)
  const sessionRefRef = useRef(null)
  const heartbeatRef = useRef(null)
  const isAdminRef = useRef(false)
  const adminMapRef = useRef({})
  const hasPendingSaveRef = useRef(false)
  const lastAppStateRef = useRef(null)
  const isApplyingSceneUpdateRef = useRef(false)
  const isSavingRef = useRef(false)
  const lastSaveStartedAtRef = useRef(0)
  const needsResaveRef = useRef(false)
  const flushPendingSaveRef = useRef(null)
  const debounceSaveTimerRef = useRef(null)
  const elementsStateRef = useRef(new Map())
  const filesStateRef = useRef({})
  const appStateStateRef = useRef({})
  const canvasListenersCleanupRef = useRef([])
  const pendingSceneRenderRef = useRef(null)
  const loadCanvasRef = useRef(null)

  useEffect(() => {
    const presenceListRef = ref(database, PATHS.PRESENCE_PATH)
    const presenceMap = {}

    const emitPresence = () => {
      const now = Date.now()
      const users = Object.values(presenceMap)
        .filter(Boolean)
        .map((user) => {
          if (user.cursor) {
            return {
              ...user,
              cursor: {
                ...user.cursor,
                syncedAt: now,
              },
            }
          }
          return user
        })
        .sort((a, b) => {
          const aJoined = a.joinedAt || 0
          const bJoined = b.joinedAt || 0
          return bJoined - aJoined
        })
      setOnlineUsers(users)
    }

    const unsubscribes = [
      onChildAdded(presenceListRef, (snapshot) => {
        presenceMap[snapshot.key] = snapshot.val()
        emitPresence()
      }),
      onChildChanged(presenceListRef, (snapshot) => {
        presenceMap[snapshot.key] = snapshot.val()
        emitPresence()
      }),
      onChildRemoved(presenceListRef, (snapshot) => {
        delete presenceMap[snapshot.key]
        emitPresence()
      }),
    ]

    return () => {
      unsubscribes.forEach((unsubscribe) => {
        if (typeof unsubscribe === 'function') {
          unsubscribe()
        }
      })
    }
  }, [effectiveDrawingId])

  useEffect(() => {
    const adminsRef = ref(database, ADMIN_PATH)
    const unsubscribeAdmins = onValue(adminsRef, (snapshot) => {
      const adminMap = snapshot.val() || {}
      adminMapRef.current = adminMap
      const userId = userIdRef.current
      const hasAdminRights = Boolean(userId && adminMap[userId])
      if (isAdminRef.current !== hasAdminRights) {
        isAdminRef.current = hasAdminRights
        setIsAdmin(hasAdminRights)
      }
    })

    return () => {
      unsubscribeAdmins()
    }
  }, [])

  useEffect(() => {
    const userId = userIdentity?.browserId
    const hasAdminRights = Boolean(userId && adminMapRef.current[userId])
    if (isAdminRef.current !== hasAdminRights) {
      isAdminRef.current = hasAdminRights
      setIsAdmin(hasAdminRights)
    }
  }, [userIdentity])

  useEffect(() => {
    if (!excalidrawAPI) return

    let isUnmounted = false

    const markSyncComplete = (reason = 'realtime', hadRemoteUpdates = false) => {
      setLastSyncInfo({
        reason,
        hadRemoteUpdates,
        timestamp: Date.now(),
      })
    }

    const applyScene = (reason = 'realtime', hadRemoteUpdates = true) => {
      if (!excalidrawAPI || isUnmounted) {
        return
      }

      const sortedElements = Array.from(elementsStateRef.current.values()).sort(
        (a, b) => (a?.order ?? 0) - (b?.order ?? 0)
      )
      const sanitizedElements = sortedElements
        .map((element) => sanitizeElement(element))
        .filter(Boolean)
      const elements = cloneElements(sanitizedElements)
      const appState = {
        viewBackgroundColor: appStateStateRef.current?.viewBackgroundColor ?? '#ffffff',
        gridSize: appStateStateRef.current?.gridSize ?? null,
      }
      const files = { ...(filesStateRef.current || {}) }

      try {
        isApplyingSceneUpdateRef.current = true

        // Register files via addFiles — Excalidraw requires this for proper
        // binary file rendering. updateScene({files}) does NOT register files
        // in Excalidraw's internal file manager.
        const fileEntries = Object.values(files).filter(f => f && f.dataURL)
        if (fileEntries.length > 0) {
          excalidrawAPI.addFiles(fileEntries)
        }

        excalidrawAPI.updateScene({
          elements,
          appState,
        })
        previousSceneRef.current = cloneElements(elements)
        lastAppStateRef.current = { ...appState }
        markSyncComplete(reason, hadRemoteUpdates)
        setIsLoaded(true)
      } catch (error) {
        console.error('Error applying canvas update:', error)
      } finally {
        setTimeout(() => {
          isApplyingSceneUpdateRef.current = false
        }, 0)
      }
    }

    const scheduleSceneRender = (reason = 'realtime', hadRemoteUpdates = true) => {
      const pending = pendingSceneRenderRef.current
      if (pending) {
        pending.reason = reason
        pending.hadRemoteUpdates = pending.hadRemoteUpdates || hadRemoteUpdates
        return
      }

      pendingSceneRenderRef.current = { reason, hadRemoteUpdates }
      Promise.resolve().then(() => {
        const payload = pendingSceneRenderRef.current
        pendingSceneRenderRef.current = null
        if (!payload || isUnmounted) {
          return
        }
        applyScene(payload.reason, payload.hadRemoteUpdates)
      })
    }

    const hydrateLocalState = (
      elements = [],
      appState = {},
      files = {},
      reason = 'realtime',
      hadRemoteUpdates = true
    ) => {
      const elementsMap = new Map()
      elements
        .map((element, index) => {
          const sanitized = sanitizeElement({ ...element, order: element.order ?? index })
          if (!sanitized) {
            return null
          }
          return { ...sanitized, order: sanitized.order ?? index }
        })
        .filter(Boolean)
        .forEach((element) => {
          elementsMap.set(element.id, element)
        })

      elementsStateRef.current = elementsMap
      filesStateRef.current = { ...files }
      appStateStateRef.current = {
        viewBackgroundColor: appState?.viewBackgroundColor ?? '#ffffff',
        gridSize: appState?.gridSize ?? null,
      }
      previousSceneRef.current = cloneElements(Array.from(elementsMap.values()))
      lastAppStateRef.current = { ...appStateStateRef.current }

      scheduleSceneRender(reason, hadRemoteUpdates)
    }

    const migrateLegacyCanvasSnapshot = async (legacyData, userId) => {
      let sceneData = {}
      try {
        sceneData = JSON.parse(legacyData.sceneJSON || '{}')
      } catch (error) {
        console.error('Failed to parse legacy scene JSON:', error)
      }

      let filesData = {}
      try {
        filesData = legacyData.files ? JSON.parse(legacyData.files) : {}
      } catch (error) {
        console.error('Failed to parse legacy files JSON:', error)
      }

      const elements = (sceneData.elements || []).map((element, index) => ({
        ...element,
        order: element.order ?? index,
      }))

      const appState = {
        viewBackgroundColor: sceneData.appState?.viewBackgroundColor ?? '#ffffff',
        gridSize: sceneData.appState?.gridSize ?? null,
      }

      const updates = {}

      elements.forEach((element) => {
        updates[`${PATHS.CANVAS_ELEMENTS_PATH}/${element.id}`] = element
      })

      Object.entries(filesData).forEach(([fileId, fileValue]) => {
        updates[`${PATHS.CANVAS_FILES_PATH}/${fileId}`] = fileValue
      })

      updates[PATHS.CANVAS_APP_STATE_PATH] = appState
      updates[PATHS.CANVAS_METADATA_PATH] = {
        migratedAt: Date.now(),
        migratedBy: userId,
        updatedAt: Date.now(),
        updatedBy: userId,
      }
      updates[PATHS.LEGACY_CANVAS_PATH] = null

      await update(ref(database), updates)

      return {
        elements,
        appState,
        files: filesData,
      }
    }

    const loadInitialCanvas = async (userId, reason = 'initial') => {
      const canvasRootRef = ref(database, PATHS.CANVAS_ROOT_PATH)
      const snapshot = await get(canvasRootRef)

      if (!snapshot.exists()) {
        elementsStateRef.current = new Map()
        filesStateRef.current = {}
        appStateStateRef.current = {}
        previousSceneRef.current = []
        lastAppStateRef.current = null
        markSyncComplete(reason, false)
        setIsLoaded(true)
        return
      }

      const data = snapshot.val() || {}

      if (data.sceneJSON) {
        const migrated = await migrateLegacyCanvasSnapshot(data, userId)
        hydrateLocalState(migrated.elements, migrated.appState, migrated.files, reason, true)
      } else {
        const elements = Object.values(data.elements || {})
        const appState = data.appState || {}
        const files = data.files || {}
        hydrateLocalState(elements, appState, files, reason, true)
      }
    }

    const detachCanvasListeners = () => {
      canvasListenersCleanupRef.current.forEach((unsubscribe) => {
        if (typeof unsubscribe === 'function') {
          unsubscribe()
        }
      })
      canvasListenersCleanupRef.current = []
    }

    const attachCanvasListeners = () => {
      detachCanvasListeners()

      const unsubscribes = []

      const elementsRef = ref(database, PATHS.CANVAS_ELEMENTS_PATH)
      const handleElementUpsert = (snapshot) => {
        const element = sanitizeElement(snapshot.val())
        if (!element) {
          return
        }
        const order = element.order ?? 0
        elementsStateRef.current.set(snapshot.key, { ...element, order })
        scheduleSceneRender('realtime', true)
      }

      unsubscribes.push(onChildAdded(elementsRef, handleElementUpsert))
      unsubscribes.push(onChildChanged(elementsRef, handleElementUpsert))
      unsubscribes.push(
        onChildRemoved(elementsRef, (snapshot) => {
          elementsStateRef.current.delete(snapshot.key)
          scheduleSceneRender('realtime', true)
        })
      )

      const filesRef = ref(database, PATHS.CANVAS_FILES_PATH)
      const handleFileUpsert = async (snapshot) => {
        const fileValue = snapshot.val()
        if (isStorageReference(fileValue)) {
          // File is stored in Firebase Storage — fetch the actual blob
          const resolved = await resolveStorageFile(fileValue)
          if (resolved) {
            filesStateRef.current = {
              ...filesStateRef.current,
              [snapshot.key]: resolved,
            }
            scheduleSceneRender('realtime', true)
          }
        } else {
          // Legacy: full file data is in RTDB (small files or old data)
          filesStateRef.current = {
            ...filesStateRef.current,
            [snapshot.key]: fileValue,
          }
          scheduleSceneRender('realtime', true)
        }
      }

      unsubscribes.push(onChildAdded(filesRef, handleFileUpsert))
      unsubscribes.push(onChildChanged(filesRef, handleFileUpsert))
      unsubscribes.push(
        onChildRemoved(filesRef, (snapshot) => {
          const next = { ...filesStateRef.current }
          delete next[snapshot.key]
          filesStateRef.current = next
          scheduleSceneRender('realtime', true)
        })
      )

      const appStateRef = ref(database, PATHS.CANVAS_APP_STATE_PATH)
      unsubscribes.push(
        onValue(appStateRef, (snapshot) => {
          const data = snapshot.val() || {}
          appStateStateRef.current = {
            viewBackgroundColor: data.viewBackgroundColor ?? '#ffffff',
            gridSize: data.gridSize ?? null,
          }
          scheduleSceneRender('realtime', true)
        })
      )

      canvasListenersCleanupRef.current = unsubscribes
    }

    loadCanvasRef.current = async () => {
      const userId = userIdRef.current
      if (!userId) {
        return
      }
      await loadInitialCanvas(userId, 'manual-refresh')
    }

    const initializeIdentity = async () => {
      // If we have an authenticated user, build identity from them
      if (authUser) {
        const identity = {
          browserId: authUser.uid,
          username: authUser.displayName || 'Anonymous',
          color: authUser.color || '#4ECDC4',
          avatarUrl: authUser.photoURL || null,
        }
        if (isUnmounted) return null
        userIdRef.current = identity.browserId
        setUserIdentity(identity)
        return identity
      }
      // Fallback to anonymous identity
      const identity = await getOrCreateUserIdentity()
      if (isUnmounted) {
        return null
      }
      userIdRef.current = identity.browserId
      setUserIdentity(identity)
      return identity
    }

    const initialize = async () => {
      const identity = await initializeIdentity()
      if (!identity) {
        return () => {}
      }
      const userId = identity.browserId
      const presenceRef = ref(database, `${PATHS.PRESENCE_PATH}/${userId}`)
      const sessionsListRef = ref(database, `${PATHS.SESSIONS_PATH}/${userId}`)

      const assignOwnerMetadata = (element, ownerId = userId) => {
        const existingCustomData = { ...(element.customData || {}) }
        const metadata = {
          ...existingCustomData,
          createdBy: ownerId,
        }

        if (ownerId === userId) {
          metadata.createdByUsername = identity.username
          metadata.createdByColor = identity.color
        } else {
          if (existingCustomData.createdByUsername) {
            metadata.createdByUsername = existingCustomData.createdByUsername
          }
          if (existingCustomData.createdByColor) {
            metadata.createdByColor = existingCustomData.createdByColor
          }
        }

        element.customData = metadata
        return element
      }

      const decorateElementWithOwner = (element, ownerId = userId, orderIndex = 0) => {
        const decorated = assignOwnerMetadata(cloneElement(element), ownerId)
        decorated.order = orderIndex
        return decorated
      }

      const setupPresence = () => {
        const userPresence = {
          id: userId,
          username: identity.username,
          color: identity.color,
          avatarUrl: identity.avatarUrl || null,
          joinedAt: Date.now(),
          lastActiveAt: serverTimestamp(),
          cursor: null,
        }

        set(presenceRef, userPresence)
        onDisconnect(presenceRef).remove()
        presenceRefRef.current = presenceRef
      }

      const startSession = async () => {
        const newSessionRef = push(sessionsListRef)
        sessionRefRef.current = newSessionRef

        await set(newSessionRef, {
          id: newSessionRef.key,
          userId,
          username: identity.username,
          color: identity.color,
          avatarUrl: identity.avatarUrl || null,
          startedAt: serverTimestamp(),
          lastActiveAt: serverTimestamp(),
          endedAt: null,
        })

        onDisconnect(newSessionRef).update({
          endedAt: serverTimestamp(),
          lastActiveAt: serverTimestamp(),
        })
      }

      const sendHeartbeat = () => {
        update(presenceRef, {
          lastActiveAt: serverTimestamp(),
        }).catch((error) => {
          console.error('Error updating presence heartbeat:', error)
        })

        if (sessionRefRef.current) {
          update(sessionRefRef.current, {
            lastActiveAt: serverTimestamp(),
            endedAt: null,
          }).catch((error) => {
            console.error('Error updating session heartbeat:', error)
          })
        }
      }

      setupPresence()
      await startSession()
      sendHeartbeat()
      heartbeatRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL)

      await loadInitialCanvas(userId)
      attachCanvasListeners()

      const flushPendingSave = async (options = {}) => {
        const { reason = 'manual', allowRetry = true } = options
        if (!excalidrawAPI) {
          console.warn('flushPendingSave aborted: excalidrawAPI not ready')
          return null
        }

        const hasPending = hasPendingSaveRef.current || needsResaveRef.current
        if (!hasPending && !allowRetry) {
          return null
        }

        if (isSavingRef.current || isApplyingSceneUpdateRef.current) {
          if (isSavingRef.current) {
            const elapsed = Date.now() - (lastSaveStartedAtRef.current || 0)
            const isStuck = elapsed > 5000
            if (isStuck) {
              console.warn('Previous save stuck; clearing lock')
              isSavingRef.current = false
              setIsSavingScene(false)
              hasPendingSaveRef.current = true
              setHasPendingChanges(true)
            } else {
              needsResaveRef.current = true
              return null
            }
          } else {
            needsResaveRef.current = true
            return null
          }
        }

        if (!hasPendingSaveRef.current && !needsResaveRef.current) {
          return null
        }

        if (debounceSaveTimerRef.current) {
          clearTimeout(debounceSaveTimerRef.current)
          debounceSaveTimerRef.current = null
        }

        isSavingRef.current = true
        setIsSavingScene(true)
        lastSaveStartedAtRef.current = Date.now()
        hasPendingSaveRef.current = false
        setHasPendingChanges(false)
        needsResaveRef.current = false

        const authorizedElements =
          (previousSceneRef.current && cloneElements(previousSceneRef.current)) ||
          cloneElements(excalidrawAPI.getSceneElements())

        const remoteElementsMap = elementsStateRef.current
        const updates = {}
        const nextElementsMap = new Map(remoteElementsMap)
        const desiredElements = []

        authorizedElements
          .filter(Boolean)
          .forEach((element, index) => {
            const ownerId = element.customData?.createdBy || userId
            const decorated = sanitizeElement(decorateElementWithOwner(element, ownerId, index))
            if (!decorated) {
              return
            }
            desiredElements.push(decorated)
            const remoteElement = remoteElementsMap.get(decorated.id)
            if (!elementsAreEqual(remoteElement, decorated)) {
              updates[`${PATHS.CANVAS_ELEMENTS_PATH}/${decorated.id}`] = decorated
              nextElementsMap.set(decorated.id, decorated)
            }
          })

        const desiredIds = new Set(desiredElements.map((element) => element.id))

        remoteElementsMap.forEach((remoteElement, id) => {
          if (!desiredIds.has(id)) {
            updates[`${PATHS.CANVAS_ELEMENTS_PATH}/${id}`] = null
            nextElementsMap.delete(id)
          }
        })

        const latestAppState =
          lastAppStateRef.current ||
          excalidrawAPI.getAppState() ||
          {}

        const normalizedAppState = {
          viewBackgroundColor: latestAppState.viewBackgroundColor,
          gridSize: latestAppState.gridSize,
        }

        const appStateChanged =
          (appStateStateRef.current?.viewBackgroundColor ?? null) !==
            normalizedAppState.viewBackgroundColor ||
          (appStateStateRef.current?.gridSize ?? null) !== normalizedAppState.gridSize

        if (appStateChanged) {
          updates[PATHS.CANVAS_APP_STATE_PATH] = normalizedAppState
          appStateStateRef.current = normalizedAppState
        }

        const currentFiles = excalidrawAPI.getFiles()
        const pendingFiles = pendingFilesRef?.current || {}
        const mergedFiles = {
          ...currentFiles,
          ...pendingFiles,
        }

        console.log('[FILE-SYNC] currentFiles count:', Object.keys(currentFiles).length)
        console.log('[FILE-SYNC] pendingFiles count:', Object.keys(pendingFiles).length)
        console.log('[FILE-SYNC] mergedFiles count:', Object.keys(mergedFiles).length)
        console.log('[FILE-SYNC] filesStateRef count:', Object.keys(filesStateRef.current).length)

        const nextFiles = { ...filesStateRef.current }
        let hadFileUpdates = false

        // Upload new/changed files to Firebase Storage, store reference in RTDB
        const fileUploadPromises = []
        Object.entries(mergedFiles).forEach(([fileId, fileValue]) => {
          const normalized = normalizeFileForCompare(fileValue)
          const previous = normalizeFileForCompare(filesStateRef.current[fileId])
          const areEqual = filesAreEqual(previous, normalized)
          console.log(`[FILE-SYNC] File ${fileId}: equal=${areEqual}, hasDataURL=${!!(fileValue.dataURL && fileValue.dataURL.startsWith('data:'))}, hasPrevious=${!!previous}`)
          if (!areEqual) {
            if (fileValue.dataURL && fileValue.dataURL.startsWith('data:')) {
              // Upload to Storage, write reference to RTDB
              console.log(`[FILE-SYNC] Uploading file ${fileId} to Storage...`)
              fileUploadPromises.push(
                uploadFileToStorage(effectiveDrawingId, fileId, fileValue.dataURL, fileValue.mimeType)
                  .then((storageUrl) => {
                    console.log(`[FILE-SYNC] Upload result for ${fileId}: storageUrl=${storageUrl ? 'YES' : 'NULL'}`)
                    if (storageUrl) {
                      updates[`${PATHS.CANVAS_FILES_PATH}/${fileId}`] = {
                        id: fileValue.id || fileId,
                        mimeType: fileValue.mimeType || 'image/png',
                        storageUrl,
                        storagePath: `drawings/${effectiveDrawingId}/files/${fileId}`,
                        created: fileValue.created || Date.now(),
                      }
                    } else {
                      // Fallback: store inline if upload fails (small files only)
                      updates[`${PATHS.CANVAS_FILES_PATH}/${fileId}`] = fileValue
                    }
                    nextFiles[fileId] = fileValue // keep full data in local state
                    hadFileUpdates = true
                  })
                  .catch((err) => {
                    console.error(`[FILE-SYNC] Upload FAILED for ${fileId}:`, err)
                  })
              )
            } else {
              // Non-dataURL file or already a reference
              console.log(`[FILE-SYNC] File ${fileId} has no dataURL, storing directly`)
              updates[`${PATHS.CANVAS_FILES_PATH}/${fileId}`] = fileValue
              nextFiles[fileId] = fileValue
              hadFileUpdates = true
            }
          }
        })

        Object.keys(filesStateRef.current).forEach((fileId) => {
          if (!mergedFiles[fileId]) {
            updates[`${PATHS.CANVAS_FILES_PATH}/${fileId}`] = null
            delete nextFiles[fileId]
            hadFileUpdates = true
          }
        })

        // Wait for all file uploads to complete before writing to RTDB
        if (fileUploadPromises.length > 0) {
          console.log(`[FILE-SYNC] Waiting for ${fileUploadPromises.length} uploads...`)
          await Promise.all(fileUploadPromises)
          console.log(`[FILE-SYNC] All uploads complete. Updates keys:`, Object.keys(updates).filter(k => k.includes('files')))
        }

        if (Object.keys(updates).length === 0) {
          isSavingRef.current = false
          setIsSavingScene(false)
          markSyncComplete(reason, false)
          return null
        }

        updates[PATHS.CANVAS_METADATA_PATH] = {
          updatedAt: Date.now(),
          updatedBy: userId,
        }

        if (pendingFilesRef?.current && hadFileUpdates) {
          pendingFilesRef.current = {}
        }

        const orderedDesiredElements = desiredElements
          .slice()
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

        const updatePromise = update(ref(database), updates)
          .then(() => {
            elementsStateRef.current = nextElementsMap
            filesStateRef.current = nextFiles
            previousSceneRef.current = cloneElements(orderedDesiredElements)
            lastAppStateRef.current = { ...normalizedAppState }
            setLastSavedAt(Date.now())
            markSyncComplete(reason, true)
          })
          .catch((error) => {
            console.error('Error syncing to Firebase:', error)
            hasPendingSaveRef.current = true
            setHasPendingChanges(true)
            throw error
          })
          .finally(() => {
            isSavingRef.current = false
            setIsSavingScene(false)
            const shouldResave = needsResaveRef.current
            needsResaveRef.current = false
            if (shouldResave) {
              flushPendingSave({ reason: 'post-save', allowRetry: false })
            }
          })

        setTimeout(() => {
          if (isSavingRef.current && Date.now() - lastSaveStartedAtRef.current > 8000) {
            console.warn('Firebase save watchdog releasing lock after timeout')
            isSavingRef.current = false
            setIsSavingScene(false)
            hasPendingSaveRef.current = true
            setHasPendingChanges(true)
            const shouldResave = needsResaveRef.current
            needsResaveRef.current = false
            if (shouldResave) {
              flushPendingSave({ reason: 'watchdog', allowRetry: false })
            }
          }
        }, 8000)

        return updatePromise
      }

      const handleVisibilityChange = () => {
        if (document.visibilityState === 'hidden' && hasPendingSaveRef.current) {
          flushPendingSave({ reason: 'visibilitychange', allowRetry: false })
        }
      }

      const handlePageHide = () => {
        if (hasPendingSaveRef.current) {
          flushPendingSave({ reason: 'pagehide', allowRetry: false })
        }
      }

      window.addEventListener('visibilitychange', handleVisibilityChange)
      window.addEventListener('pagehide', handlePageHide)
      window.addEventListener('beforeunload', handlePageHide)

      const cleanupCallbacks = [
        () => window.removeEventListener('visibilitychange', handleVisibilityChange),
        () => window.removeEventListener('pagehide', handlePageHide),
        () => window.removeEventListener('beforeunload', handlePageHide),
      ]

      const handleChange = (elements, state, _files, info = {}) => {
        const { source } = info
        if (source === 'api') {
          return
        }

        if (isApplyingSceneUpdateRef.current) {
          return
        }

        const previousElements = previousSceneRef.current || []
        const previousElementMap = new Map(previousElements.map((el) => [el.id, el]))
        const authorizedElements = Array(elements.length)
        const userId = userIdRef.current
        const userIsAdmin = isAdminRef.current

        for (let index = 0; index < elements.length; index += 1) {
          const element = elements[index]
          if (!element) {
            continue
          }

          const clonedElement = cloneElement(element)
          const prevEntry = previousElementMap.get(element.id)

          if (!prevEntry) {
            assignOwnerMetadata(clonedElement, userId)
            clonedElement.order = index
            authorizedElements[index] = clonedElement
            continue
          }

          const previousElement = prevEntry
          const owner = previousElement.customData?.createdBy

          if (userIsAdmin || !owner || owner === userId) {
            assignOwnerMetadata(clonedElement, owner ?? userId)
            clonedElement.order = index
            authorizedElements[index] = clonedElement
          } else {
            console.log(
              `User ${userId} attempted to modify element ${element.id} owned by ${owner} - blocking save`
            )
            const preserved = cloneElement(previousElement)
            preserved.order = index
            authorizedElements[index] = preserved
          }
        }

        const currentElementIds = new Set(elements.map((el) => el.id))
        for (const prevElement of previousElements) {
          if (!currentElementIds.has(prevElement.id) && !prevElement.isDeleted) {
            const owner = prevElement.customData?.createdBy
            if (owner && owner !== userId && !userIsAdmin) {
              console.log(
                `User ${userId} attempted to delete element ${prevElement.id} owned by ${owner} - blocking deletion from save`
              )
              const preserved = cloneElement(prevElement)
              preserved.order = authorizedElements.length
              authorizedElements.push(preserved)
            }
          }
        }

        const sanitizedAuthorized = authorizedElements.filter(Boolean)
        previousSceneRef.current = cloneElements(sanitizedAuthorized)

        lastAppStateRef.current = {
          viewBackgroundColor: state.viewBackgroundColor,
          gridSize: state.gridSize,
        }

        hasPendingSaveRef.current = true
        setHasPendingChanges(true)
        if (isSavingRef.current) {
          needsResaveRef.current = true
        }

        if (debounceSaveTimerRef.current) {
          clearTimeout(debounceSaveTimerRef.current)
        }
        debounceSaveTimerRef.current = setTimeout(() => {
          debounceSaveTimerRef.current = null
          if (flushPendingSaveRef.current && hasPendingSaveRef.current && !isSavingRef.current) {
            flushPendingSaveRef.current({ reason: 'debounced', allowRetry: true })
          }
        }, 750)
      }

      const unsubscribeChange = excalidrawAPI.onChange(handleChange)

      flushPendingSaveRef.current = flushPendingSave

      return () => {
        cleanupCallbacks.forEach((cb) => cb())
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current)
          heartbeatRef.current = null
        }
        if (debounceSaveTimerRef.current) {
          clearTimeout(debounceSaveTimerRef.current)
          debounceSaveTimerRef.current = null
        }
        if (sessionRefRef.current) {
          update(sessionRefRef.current, {
            lastActiveAt: serverTimestamp(),
            endedAt: serverTimestamp(),
          }).catch((error) => {
            console.error('Error closing session:', error)
          })
          sessionRefRef.current = null
        }
        if (hasPendingSaveRef.current) {
          flushPendingSave({ reason: 'cleanup' })
        }
        if (unsubscribeChange) {
          unsubscribeChange()
        }
        if (presenceRefRef.current) {
          set(presenceRefRef.current, null)
          presenceRefRef.current = null
        }
        detachCanvasListeners()
        flushPendingSaveRef.current = null
        return undefined
      }
    }

    let cleanup = null
    initialize()
      .then((cleanupFn) => {
        cleanup = cleanupFn
      })
      .catch((error) => {
        console.error('Failed to initialize collaboration:', error)
      })

    return () => {
      isUnmounted = true
      if (cleanup) {
        cleanup()
      }
      detachCanvasListeners()
    }
  }, [excalidrawAPI, pendingFilesRef, effectiveDrawingId, authUser])

  const updateCursorPosition = useCallback((cursor) => {
    const presenceRef = presenceRefRef.current
    if (!presenceRef) {
      return
    }

    const payload = cursor
      ? {
          cursor: {
            ...cursor,
            updatedAt: Date.now(),
          },
        }
      : {
          cursor: null,
        }

    update(presenceRef, payload).catch((error) => {
      console.error('Error updating cursor position:', error)
    })
  }, [])

  const updateUserProfile = useCallback(async (updates) => {
    if (!updates || typeof updates !== 'object') {
      return null
    }

    let nextIdentity = null

    setUserIdentity((previous) => {
      if (!previous) {
        const stored = updateStoredUserIdentity(updates)
        nextIdentity = stored
        return stored
      }

      const merged = {
        ...previous,
        ...updates,
        avatarUrl:
          updates.avatarUrl !== undefined
            ? updates.avatarUrl
            : previous.avatarUrl ?? null,
      }

      updateStoredUserIdentity(merged)
      nextIdentity = merged
      return merged
    })

    const presenceRef = presenceRefRef.current
    const presenceUpdates = {}
    if (updates.username !== undefined) {
      presenceUpdates.username = updates.username
    }
    if (updates.color !== undefined) {
      presenceUpdates.color = updates.color
    }
    if (updates.avatarUrl !== undefined) {
      presenceUpdates.avatarUrl = updates.avatarUrl
    }

    if (presenceRef && Object.keys(presenceUpdates).length > 0) {
      try {
        await update(presenceRef, {
          ...presenceUpdates,
          lastActiveAt: serverTimestamp(),
        })
      } catch (error) {
        console.error('Error updating presence profile:', error)
      }
    }

    if (sessionRefRef.current && Object.keys(presenceUpdates).length > 0) {
      try {
        await update(sessionRefRef.current, {
          ...presenceUpdates,
          lastActiveAt: serverTimestamp(),
        })
      } catch (error) {
        console.error('Error updating session profile:', error)
      }
    }

    return nextIdentity
  }, [])

  const saveChanges = useCallback((reason = 'manual') => {
    const flush = flushPendingSaveRef.current
    if (!flush) {
      if (import.meta.env?.DEV) {
        console.warn('saveChanges invoked before collaboration initialized', { reason })
      }
      return null
    }
    // Force pending flag — needed when changes come from API-sourced updates
    // (e.g. image paste via updateScene) which skip the onChange handler
    hasPendingSaveRef.current = true
    return flush({ reason, allowRetry: false })
  }, [])

  const [isRefreshing, setIsRefreshing] = useState(false)

  const refreshCanvas = useCallback(async () => {
    if (isRefreshing) {
      console.log('Refresh already in progress')
      return
    }

    setIsRefreshing(true)
    try {
      if (!loadCanvasRef.current) {
        console.warn('Cannot refresh: collaboration not initialized')
        return
      }
      await loadCanvasRef.current()
    } catch (error) {
      console.error('Manual refresh failed:', error)
    } finally {
      setIsRefreshing(false)
    }
  }, [isRefreshing])

  return {
    isLoaded,
    userIdentity,
    onlineUsers,
    isAdmin,
    updateCursorPosition,
    updateUserProfile,
    saveChanges,
    refreshCanvas,
    isSaving: isSavingScene,
    isRefreshing,
    hasPendingChanges,
    lastSavedAt,
    lastSyncInfo,
  }
}

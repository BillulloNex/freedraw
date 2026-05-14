import { useCallback, useEffect, useState, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  ref, push, set, get, remove, update, onValue, serverTimestamp,
} from 'firebase/database'
import {
  Plus, FolderSimple, PencilSimpleLine, SignOut, DotsThreeVertical,
  Trash, PencilSimple, Users, ShareNetwork, MagnifyingGlass, House,
} from '@phosphor-icons/react'
import { database } from './firebase'
import { useAuth } from './AuthContext'
import './DashboardPage.css'

const DRAWINGS_PATH = 'drawings'
const WORKSPACES_PATH = 'workspaces'
const DRAWING_ACCESS_PATH = 'drawing_access'

export default function DashboardPage() {
  const { user, userProfile, logout } = useAuth()
  const navigate = useNavigate()

  const [workspaces, setWorkspaces] = useState([])
  const [drawings, setDrawings] = useState([])
  const [activeWorkspace, setActiveWorkspace] = useState(null) // null = "All"
  const [isCreatingDrawing, setIsCreatingDrawing] = useState(false)
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false)
  const [newDrawingName, setNewDrawingName] = useState('')
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [contextMenu, setContextMenu] = useState(null) // { type, id, x, y }
  const [renameTarget, setRenameTarget] = useState(null) // { type, id }
  const [renameValue, setRenameValue] = useState('')
  const [shareDialogTarget, setShareDialogTarget] = useState(null)
  const [shareEmail, setShareEmail] = useState('')
  const [shareRole, setShareRole] = useState('editor')
  const contextRef = useRef(null)
  const renameInputRef = useRef(null)

  // Load workspaces
  useEffect(() => {
    if (!user) return undefined

    const workspacesRef = ref(database, WORKSPACES_PATH)
    const unsubscribe = onValue(workspacesRef, (snapshot) => {
      const data = snapshot.val() || {}
      const userWorkspaces = Object.entries(data)
        .filter(([, ws]) => ws.members?.[user.uid])
        .map(([id, ws]) => ({
          id,
          name: ws.meta?.name || 'Untitled',
          color: ws.meta?.color || '#537CF7',
          role: ws.members[user.uid]?.role || 'viewer',
          createdAt: ws.meta?.createdAt || 0,
        }))
        .sort((a, b) => b.createdAt - a.createdAt)

      setWorkspaces(userWorkspaces)
    })

    return () => unsubscribe()
  }, [user])

  // Load drawings
  useEffect(() => {
    if (!user) return undefined

    const accessRef = ref(database, `${DRAWING_ACCESS_PATH}`)
    const unsubscribe = onValue(accessRef, async (accessSnapshot) => {
      const accessData = accessSnapshot.val() || {}
      const myDrawingIds = Object.entries(accessData)
        .filter(([, users]) => users[user.uid])
        .map(([drawingId]) => drawingId)

      if (myDrawingIds.length === 0) {
        setDrawings([])
        return
      }

      const drawingPromises = myDrawingIds.map(async (drawingId) => {
        const metaRef = ref(database, `${DRAWINGS_PATH}/${drawingId}/meta`)
        const snap = await get(metaRef)
        if (!snap.exists()) return null
        const meta = snap.val()
        return {
          id: drawingId,
          name: meta.name || 'Untitled',
          workspaceId: meta.workspaceId || null,
          ownerId: meta.ownerId,
          createdAt: meta.createdAt || 0,
          updatedAt: meta.updatedAt || 0,
          thumbnailUrl: meta.thumbnailUrl || null,
        }
      })

      const results = (await Promise.all(drawingPromises)).filter(Boolean)
      results.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
      setDrawings(results)
    })

    return () => unsubscribe()
  }, [user])

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return undefined
    const handleClick = (e) => {
      if (contextRef.current && !contextRef.current.contains(e.target)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [contextMenu])

  // Focus rename input
  useEffect(() => {
    if (renameTarget && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renameTarget])

  const createDrawing = useCallback(async () => {
    if (!user || !newDrawingName.trim()) return
    setIsCreatingDrawing(true)

    try {
      const drawingsRef = ref(database, DRAWINGS_PATH)
      const newRef = push(drawingsRef)
      const drawingId = newRef.key

      const meta = {
        name: newDrawingName.trim(),
        workspaceId: activeWorkspace || null,
        ownerId: user.uid,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: user.uid,
      }

      await set(ref(database, `${DRAWINGS_PATH}/${drawingId}/meta`), meta)
      await set(ref(database, `${DRAWING_ACCESS_PATH}/${drawingId}/${user.uid}`), true)

      // If in a workspace, give all workspace members access
      if (activeWorkspace) {
        const membersSnap = await get(ref(database, `${WORKSPACES_PATH}/${activeWorkspace}/members`))
        const members = membersSnap.val() || {}
        const accessUpdates = {}
        Object.keys(members).forEach((uid) => {
          accessUpdates[`${DRAWING_ACCESS_PATH}/${drawingId}/${uid}`] = true
        })
        await update(ref(database), accessUpdates)
      }

      setNewDrawingName('')
      navigate(`/draw/${drawingId}`)
    } catch (error) {
      console.error('Error creating drawing:', error)
    } finally {
      setIsCreatingDrawing(false)
    }
  }, [user, newDrawingName, activeWorkspace, navigate])

  const createWorkspace = useCallback(async () => {
    if (!user || !newWorkspaceName.trim()) return
    setIsCreatingWorkspace(true)

    try {
      const wsRef = ref(database, WORKSPACES_PATH)
      const newRef = push(wsRef)
      const wsId = newRef.key

      const wsColors = ['#537CF7', '#F86F54', '#00A6A6', '#5F27CD', '#FF9F43', '#1DD1A1']
      const color = wsColors[Math.floor(Math.random() * wsColors.length)]

      await set(ref(database, `${WORKSPACES_PATH}/${wsId}`), {
        meta: {
          name: newWorkspaceName.trim(),
          ownerId: user.uid,
          createdAt: Date.now(),
          color,
        },
        members: {
          [user.uid]: { role: 'owner', addedAt: Date.now() },
        },
      })

      setNewWorkspaceName('')
      setActiveWorkspace(wsId)
    } catch (error) {
      console.error('Error creating workspace:', error)
    } finally {
      setIsCreatingWorkspace(false)
    }
  }, [user, newWorkspaceName])

  const deleteDrawing = useCallback(async (drawingId) => {
    if (!window.confirm('Delete this drawing? This cannot be undone.')) return
    try {
      await remove(ref(database, `${DRAWINGS_PATH}/${drawingId}`))
      await remove(ref(database, `${DRAWING_ACCESS_PATH}/${drawingId}`))
      await remove(ref(database, `presence/${drawingId}`))
    } catch (error) {
      console.error('Error deleting drawing:', error)
    }
    setContextMenu(null)
  }, [])

  const deleteWorkspace = useCallback(async (wsId) => {
    if (!window.confirm('Delete this workspace and all its drawings? This cannot be undone.')) return
    try {
      // Delete all drawings in this workspace
      const wsDrawings = drawings.filter((d) => d.workspaceId === wsId)
      for (const drawing of wsDrawings) {
        await remove(ref(database, `${DRAWINGS_PATH}/${drawing.id}`))
        await remove(ref(database, `${DRAWING_ACCESS_PATH}/${drawing.id}`))
      }
      await remove(ref(database, `${WORKSPACES_PATH}/${wsId}`))
      if (activeWorkspace === wsId) setActiveWorkspace(null)
    } catch (error) {
      console.error('Error deleting workspace:', error)
    }
    setContextMenu(null)
  }, [drawings, activeWorkspace])

  const handleRename = useCallback(async () => {
    if (!renameTarget || !renameValue.trim()) {
      setRenameTarget(null)
      return
    }

    try {
      if (renameTarget.type === 'drawing') {
        await update(ref(database, `${DRAWINGS_PATH}/${renameTarget.id}/meta`), {
          name: renameValue.trim(),
          updatedAt: Date.now(),
        })
      } else if (renameTarget.type === 'workspace') {
        await update(ref(database, `${WORKSPACES_PATH}/${renameTarget.id}/meta`), {
          name: renameValue.trim(),
        })
      }
    } catch (error) {
      console.error('Error renaming:', error)
    }
    setRenameTarget(null)
  }, [renameTarget, renameValue])

  const handleShareInvite = useCallback(async () => {
    if (!shareDialogTarget || !shareEmail.trim()) return
    // For sharing, we need to look up the user by email
    // This is a simplified version — in production you'd use Cloud Functions
    try {
      const usersRef = ref(database, 'users')
      const snapshot = await get(usersRef)
      const usersData = snapshot.val() || {}

      const targetUid = Object.entries(usersData).find(
        ([, userData]) => userData.profile?.email?.toLowerCase() === shareEmail.trim().toLowerCase()
      )?.[0]

      if (!targetUid) {
        alert('User not found. They need to sign in at least once.')
        return
      }

      if (shareDialogTarget.type === 'drawing') {
        await set(ref(database, `${DRAWING_ACCESS_PATH}/${shareDialogTarget.id}/${targetUid}`), true)
        await update(ref(database, `${DRAWINGS_PATH}/${shareDialogTarget.id}/members/${targetUid}`), {
          role: shareRole,
          addedAt: serverTimestamp(),
          addedBy: user.uid,
        })
      } else if (shareDialogTarget.type === 'workspace') {
        await update(ref(database, `${WORKSPACES_PATH}/${shareDialogTarget.id}/members/${targetUid}`), {
          role: shareRole,
          addedAt: serverTimestamp(),
          addedBy: user.uid,
        })
        // Give access to all drawings in this workspace
        const wsDrawings = drawings.filter((d) => d.workspaceId === shareDialogTarget.id)
        const accessUpdates = {}
        for (const drawing of wsDrawings) {
          accessUpdates[`${DRAWING_ACCESS_PATH}/${drawing.id}/${targetUid}`] = true
        }
        if (Object.keys(accessUpdates).length > 0) {
          await update(ref(database), accessUpdates)
        }
      }

      setShareEmail('')
      setShareDialogTarget(null)
      alert('Shared successfully!')
    } catch (error) {
      console.error('Error sharing:', error)
      alert('Error sharing. Please try again.')
    }
  }, [shareDialogTarget, shareEmail, shareRole, user, drawings])

  const filteredDrawings = drawings.filter((d) => {
    const matchesWorkspace = activeWorkspace === null || d.workspaceId === activeWorkspace
    const matchesSearch = !searchQuery || d.name.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesWorkspace && matchesSearch
  })

  const personalDrawings = filteredDrawings.filter((d) => !d.workspaceId)
  const workspaceDrawings = activeWorkspace ? filteredDrawings : []

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className="dashboard">
      {/* Sidebar */}
      <aside className="dashboard-sidebar">
        <div className="dashboard-sidebar__header">
          <img src="/arcadia-icon.png" alt="Arcadia" className="dashboard-sidebar__logo" width="32" height="32" />
          <span className="dashboard-sidebar__brand">arcadia</span>
        </div>

        <nav className="dashboard-sidebar__nav">
          <button
            type="button"
            className={`sidebar-item${activeWorkspace === null ? ' sidebar-item--active' : ''}`}
            onClick={() => setActiveWorkspace(null)}
          >
            <House size={18} weight={activeWorkspace === null ? 'fill' : 'regular'} />
            <span>All drawings</span>
          </button>

          <div className="sidebar-section-label">
            <span>Workspaces</span>
            <button
              type="button"
              className="sidebar-section-add"
              onClick={() => { setIsCreatingWorkspace(true); setNewWorkspaceName('') }}
              title="New workspace"
            >
              <Plus size={14} weight="bold" />
            </button>
          </div>

          {isCreatingWorkspace && (
            <div className="sidebar-create-form">
              <input
                type="text"
                className="sidebar-create-input"
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                placeholder="Workspace name"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createWorkspace()
                  if (e.key === 'Escape') setIsCreatingWorkspace(false)
                }}
                autoFocus
              />
              <button type="button" className="sidebar-create-btn" onClick={createWorkspace}>
                <Plus size={14} weight="bold" />
              </button>
            </div>
          )}

          {workspaces.map((ws) => (
            <button
              key={ws.id}
              type="button"
              className={`sidebar-item sidebar-item--workspace${activeWorkspace === ws.id ? ' sidebar-item--active' : ''}`}
              onClick={() => setActiveWorkspace(ws.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                setContextMenu({ type: 'workspace', id: ws.id, x: e.clientX, y: e.clientY })
              }}
            >
              <FolderSimple size={18} weight={activeWorkspace === ws.id ? 'fill' : 'regular'} style={{ color: ws.color }} />
              <span>{ws.name}</span>
              <button
                type="button"
                className="sidebar-item__more"
                onClick={(e) => {
                  e.stopPropagation()
                  setContextMenu({ type: 'workspace', id: ws.id, x: e.clientX, y: e.clientY })
                }}
              >
                <DotsThreeVertical size={16} weight="bold" />
              </button>
            </button>
          ))}
        </nav>

        <div className="sidebar-section-label" style={{ marginTop: '8px' }}>
          <span>Insights</span>
        </div>
        <nav className="dashboard-sidebar__nav dashboard-sidebar__nav--secondary">
          <Link to="/analytics" className="sidebar-item">
            <span style={{ fontSize: '16px' }}>📊</span>
            <span>Analytics</span>
          </Link>
          <Link to="/timeline" className="sidebar-item">
            <span style={{ fontSize: '16px' }}>🕐</span>
            <span>Timeline</span>
          </Link>
        </nav>

        <div className="dashboard-sidebar__footer">
          <div className="sidebar-user">
            {userProfile?.photoURL ? (
              <img src={userProfile.photoURL} alt="" className="sidebar-user__avatar" />
            ) : (
              <span className="sidebar-user__avatar sidebar-user__avatar--initial" style={{ background: userProfile?.color }}>
                {userProfile?.displayName?.charAt(0)?.toUpperCase() || '?'}
              </span>
            )}
            <div className="sidebar-user__info">
              <span className="sidebar-user__name">{userProfile?.displayName || 'User'}</span>
              <span className="sidebar-user__email">{user?.email || ''}</span>
            </div>
          </div>
          <button type="button" className="sidebar-logout" onClick={handleLogout} title="Sign out">
            <SignOut size={18} />
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="dashboard-main">
        <div className="dashboard-topbar">
          <h1 className="dashboard-topbar__title">
            {activeWorkspace
              ? workspaces.find((ws) => ws.id === activeWorkspace)?.name || 'Workspace'
              : 'All drawings'}
          </h1>
          <div className="dashboard-topbar__actions">
            <div className="dashboard-search">
              <MagnifyingGlass size={16} className="dashboard-search__icon" />
              <input
                type="text"
                className="dashboard-search__input"
                placeholder="Search drawings…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="dashboard-content">
          {/* Hero welcome section */}
          {activeWorkspace === null && !searchQuery && (
            <div className="dashboard-hero">
              <h2 className="dashboard-hero__greeting">
                Welcome back, <span className="dashboard-hero__greeting-name">{userProfile?.displayName?.split(' ')[0] || 'Creator'}</span>
              </h2>
              <p className="dashboard-hero__subtitle">Pick up where you left off, or start something new.</p>
              <div className="dashboard-hero__stats">
                <div className="dashboard-hero__stat">
                  <span className="dashboard-hero__stat-value">{drawings.length}</span>
                  <span className="dashboard-hero__stat-label">Drawings</span>
                </div>
                <div className="dashboard-hero__stat">
                  <span className="dashboard-hero__stat-value">{workspaces.length}</span>
                  <span className="dashboard-hero__stat-label">Workspaces</span>
                </div>
              </div>
            </div>
          )}

          {/* Section header */}
          <div className="dashboard-section-header">
            <h3 className="dashboard-section-title">
              {activeWorkspace
                ? `${workspaces.find((ws) => ws.id === activeWorkspace)?.name || 'Workspace'} drawings`
                : searchQuery ? 'Search results' : 'Recent drawings'}
            </h3>
          </div>

          {/* Drawing Grid */}
          <div className="drawing-grid">
            <button
              type="button"
              className="drawing-card drawing-card--new"
              onClick={() => { setIsCreatingDrawing(true); setNewDrawingName('') }}
            >
              <div className="drawing-card__preview drawing-card__preview--new">
                <Plus size={32} weight="light" />
              </div>
              <div className="drawing-card__info">
                <span className="drawing-card__name">New drawing</span>
              </div>
            </button>

            {/* New Drawing inline form */}
            {isCreatingDrawing && (
              <div className="drawing-card drawing-card--creating">
                <div className="drawing-card__preview drawing-card__preview--creating">
                  <PencilSimpleLine size={28} weight="duotone" />
                </div>
                <div className="drawing-card__create-form">
                  <input
                    type="text"
                    className="drawing-create-input"
                    value={newDrawingName}
                    onChange={(e) => setNewDrawingName(e.target.value)}
                    placeholder="Drawing name"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') createDrawing()
                      if (e.key === 'Escape') setIsCreatingDrawing(false)
                    }}
                    autoFocus
                  />
                  <div className="drawing-create-actions">
                    <button type="button" className="drawing-create-btn" onClick={createDrawing}>
                      Create
                    </button>
                    <button type="button" className="drawing-create-cancel" onClick={() => setIsCreatingDrawing(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Personal drawings (when viewing "All") */}
            {activeWorkspace === null && personalDrawings.map((drawing) => (
              <div
                key={drawing.id}
                className="drawing-card"
                onClick={() => navigate(`/draw/${drawing.id}`)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setContextMenu({ type: 'drawing', id: drawing.id, x: e.clientX, y: e.clientY })
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/draw/${drawing.id}`) }}
              >
                <div className={`drawing-card__preview${drawing.thumbnailUrl ? ' drawing-card__preview--has-thumb' : ''}`}>
                  {drawing.thumbnailUrl ? (
                    <img
                      src={drawing.thumbnailUrl}
                      alt={drawing.name}
                      className="drawing-card__thumb"
                      loading="lazy"
                    />
                  ) : (
                    <PencilSimpleLine size={28} weight="duotone" />
                  )}
                </div>
                <div className="drawing-card__info">
                  {renameTarget?.type === 'drawing' && renameTarget.id === drawing.id ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      className="drawing-rename-input"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename()
                        if (e.key === 'Escape') setRenameTarget(null)
                      }}
                      onBlur={handleRename}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="drawing-card__name">{drawing.name}</span>
                  )}
                  <span className="drawing-card__meta">
                    {drawing.ownerId === user.uid ? 'Personal' : 'Shared'}
                    {' · '}
                    {new Date(drawing.updatedAt || drawing.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <button
                  type="button"
                  className="drawing-card__more"
                  onClick={(e) => {
                    e.stopPropagation()
                    setContextMenu({ type: 'drawing', id: drawing.id, x: e.clientX, y: e.clientY })
                  }}
                >
                  <DotsThreeVertical size={18} weight="bold" />
                </button>
              </div>
            ))}

            {/* Workspace drawings */}
            {activeWorkspace && workspaceDrawings.map((drawing) => (
              <div
                key={drawing.id}
                className="drawing-card"
                onClick={() => navigate(`/draw/${drawing.id}`)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setContextMenu({ type: 'drawing', id: drawing.id, x: e.clientX, y: e.clientY })
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/draw/${drawing.id}`) }}
              >
                <div className={`drawing-card__preview${drawing.thumbnailUrl ? ' drawing-card__preview--has-thumb' : ''}`}>
                  {drawing.thumbnailUrl ? (
                    <img
                      src={drawing.thumbnailUrl}
                      alt={drawing.name}
                      className="drawing-card__thumb"
                      loading="lazy"
                    />
                  ) : (
                    <PencilSimpleLine size={28} weight="duotone" />
                  )}
                </div>
                <div className="drawing-card__info">
                  {renameTarget?.type === 'drawing' && renameTarget.id === drawing.id ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      className="drawing-rename-input"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename()
                        if (e.key === 'Escape') setRenameTarget(null)
                      }}
                      onBlur={handleRename}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="drawing-card__name">{drawing.name}</span>
                  )}
                  <span className="drawing-card__meta">
                    {new Date(drawing.updatedAt || drawing.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <button
                  type="button"
                  className="drawing-card__more"
                  onClick={(e) => {
                    e.stopPropagation()
                    setContextMenu({ type: 'drawing', id: drawing.id, x: e.clientX, y: e.clientY })
                  }}
                >
                  <DotsThreeVertical size={18} weight="bold" />
                </button>
              </div>
            ))}
          </div>

          {filteredDrawings.length === 0 && !isCreatingDrawing && (
            <div className="dashboard-empty">
              <div className="dashboard-empty__icon">
                <PencilSimpleLine size={36} weight="duotone" />
              </div>
              <p>{searchQuery ? 'No drawings match your search' : 'No drawings yet'}</p>
              <span>Create your first drawing to get started</span>
            </div>
          )}
        </div>
      </main>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={contextRef}
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            type="button"
            className="context-menu__item"
            onClick={() => {
              const target = contextMenu.type === 'drawing'
                ? drawings.find((d) => d.id === contextMenu.id)
                : workspaces.find((ws) => ws.id === contextMenu.id)
              setRenameTarget({ type: contextMenu.type, id: contextMenu.id })
              setRenameValue(target?.name || '')
              setContextMenu(null)
            }}
          >
            <PencilSimple size={16} />
            <span>Rename</span>
          </button>
          <button
            type="button"
            className="context-menu__item"
            onClick={() => {
              setShareDialogTarget({ type: contextMenu.type, id: contextMenu.id })
              setContextMenu(null)
            }}
          >
            <ShareNetwork size={16} />
            <span>Share</span>
          </button>
          <button
            type="button"
            className="context-menu__item context-menu__item--danger"
            onClick={() => {
              if (contextMenu.type === 'drawing') deleteDrawing(contextMenu.id)
              else deleteWorkspace(contextMenu.id)
            }}
          >
            <Trash size={16} />
            <span>Delete</span>
          </button>
        </div>
      )}

      {/* Share Dialog */}
      {shareDialogTarget && (
        <div className="share-overlay" onClick={() => setShareDialogTarget(null)}>
          <div className="share-dialog" onClick={(e) => e.stopPropagation()}>
            <h2 className="share-dialog__title">
              <Users size={20} />
              <span>Share {shareDialogTarget.type}</span>
            </h2>
            <div className="share-dialog__body">
              <input
                type="email"
                className="share-dialog__input"
                placeholder="Enter email address"
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
              <button type="button" className="share-dialog__btn" onClick={handleShareInvite}>
                Invite
              </button>
            </div>
            <button
              type="button"
              className="share-dialog__close"
              onClick={() => setShareDialogTarget(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

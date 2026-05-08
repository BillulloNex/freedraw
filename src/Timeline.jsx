import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { limitToLast, onValue, orderByChild, query, ref } from 'firebase/database'

import { database } from './firebase'
import './Timeline.css'

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return 'Unknown date'
  }
  try {
    return new Date(timestamp).toLocaleString()
  } catch (error) {
    console.error('Failed to format timeline timestamp:', error)
    return 'Unknown date'
  }
}

function Timeline() {
  const [snapshots, setSnapshots] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const snapshotsQuery = query(
      ref(database, 'snapshots'),
      orderByChild('createdAt'),
      limitToLast(100)
    )

    const unsubscribe = onValue(
      snapshotsQuery,
      (snapshot) => {
        const data = snapshot.val() || {}
        const parsed = Object.entries(data).map(([key, value]) => ({
          id: key,
          ...(value || {}),
        }))
        parsed.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        setSnapshots(parsed)
        setLoading(false)
      },
      (firebaseError) => {
        console.error('Failed to load timeline snapshots:', firebaseError)
        setError(firebaseError)
        setLoading(false)
      }
    )

    return () => {
      unsubscribe()
    }
  }, [])

  const stats = useMemo(() => {
    if (!snapshots.length) {
      return {
        total: 0,
        latest: null,
      }
    }
    return {
      total: snapshots.length,
      latest: snapshots[0]?.createdAt || null,
    }
  }, [snapshots])

  return (
    <div className="timeline-page">
      <header className="timeline-header">
        <div>
          <p className="timeline-kicker">Arcadia canvas history</p>
          <h1>Timeline</h1>
          <p className="timeline-subtitle">
            Every exported canvas snapshot is preserved here so the team can rewind, review, and share progress.
          </p>
        </div>
        <div className="timeline-header__actions">
          <Link to="/" className="timeline-button timeline-button--primary">
            Back to Dashboard
          </Link>
          <Link to="/analytics" className="timeline-button">
            View analytics
          </Link>
        </div>
      </header>

      <section className="timeline-meta">
        <div className="timeline-meta__card">
          <span className="timeline-meta__label">Snapshots</span>
          <strong className="timeline-meta__value">{stats.total}</strong>
        </div>
        <div className="timeline-meta__card">
          <span className="timeline-meta__label">Latest export</span>
          <strong className="timeline-meta__value">
            {stats.latest ? formatTimestamp(stats.latest) : 'No exports yet'}
          </strong>
        </div>
      </section>

      {loading && <div className="timeline-loading">Loading timeline…</div>}
      {error && !loading && (
        <div className="timeline-error">
          Unable to load timeline right now. Please try again in a bit.
        </div>
      )}
      {!loading && !error && snapshots.length === 0 && (
        <div className="timeline-empty">
          <p>No snapshots have been saved yet. Export the canvas to create the first milestone.</p>
        </div>
      )}

      <section className="timeline-feed">
        {snapshots.map((snapshot) => (
          <article key={snapshot.id || snapshot.createdAt} className="timeline-card">
            <div className="timeline-card__meta">
              <div className="timeline-card__owner">
                <span
                  className={`timeline-card__avatar${
                    snapshot.avatarUrl ? ' timeline-card__avatar--image' : ''
                  }`}
                  style={{ backgroundColor: snapshot.userColor || '#4ECDC4' }}
                >
                  {snapshot.avatarUrl ? (
                    <img src={snapshot.avatarUrl} alt={`${snapshot.username || 'User'} avatar`} />
                  ) : (
                    snapshot.username?.charAt(0)?.toUpperCase() || 'A'
                  )}
                </span>
                <div className="timeline-card__owner-details">
                  <span className="timeline-card__owner-name">{snapshot.username || 'Unknown'}</span>
                  <span className="timeline-card__timestamp">
                    {formatTimestamp(snapshot.createdAt)}
                  </span>
                </div>
              </div>
              {snapshot.appVersion && (
                <span className="timeline-chip">v{snapshot.appVersion}</span>
              )}
            </div>
            <div className="timeline-card__preview">
              <img
                src={snapshot.imageUrl}
                alt={`Canvas snapshot from ${formatTimestamp(snapshot.createdAt)}`}
                loading="lazy"
              />
            </div>
            <div className="timeline-card__footer">
              <div className="timeline-card__details">
                <span>
                  Elements:{' '}
                  <strong>{Number.isFinite(snapshot.elementsCount) ? snapshot.elementsCount : '—'}</strong>
                </span>
                <span>
                  Theme: <strong>{snapshot.theme || 'Unknown'}</strong>
                </span>
              </div>
              <a
                className="timeline-button timeline-button--ghost"
                href={snapshot.imageUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Download
              </a>
            </div>
          </article>
        ))}
      </section>
    </div>
  )
}

export default Timeline

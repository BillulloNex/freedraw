import { useEffect, useState } from 'react'
import { ref, onValue } from 'firebase/database'
import { database } from './firebase'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import './Analytics.css'

const COLORS = ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#00f2fe', '#43e97b', '#fa709a']
const DAY_IN_MS = 24 * 60 * 60 * 1000
const WEEK_IN_MS = DAY_IN_MS * 7
const MONTH_IN_MS = DAY_IN_MS * 30

function Analytics() {
  const [sessions, setSessions] = useState({})
  const [presence, setPresence] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Read sessions from ALL drawings: sessions/{drawingId}/{userId}/{sessionId}
    const sessionsRef = ref(database, 'sessions')
    const unsubscribeSessions = onValue(sessionsRef, (snapshot) => {
      const rawData = snapshot.val() || {}
      // Flatten: { drawingId: { userId: { sessionId: session } } } → { userId: { sessionId: session } }
      const merged = {}
      Object.values(rawData).forEach((drawingSessions) => {
        if (!drawingSessions || typeof drawingSessions !== 'object') return
        Object.entries(drawingSessions).forEach(([userId, userSessions]) => {
          if (!userSessions || typeof userSessions !== 'object') return
          if (!merged[userId]) merged[userId] = {}
          Object.assign(merged[userId], userSessions)
        })
      })
      setSessions(merged)
      setLoading(false)
    })

    // Read presence from ALL drawings: presence/{drawingId}/users/{userId}
    const presenceRef = ref(database, 'presence')
    const unsubscribePresence = onValue(presenceRef, (snapshot) => {
      const rawData = snapshot.val() || {}
      const merged = {}
      Object.values(rawData).forEach((drawingPresence) => {
        const users = drawingPresence?.users
        if (!users || typeof users !== 'object') return
        Object.entries(users).forEach(([userId, userData]) => {
          // Keep the most recently active entry for each user
          if (!merged[userId] || (userData?.lastActiveAt || 0) > (merged[userId]?.lastActiveAt || 0)) {
            merged[userId] = userData
          }
        })
      })
      setPresence(merged)
    })

    return () => {
      unsubscribeSessions()
      unsubscribePresence()
    }
  }, [])

  const calculateMetrics = () => {
    const activeUsers = Object.values(presence).filter(Boolean).length
    const uniqueUsers = Object.keys(sessions).length
    const now = Date.now()

    let allSessions = []
    let totalSessions = 0
    const dailyActiveSet = new Set()
    const weeklyActiveSet = new Set()
    const monthlyActiveSet = new Set()
    const weeklySessionsByUser = new Map()
    const userMetaMap = new Map()
    const userTimeStatsMap = new Map()
    const dailyActiveMap = new Map()

    Object.entries(sessions).forEach(([userId, userSessions]) => {
      const sessionsArray = Object.entries(userSessions || {}).map(([sessionId, session]) => ({
        ...session,
        sessionId,
        userId,
        avatarUrl: session.avatarUrl || null,
      }))

      if (sessionsArray[0]) {
        userMetaMap.set(userId, sessionsArray[0])
      }

      sessionsArray.forEach((session) => {
        const startedAt = session.startedAt || 0
        if (startedAt >= now - DAY_IN_MS) {
          dailyActiveSet.add(userId)
        }
        if (startedAt >= now - WEEK_IN_MS) {
          weeklyActiveSet.add(userId)
          weeklySessionsByUser.set(userId, (weeklySessionsByUser.get(userId) || 0) + 1)
        }
        if (startedAt >= now - MONTH_IN_MS) {
          monthlyActiveSet.add(userId)
        }

        if (startedAt > 0) {
          const dayKey = new Date(startedAt).toISOString().slice(0, 10)
          if (!dailyActiveMap.has(dayKey)) {
            dailyActiveMap.set(dayKey, new Set())
          }
          dailyActiveMap.get(dayKey).add(userId)

          const duration = Math.max((session.endedAt || now) - startedAt, 0)
          const existing = userTimeStatsMap.get(userId) || {
            totalDuration: 0,
            sessionCount: 0,
            lastActive: 0,
          }
          existing.totalDuration += duration
          existing.sessionCount += 1
          existing.lastActive = Math.max(existing.lastActive, session.endedAt || session.startedAt || 0)
          userTimeStatsMap.set(userId, existing)
        }
      })

      allSessions.push(...sessionsArray)
      totalSessions += sessionsArray.length
    })

    const activeSessions = allSessions.filter((s) => !s.endedAt).length
    const completedSessions = allSessions.filter((s) => s.endedAt && s.startedAt)
    const durations = completedSessions.map((s) => s.endedAt - s.startedAt)
    const avgDuration =
      durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0

    const userSessionCounts = Object.entries(sessions).map(([userId, userSessions]) => {
      const sessionValues = Object.values(userSessions || {})
      const representativeSession = sessionValues[0] || {}
      return {
        userId,
        count: Object.keys(userSessions || {}).length,
        username: representativeSession.username || 'Unknown',
        color: representativeSession.color || '#666',
        avatarUrl: representativeSession.avatarUrl || null,
      }
    })
    userSessionCounts.sort((a, b) => b.count - a.count)
    const mostActiveUser = userSessionCounts[0] || null

    const oneDayAgo = now - DAY_IN_MS
    const recentSessions = allSessions.filter((s) => s.startedAt >= oneDayAgo).length

    allSessions.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
    const sessionsForCharts = [...allSessions]
    const recentSessionsList = allSessions.slice(0, 20)

    const dailyActiveUsers = dailyActiveSet.size
    const weeklyActiveUsers = weeklyActiveSet.size
    const monthlyActiveUsers = monthlyActiveSet.size

    const weeklyCounts = Array.from(weeklySessionsByUser.values())
    let returningUsers7d = 0
    let returningSessionsTotal7d = 0
    weeklyCounts.forEach((count) => {
      if (count > 1) {
        returningUsers7d += 1
        returningSessionsTotal7d += count
      }
    })

    const avgSessionsPerUser = uniqueUsers > 0 ? totalSessions / uniqueUsers : 0
    const sessionsPerReturningUser7d = returningUsers7d > 0 ? returningSessionsTotal7d / returningUsers7d : 0

    const userTimeStats = Array.from(userTimeStatsMap.entries()).map(([userId, data]) => {
      const meta = userMetaMap.get(userId) || {}
      const avgPerSession = data.sessionCount > 0 ? data.totalDuration / data.sessionCount : 0
      return {
        userId,
        username: meta.username || 'Unknown',
        color: meta.color || '#666',
        avatarUrl: meta.avatarUrl || null,
        totalDuration: data.totalDuration,
        sessionCount: data.sessionCount,
        avgDuration: avgPerSession,
        lastActive: data.lastActive,
      }
    })

    const totalTrackedTime = userTimeStats.reduce((sum, stat) => sum + stat.totalDuration, 0)
    userTimeStats.sort((a, b) => b.totalDuration - a.totalDuration)
    const userTimeStatsWithShare = userTimeStats.map((stat) => ({
      ...stat,
      share: totalTrackedTime > 0 ? stat.totalDuration / totalTrackedTime : 0,
    }))

    const stickinessRatio = monthlyActiveUsers > 0 ? dailyActiveUsers / monthlyActiveUsers : 0
    const weeklyStickinessRatio = weeklyActiveUsers > 0 ? dailyActiveUsers / weeklyActiveUsers : 0
    const returningRate7d = weeklyActiveUsers > 0 ? returningUsers7d / weeklyActiveUsers : 0
    const newUsers7d = Math.max(weeklyActiveUsers - returningUsers7d, 0)

    const dailyActiveSeries = []
    for (let i = 6; i >= 0; i--) {
      const dayStart = now - i * DAY_IN_MS
      const dayKey = new Date(dayStart).toISOString().slice(0, 10)
      const dateLabel = new Date(dayStart).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
      dailyActiveSeries.push({
        date: dateLabel,
        users: dailyActiveMap.get(dayKey)?.size || 0,
      })
    }
    const totalMinutesSpent = totalTrackedTime / (60 * 1000)

    return {
      activeUsers,
      uniqueUsers,
      totalSessions,
      activeSessions,
      avgDuration,
      mostActiveUser,
      recentSessions,
      dailyActiveUsers,
      weeklyActiveUsers,
      monthlyActiveUsers,
      stickinessRatio,
      weeklyStickinessRatio,
      returningUsers7d,
      returningRate7d,
      avgSessionsPerUser,
      sessionsPerReturningUser7d,
      newUsers7d,
      totalTrackedTime,
      totalMinutesSpent,
      userTimeStats: userTimeStatsWithShare,
      sessionsForCharts,
      dailyActiveSeries,
      allSessions: recentSessionsList,
      completedSessions,
      userSessionCounts: userSessionCounts.slice(0, 10),
    }
  }

  const prepareChartData = (metrics) => {
    // Sessions over time (last 7 days)
    const sessionsOverTime = []
    const now = Date.now()
    for (let i = 6; i >= 0; i--) {
      const dayStart = now - i * 24 * 60 * 60 * 1000
      const dayEnd = now - (i - 1) * 24 * 60 * 60 * 1000
      const date = new Date(dayStart)
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

      const sessionsInDay = metrics.sessionsForCharts.filter(
        (s) => s.startedAt >= dayStart && s.startedAt < dayEnd
      ).length

      sessionsOverTime.push({
        date: dayName,
        sessions: sessionsInDay,
      })
    }

    // Session duration distribution
    const durationBuckets = {
      '0-1 min': 0,
      '1-5 min': 0,
      '5-15 min': 0,
      '15-30 min': 0,
      '30+ min': 0,
    }

    metrics.completedSessions.forEach((s) => {
      const duration = (s.endedAt - s.startedAt) / 1000 / 60 // minutes
      if (duration < 1) durationBuckets['0-1 min']++
      else if (duration < 5) durationBuckets['1-5 min']++
      else if (duration < 15) durationBuckets['5-15 min']++
      else if (duration < 30) durationBuckets['15-30 min']++
      else durationBuckets['30+ min']++
    })

    const durationData = Object.entries(durationBuckets).map(([name, value]) => ({
      name,
      value,
    }))

    // Hourly activity distribution
    const hourlyActivity = Array.from({ length: 24 }, (_, i) => ({
      hour: `${i}:00`,
      sessions: 0,
    }))

    metrics.sessionsForCharts.forEach((s) => {
      const startedAt = Number(s.startedAt)
      if (!Number.isFinite(startedAt)) {
        return
      }
      const hour = new Date(startedAt).getHours()
      if (Number.isNaN(hour) || !hourlyActivity[hour]) {
        return
      }
      hourlyActivity[hour].sessions++
    })

    const engagementFunnel = [
      { label: 'Monthly Active', users: metrics.monthlyActiveUsers },
      { label: 'Weekly Active', users: metrics.weeklyActiveUsers },
      { label: 'Daily Active', users: metrics.dailyActiveUsers },
      { label: 'Returning (7d)', users: metrics.returningUsers7d },
    ]

    return {
      sessionsOverTime,
      durationData,
      hourlyActivity,
      dailyActiveUsers: metrics.dailyActiveSeries,
      engagementFunnel,
      topUsers: metrics.userSessionCounts.map((u) => ({
        username: u.username,
        sessions: u.count,
        color: u.color,
        avatarUrl: u.avatarUrl || null,
      })),
    }
  }

  const formatDuration = (ms) => {
    if (!ms || ms < 0) return '0s'
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`
    } else {
      return `${seconds}s`
    }
  }

  const formatPercent = (value, { fallback = '0%' } = {}) => {
    if (!Number.isFinite(value) || value <= 0) {
      return fallback
    }
    const precision = value < 0.1 ? 1 : 0
    return `${(value * 100).toFixed(precision)}%`
  }

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'N/A'
    const date = new Date(timestamp)
    return date.toLocaleString()
  }

  if (loading) {
    return (
      <div className="analytics-container">
        <div className="loading">Loading analytics...</div>
      </div>
    )
  }

  const metrics = calculateMetrics()
  const chartData = prepareChartData(metrics)

  return (
    <div className="analytics-container">
      <header className="analytics-header">
        <h1>📊 User Analytics Dashboard</h1>
        <a href="/" className="back-link">
          ← Back to Dashboard
        </a>
      </header>

      {/* Metrics Cards */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-icon">👥</div>
          <div className="metric-value">{metrics.activeUsers}</div>
          <div className="metric-label">Active Users</div>
          <div className="metric-sublabel">Currently online</div>
        </div>

        <div className="metric-card">
          <div className="metric-icon">🌟</div>
          <div className="metric-value">{metrics.uniqueUsers}</div>
          <div className="metric-label">Total Users</div>
          <div className="metric-sublabel">All time</div>
        </div>

        <div className="metric-card">
          <div className="metric-icon">📊</div>
          <div className="metric-value">{metrics.totalSessions}</div>
          <div className="metric-label">Total Sessions</div>
          <div className="metric-sublabel">{metrics.activeSessions} active now</div>
        </div>

        <div className="metric-card">
          <div className="metric-icon">⏱️</div>
          <div className="metric-value">{formatDuration(metrics.avgDuration)}</div>
          <div className="metric-label">Avg Session Time</div>
          <div className="metric-sublabel">Per completed session</div>
        </div>

        <div className="metric-card">
          <div className="metric-icon">🧮</div>
          <div className="metric-value">{Math.round(metrics.totalMinutesSpent).toLocaleString()}</div>
          <div className="metric-label">Minutes Tracked</div>
          <div className="metric-sublabel">Lifetime on canvas</div>
        </div>

        <div className="metric-card">
          <div className="metric-icon">📅</div>
          <div className="metric-value">{metrics.recentSessions}</div>
          <div className="metric-label">Last 24 Hours</div>
          <div className="metric-sublabel">Recent activity</div>
        </div>

        {metrics.mostActiveUser && (
          <div className="metric-card">
            <div className="metric-icon">🏆</div>
            <div className="metric-most-active">
              <div
                className={`metric-most-active__avatar${
                  metrics.mostActiveUser.avatarUrl ? ' metric-most-active__avatar--image' : ''
                }`}
                style={{ backgroundColor: metrics.mostActiveUser.color }}
              >
                {metrics.mostActiveUser.avatarUrl ? (
                  <img src={metrics.mostActiveUser.avatarUrl} alt={`${metrics.mostActiveUser.username} avatar`} />
                ) : (
                  metrics.mostActiveUser.username?.charAt(0)?.toUpperCase() ?? '?'
                )}
              </div>
              <div className="metric-most-active__meta">
                <div
                  className="metric-value"
                  style={{ color: metrics.mostActiveUser.color, fontSize: '1.2rem' }}
                >
                  {metrics.mostActiveUser.username}
                </div>
                <div className="metric-sublabel">{metrics.mostActiveUser.count} sessions</div>
              </div>
            </div>
            <div className="metric-label">Most Active User</div>
          </div>
        )}
      </div>

      {/* Product Stickiness Metrics */}
      <section className="stickiness-section">
        <div className="stickiness-header">
          <div>
            <h2>🧲 Product Stickiness</h2>
            <p>Rolling engagement signals for the last 30 days</p>
          </div>
          <div className="stickiness-highlight">
            <span className="stickiness-value">{formatPercent(metrics.stickinessRatio)}</span>
            <span className="stickiness-label">DAU / MAU</span>
            <span className="stickiness-subtext">
              {metrics.monthlyActiveUsers > 0
                ? `${metrics.dailyActiveUsers} of ${metrics.monthlyActiveUsers} monthly actives were active today`
                : 'No monthly activity yet'}
            </span>
          </div>
        </div>

        <div className="stickiness-grid">
          <div className="metric-card">
            <div className="metric-icon">📅</div>
            <div className="metric-value">{metrics.dailyActiveUsers}</div>
            <div className="metric-label">Daily Active Users</div>
            <div className="metric-sublabel">Past 24 hours</div>
          </div>

          <div className="metric-card">
            <div className="metric-icon">🗓️</div>
            <div className="metric-value">{metrics.weeklyActiveUsers}</div>
            <div className="metric-label">Weekly Active Users</div>
            <div className="metric-sublabel">DAU / WAU {formatPercent(metrics.weeklyStickinessRatio)}</div>
          </div>

          <div className="metric-card">
            <div className="metric-icon">🔁</div>
            <div className="metric-value">{metrics.returningUsers7d}</div>
            <div className="metric-label">Returning Users (7d)</div>
            <div className="metric-sublabel">Return rate {formatPercent(metrics.returningRate7d)}</div>
          </div>

          <div className="metric-card">
            <div className="metric-icon">✨</div>
            <div className="metric-value">{metrics.newUsers7d}</div>
            <div className="metric-label">New Users (7d)</div>
            <div className="metric-sublabel">First-time collaborators</div>
          </div>

          <div className="metric-card">
            <div className="metric-icon">📈</div>
            <div className="metric-value">{metrics.avgSessionsPerUser.toFixed(1)}</div>
            <div className="metric-label">Avg Sessions / User</div>
            <div className="metric-sublabel">Lifetime average</div>
          </div>

          <div className="metric-card">
            <div className="metric-icon">🧲</div>
            <div className="metric-value">{metrics.sessionsPerReturningUser7d.toFixed(1)}</div>
            <div className="metric-label">Sessions per Returner</div>
            <div className="metric-sublabel">Last 7 days</div>
          </div>
        </div>
      </section>

      {/* User Time Spent Breakdown */}
      <section className="time-spent-section">
        <div className="time-spent-header">
          <div>
            <h2>⏳ Time Spent by User</h2>
            <p>Includes completed sessions plus time from in-progress sessions</p>
          </div>
          <div className="time-spent-summary">
            <span>Total tracked time</span>
            <strong>{formatDuration(metrics.totalTrackedTime)}</strong>
          </div>
        </div>

        {metrics.userTimeStats.length > 0 ? (
          <div className="time-spent-table">
            <div className="time-spent-row time-spent-row--head">
              <div className="col-user">User</div>
              <div className="col-total-time">Total Time</div>
              <div className="col-session-count">Sessions</div>
              <div className="col-avg-session">Avg Session</div>
              <div className="col-time-share">Time Share</div>
              <div className="col-last-active">Last Active</div>
            </div>
            {metrics.userTimeStats.map((stat) => (
              <div key={stat.userId} className="time-spent-row">
                <div className="col-user">
                  <div
                    className={`session-avatar${stat.avatarUrl ? ' session-avatar--image' : ''}`}
                    style={{ backgroundColor: stat.color }}
                  >
                    {stat.avatarUrl ? (
                      <img src={stat.avatarUrl} alt={`${stat.username || 'User'} avatar`} />
                    ) : (
                      stat.username?.charAt(0)?.toUpperCase() || '?'
                    )}
                  </div>
                  <span>{stat.username || 'Unknown'}</span>
                </div>
                <div className="col-total-time">{formatDuration(stat.totalDuration)}</div>
                <div className="col-session-count">{stat.sessionCount}</div>
                <div className="col-avg-session">{formatDuration(stat.avgDuration)}</div>
                <div className="col-time-share">
                  <div className="time-share">
                    <div className="time-share__value">{formatPercent(stat.share)}</div>
                    <div className="time-share__bar">
                      <div
                        className="time-share__bar-fill"
                        style={{ width: `${Math.min(stat.share * 100, 100).toFixed(0)}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
                <div className="col-last-active">{formatTimestamp(stat.lastActive)}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">No time tracking data available yet</div>
        )}
      </section>

      {/* Charts Grid */}
      <div className="charts-grid">
        {/* Sessions Over Time */}
        <div className="chart-card">
          <h3>📈 Sessions Over Time (Last 7 Days)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData.sessionsOverTime}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="date" stroke="rgba(255,255,255,0.7)" />
              <YAxis stroke="rgba(255,255,255,0.7)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(0,0,0,0.8)',
                  border: 'none',
                  borderRadius: '8px',
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="sessions"
                stroke="#4facfe"
                strokeWidth={3}
                dot={{ fill: '#4facfe', r: 5 }}
                activeDot={{ r: 8 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Daily Active Users */}
        <div className="chart-card">
          <h3>🧍 Daily Active Users (Last 7 Days)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData.dailyActiveUsers}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="date" stroke="rgba(255,255,255,0.7)" />
              <YAxis stroke="rgba(255,255,255,0.7)" allowDecimals={false} />
              <Tooltip
                formatter={(value) => [`${value} users`, 'Users']}
                contentStyle={{
                  backgroundColor: 'rgba(0,0,0,0.8)',
                  border: 'none',
                  borderRadius: '8px',
                }}
              />
              <Legend />
              <Bar dataKey="users" fill="#fa709a" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Stickiness Breakdown */}
        <div className="chart-card">
          <h3>🧲 Active Users by Time Window</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData.engagementFunnel}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="label" stroke="rgba(255,255,255,0.7)" />
              <YAxis stroke="rgba(255,255,255,0.7)" />
              <Tooltip
                formatter={(value) => [`${value} users`, 'Users']}
                contentStyle={{
                  backgroundColor: 'rgba(0,0,0,0.8)',
                  border: 'none',
                  borderRadius: '8px',
                }}
              />
              <Legend />
              <Bar dataKey="users" fill="#43e97b" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top Active Users */}
        <div className="chart-card">
          <h3>🏆 Top 10 Active Users</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData.topUsers}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="username" stroke="rgba(255,255,255,0.7)" />
              <YAxis stroke="rgba(255,255,255,0.7)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(0,0,0,0.8)',
                  border: 'none',
                  borderRadius: '8px',
                }}
              />
              <Legend />
              <Bar dataKey="sessions" fill="#667eea" radius={[8, 8, 0, 0]}>
                {chartData.topUsers.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Session Duration Distribution */}
        <div className="chart-card">
          <h3>⏱️ Session Duration Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={chartData.durationData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) =>
                  percent > 0 ? `${name}: ${(percent * 100).toFixed(0)}%` : null
                }
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
              >
                {chartData.durationData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(0,0,0,0.8)',
                  border: 'none',
                  borderRadius: '8px',
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Hourly Activity Pattern */}
        <div className="chart-card">
          <h3>🕐 Activity by Hour of Day</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData.hourlyActivity}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="hour" stroke="rgba(255,255,255,0.7)" />
              <YAxis stroke="rgba(255,255,255,0.7)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(0,0,0,0.8)',
                  border: 'none',
                  borderRadius: '8px',
                }}
              />
              <Legend />
              <Area
                type="monotone"
                dataKey="sessions"
                stroke="#f093fb"
                fill="url(#colorSessions)"
                strokeWidth={2}
              />
              <defs>
                <linearGradient id="colorSessions" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f093fb" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#f093fb" stopOpacity={0.1} />
                </linearGradient>
              </defs>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Currently Online Users */}
      <div className="active-users-section">
        <h2>Currently Online ({metrics.activeUsers})</h2>
        <div className="users-list">
          {Object.values(presence).map((user) => (
            <div key={user.id} className="user-badge">
              <div
                className={`user-avatar${user.avatarUrl ? ' user-avatar--image' : ''}`}
                style={{ backgroundColor: user.color }}
              >
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt={`${user.username || 'User'} avatar`} />
                ) : (
                  user.username?.charAt(0)?.toUpperCase() || '?'
                )}
              </div>
              <div className="user-info">
                <div className="user-name">{user.username}</div>
                <div className="user-status">
                  Last active: {formatTimestamp(user.lastActiveAt)}
                </div>
              </div>
              <div className="online-indicator-dot"></div>
            </div>
          ))}
          {metrics.activeUsers === 0 && (
            <div className="empty-state">No users currently online</div>
          )}
        </div>
      </div>

      {/* Recent Sessions Table */}
      <div className="sessions-section">
        <h2>Recent Sessions (Top 20)</h2>
        <div className="sessions-table">
          <div className="table-header">
            <div className="col-user">User</div>
            <div className="col-started">Started</div>
            <div className="col-ended">Ended</div>
            <div className="col-duration">Duration</div>
            <div className="col-status">Status</div>
          </div>
          {metrics.allSessions.map((session) => {
            const duration = session.endedAt
              ? session.endedAt - session.startedAt
              : Date.now() - session.startedAt
            const isActive = !session.endedAt

            return (
              <div key={session.sessionId} className="table-row">
                <div className="col-user">
                  <div
                    className={`session-avatar${session.avatarUrl ? ' session-avatar--image' : ''}`}
                    style={{ backgroundColor: session.color }}
                  >
                    {session.avatarUrl ? (
                      <img src={session.avatarUrl} alt={`${session.username || 'User'} avatar`} />
                    ) : (
                      session.username?.charAt(0)?.toUpperCase() || '?'
                    )}
                  </div>
                  <span>{session.username || 'Unknown'}</span>
                </div>
                <div className="col-started">{formatTimestamp(session.startedAt)}</div>
                <div className="col-ended">
                  {isActive ? (
                    <span className="active-badge">Active</span>
                  ) : (
                    formatTimestamp(session.endedAt)
                  )}
                </div>
                <div className="col-duration">{formatDuration(duration)}</div>
                <div className="col-status">
                  {isActive ? (
                    <span className="status-badge status-active">🟢 Active</span>
                  ) : (
                    <span className="status-badge status-ended">⚫ Ended</span>
                  )}
                </div>
              </div>
            )
          })}
          {metrics.allSessions.length === 0 && (
            <div className="empty-state">No sessions recorded yet</div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Analytics

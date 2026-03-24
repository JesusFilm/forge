import { useEffect, useRef, useState, useCallback } from "react"
import {
  useFetchClient,
  useNotification,
  Page,
  Layouts,
} from "@strapi/strapi/admin"
import {
  Box,
  Flex,
  Typography,
  Button,
  Badge,
  Alert,
  Loader,
  Grid,
} from "@strapi/design-system"

const POLL_INTERVAL = 3000

type PhaseResult = {
  phase: string
  created: number
  updated: number
  softDeleted: number
  errors: number
}

type SyncStatus = {
  inProgress: boolean
  lastRun: string | null
  currentPhase: string | null
  completedPhases: PhaseResult[]
  phaseProgress: { processed: number; total: number | null } | null
  lastResult: {
    skipped?: boolean
    phases?: PhaseResult[]
    scope?: string[]
    duration?: number
    error?: string
  } | null
}

type SnapshotStatus = {
  inProgress: boolean
  lastRun: string | null
  lastResult: {
    key?: string
    duration?: number
    sizeBytes?: number
    error?: string
  } | null
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

function StateBadge({
  inProgress,
  error,
}: {
  inProgress: boolean
  error?: string
}) {
  if (inProgress) return <Badge active>Running</Badge>
  if (error)
    return (
      <Badge backgroundColor="danger500" textColor="neutral0">
        Error
      </Badge>
    )
  return (
    <Badge backgroundColor="success500" textColor="neutral0">
      Idle
    </Badge>
  )
}

function PhaseResultsTable({ phases }: { phases: PhaseResult[] }) {
  if (phases.length === 0) return null

  return (
    <Box paddingTop={2}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Phase", "Created", "Updated", "Deleted", "Errors"].map((h) => (
              <th
                key={h}
                style={{
                  textAlign: "left",
                  padding: "4px 8px",
                  borderBottom: "1px solid #ddd",
                }}
              >
                <Typography variant="sigma" textColor="neutral600">
                  {h}
                </Typography>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {phases.map((p) => (
            <tr key={p.phase}>
              <td style={{ padding: "4px 8px" }}>
                <Typography variant="omega">{p.phase}</Typography>
              </td>
              <td style={{ padding: "4px 8px" }}>
                <Typography variant="omega">{p.created}</Typography>
              </td>
              <td style={{ padding: "4px 8px" }}>
                <Typography variant="omega">{p.updated}</Typography>
              </td>
              <td style={{ padding: "4px 8px" }}>
                <Typography variant="omega">{p.softDeleted}</Typography>
              </td>
              <td style={{ padding: "4px 8px" }}>
                <Typography
                  variant="omega"
                  textColor={p.errors > 0 ? "danger600" : undefined}
                >
                  {p.errors}
                </Typography>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  )
}

function SyncCard({
  status,
  onTrigger,
  triggering,
}: {
  status: SyncStatus | null
  onTrigger: () => void
  triggering: boolean
}) {
  const inProgress = status?.inProgress ?? false
  const error = status?.lastResult?.error

  return (
    <Box background="neutral0" padding={6} shadow="tableShadow" hasRadius>
      <Flex justifyContent="space-between" alignItems="center">
        <Typography variant="delta" tag="h2">
          Gateway Sync
        </Typography>
        <StateBadge inProgress={inProgress} error={error} />
      </Flex>

      {status?.lastRun && (
        <Box paddingTop={2}>
          <Typography variant="omega" textColor="neutral600">
            Last run: {formatTime(status.lastRun)}
            {status.lastResult?.duration &&
              ` (${formatDuration(status.lastResult.duration)})`}
          </Typography>
        </Box>
      )}

      {inProgress && status?.currentPhase && (
        <Box paddingTop={3}>
          <Typography variant="omega" fontWeight="bold">
            Running: {status.currentPhase}
            {status.phaseProgress && (
              <>
                {" — "}
                {status.phaseProgress.total
                  ? `${status.phaseProgress.processed}/${status.phaseProgress.total} (${((status.phaseProgress.processed / status.phaseProgress.total) * 100).toFixed(0)}%)`
                  : `${status.phaseProgress.processed} processed`}
              </>
            )}
          </Typography>
        </Box>
      )}

      {inProgress &&
        status?.completedPhases &&
        status.completedPhases.length > 0 && (
          <PhaseResultsTable phases={status.completedPhases} />
        )}

      {!inProgress && status?.lastResult?.phases && (
        <PhaseResultsTable phases={status.lastResult.phases} />
      )}

      {error && (
        <Box paddingTop={3}>
          <Alert variant="danger" title="Sync failed">
            {error}
          </Alert>
        </Box>
      )}

      <Box paddingTop={4}>
        <Button
          onClick={onTrigger}
          disabled={inProgress || triggering}
          loading={triggering}
          variant="secondary"
        >
          Sync Now
        </Button>
      </Box>
    </Box>
  )
}

function SnapshotCard({
  status,
  downloadUrl,
  onTrigger,
  triggering,
}: {
  status: SnapshotStatus | null
  downloadUrl: string | null
  onTrigger: () => void
  triggering: boolean
}) {
  const inProgress = status?.inProgress ?? false
  const error = status?.lastResult?.error

  return (
    <Box background="neutral0" padding={6} shadow="tableShadow" hasRadius>
      <Flex justifyContent="space-between" alignItems="center">
        <Typography variant="delta" tag="h2">
          Data Snapshot
        </Typography>
        <StateBadge inProgress={inProgress} error={error} />
      </Flex>

      {status?.lastRun && (
        <Box paddingTop={2}>
          <Typography variant="omega" textColor="neutral600">
            Last snapshot: {formatTime(status.lastRun)}
            {status.lastResult?.duration &&
              ` (${formatDuration(status.lastResult.duration)})`}
          </Typography>
        </Box>
      )}

      {status?.lastResult?.sizeBytes && (
        <Box paddingTop={1}>
          <Typography variant="omega" textColor="neutral600">
            Size: {formatBytes(status.lastResult.sizeBytes)}
          </Typography>
        </Box>
      )}

      {inProgress && (
        <Box paddingTop={3}>
          <Flex alignItems="center" gap={2}>
            <Loader small />
            <Typography variant="omega">Creating snapshot...</Typography>
          </Flex>
        </Box>
      )}

      {error && (
        <Box paddingTop={3}>
          <Alert variant="danger" title="Snapshot failed">
            {error}
          </Alert>
        </Box>
      )}

      <Flex paddingTop={4} gap={2}>
        <Button
          onClick={onTrigger}
          disabled={inProgress || triggering}
          loading={triggering}
          variant="secondary"
        >
          Create Snapshot
        </Button>
        {downloadUrl && !inProgress && (
          <Button
            variant="tertiary"
            tag="a"
            href={downloadUrl}
            target="_blank"
            rel="noopener"
          >
            Download Backup
          </Button>
        )}
      </Flex>
    </Box>
  )
}

export default function SystemStatusPage() {
  const { get, post } = useFetchClient()
  const { toggleNotification } = useNotification()

  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [snapshotStatus, setSnapshotStatus] = useState<SnapshotStatus | null>(
    null,
  )
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [syncTriggering, setSyncTriggering] = useState(false)
  const [snapshotTriggering, setSnapshotTriggering] = useState(false)
  const [loading, setLoading] = useState(true)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStatuses = useCallback(async () => {
    try {
      const [syncRes, snapRes] = await Promise.all([
        get<SyncStatus>("/api/gateway-sync/status"),
        get<SnapshotStatus>("/api/data-snapshot/admin/status"),
      ])
      setSyncStatus(syncRes.data)
      setSnapshotStatus(snapRes.data)
    } catch {
      // Silently fail on poll — avoids toast spam
    }
  }, [get])

  const fetchDownloadUrl = useCallback(async () => {
    try {
      const res = await get<{ url: string }>(
        "/api/data-snapshot/admin/download",
      )
      setDownloadUrl(res.data.url)
    } catch {
      setDownloadUrl(null)
    }
  }, [get])

  // Initial fetch
  useEffect(() => {
    Promise.all([fetchStatuses(), fetchDownloadUrl()]).finally(() =>
      setLoading(false),
    )
  }, [fetchStatuses, fetchDownloadUrl])

  // Poll while any operation is in progress
  useEffect(() => {
    const anyInProgress = syncStatus?.inProgress || snapshotStatus?.inProgress
    if (anyInProgress && !pollRef.current) {
      pollRef.current = setInterval(fetchStatuses, POLL_INTERVAL)
    } else if (!anyInProgress && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
      // Refresh download URL when snapshot finishes
      fetchDownloadUrl()
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [
    syncStatus?.inProgress,
    snapshotStatus?.inProgress,
    fetchStatuses,
    fetchDownloadUrl,
  ])

  const triggerSync = async () => {
    setSyncTriggering(true)
    try {
      await post("/api/gateway-sync/trigger", {})
      toggleNotification({ type: "success", message: "Sync started" })
      // Start polling immediately
      await fetchStatuses()
    } catch {
      toggleNotification({ type: "danger", message: "Failed to start sync" })
    } finally {
      setSyncTriggering(false)
    }
  }

  const triggerSnapshot = async () => {
    setSnapshotTriggering(true)
    try {
      await post("/api/data-snapshot/admin/trigger", {})
      toggleNotification({ type: "success", message: "Snapshot started" })
      await fetchStatuses()
    } catch {
      toggleNotification({
        type: "danger",
        message: "Failed to start snapshot",
      })
    } finally {
      setSnapshotTriggering(false)
    }
  }

  if (loading) return <Page.Loading />

  return (
    <Page.Main>
      <Layouts.Header
        title="System Status"
        subtitle="Gateway sync and data snapshot status"
      />
      <Layouts.Content>
        <Grid.Root gap={6}>
          <Grid.Item col={6} s={12}>
            <SyncCard
              status={syncStatus}
              onTrigger={triggerSync}
              triggering={syncTriggering}
            />
          </Grid.Item>
          <Grid.Item col={6} s={12}>
            <SnapshotCard
              status={snapshotStatus}
              downloadUrl={downloadUrl}
              onTrigger={triggerSnapshot}
              triggering={snapshotTriggering}
            />
          </Grid.Item>
        </Grid.Root>
      </Layouts.Content>
    </Page.Main>
  )
}

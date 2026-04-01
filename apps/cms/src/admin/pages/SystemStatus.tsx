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

type PhaseWatermark = {
  phase: string
  lastSyncedAt: string
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
  isProduction?: boolean
  // Persisted data (available after restart)
  persistedLastRun?: string | null
  phaseWatermarks?: PhaseWatermark[]
}

type LocalImport = {
  lastImportedAt: string | null
  snapshotKey: string | null
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
  isProduction?: boolean
  // Persisted data (available after restart)
  persistedLastRun?: string | null
  latestSnapshot?: {
    key: string
    lastModified: string
    sizeBytes: number
  } | null
  // Local import data (non-production only)
  localImport?: LocalImport | null
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

function PhaseWatermarksTable({
  watermarks,
}: {
  watermarks: PhaseWatermark[]
}) {
  if (watermarks.length === 0) return null

  return (
    <Box paddingTop={2}>
      <Typography variant="sigma" textColor="neutral600">
        Phase watermarks (from database)
      </Typography>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Phase", "Last Synced"].map((h) => (
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
          {watermarks.map((w) => (
            <tr key={w.phase}>
              <td style={{ padding: "4px 8px" }}>
                <Typography variant="omega">{w.phase}</Typography>
              </td>
              <td style={{ padding: "4px 8px" }}>
                <Typography variant="omega">
                  {formatTime(w.lastSyncedAt)}
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
  const isProduction = status?.isProduction ?? false

  // Use in-memory lastRun, or fall back to persisted watermark time
  const effectiveLastRun = status?.lastRun ?? status?.persistedLastRun ?? null

  return (
    <Box background="neutral0" padding={6} shadow="tableShadow" hasRadius>
      <Flex justifyContent="space-between" alignItems="center">
        <Typography variant="delta" tag="h2">
          Core Sync
        </Typography>
        <StateBadge inProgress={inProgress} error={error} />
      </Flex>

      {!isProduction && (
        <Box paddingTop={2}>
          <Alert variant="default" title="Development mode" closeLabel="Close">
            Core sync is disabled outside production. Use{" "}
            <code>pnpm data-import</code> to restore a snapshot locally.
          </Alert>
        </Box>
      )}

      {effectiveLastRun && (
        <Box paddingTop={2}>
          <Typography variant="omega" textColor="neutral600">
            Last run: {formatTime(effectiveLastRun)}
            {status?.lastResult?.duration &&
              ` (${formatDuration(status.lastResult.duration)})`}
            {!status?.lastRun && status?.persistedLastRun && " (from database)"}
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

      {!inProgress &&
        !status?.lastResult?.phases &&
        status?.phaseWatermarks &&
        status.phaseWatermarks.length > 0 && (
          <PhaseWatermarksTable watermarks={status.phaseWatermarks} />
        )}

      {error && (
        <Box paddingTop={3}>
          <Alert variant="danger" title="Sync failed" closeLabel="Close">
            {error}
          </Alert>
        </Box>
      )}

      {isProduction && (
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
      )}
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
  const isProduction = status?.isProduction ?? false

  // Use in-memory lastRun, or fall back to persisted S3 metadata
  const effectiveLastRun = status?.lastRun ?? status?.persistedLastRun ?? null
  const effectiveSize =
    status?.lastResult?.sizeBytes ?? status?.latestSnapshot?.sizeBytes ?? null
  const effectiveKey =
    status?.lastResult?.key ?? status?.latestSnapshot?.key ?? null

  const localImport = status?.localImport

  return (
    <Box background="neutral0" padding={6} shadow="tableShadow" hasRadius>
      <Flex justifyContent="space-between" alignItems="center">
        <Typography variant="delta" tag="h2">
          Data Snapshot
        </Typography>
        <StateBadge inProgress={inProgress} error={error} />
      </Flex>

      {!isProduction && (
        <Box paddingTop={2}>
          <Alert variant="default" title="Development mode" closeLabel="Close">
            Snapshot creation is disabled outside production. Use{" "}
            <code>pnpm data-import</code> to download a snapshot locally.
          </Alert>
        </Box>
      )}

      {isProduction && effectiveLastRun && (
        <Box paddingTop={2}>
          <Typography variant="omega" textColor="neutral600">
            Last snapshot: {formatTime(effectiveLastRun)}
            {status?.lastResult?.duration &&
              ` (${formatDuration(status.lastResult.duration)})`}
            {!status?.lastRun && status?.persistedLastRun && " (from S3)"}
          </Typography>
        </Box>
      )}

      {isProduction && effectiveKey && (
        <Box paddingTop={1}>
          <Typography variant="omega" textColor="neutral600">
            Key: {effectiveKey}
          </Typography>
        </Box>
      )}

      {effectiveSize && (
        <Box paddingTop={1}>
          <Typography variant="omega" textColor="neutral600">
            Size: {formatBytes(effectiveSize)}
          </Typography>
        </Box>
      )}

      {!isProduction && localImport && (
        <Box paddingTop={2}>
          {localImport.lastImportedAt ? (
            <>
              <Typography variant="omega" textColor="neutral600">
                Last local import: {formatTime(localImport.lastImportedAt)}
              </Typography>
              {localImport.snapshotKey && (
                <Box paddingTop={1}>
                  <Typography variant="omega" textColor="neutral600">
                    Snapshot: {localImport.snapshotKey}
                  </Typography>
                </Box>
              )}
            </>
          ) : (
            <Typography variant="omega" textColor="neutral600">
              No local import recorded. Run <code>pnpm data-import</code> to
              restore production data.
            </Typography>
          )}
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
          <Alert variant="danger" title="Snapshot failed" closeLabel="Close">
            {error}
          </Alert>
        </Box>
      )}

      <Flex paddingTop={4} gap={2}>
        {isProduction && (
          <Button
            onClick={onTrigger}
            disabled={inProgress || triggering}
            loading={triggering}
            variant="secondary"
          >
            Create Snapshot
          </Button>
        )}
        {isProduction && downloadUrl && !inProgress && (
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
    const [syncRes, snapRes] = await Promise.allSettled([
      get<SyncStatus>("/api/core-sync/status"),
      get<SnapshotStatus>("/api/data-snapshot/admin/status"),
    ])
    if (syncRes.status === "fulfilled") setSyncStatus(syncRes.value.data)
    if (snapRes.status === "fulfilled") setSnapshotStatus(snapRes.value.data)
  }, [get])

  const isProduction = syncStatus?.isProduction ?? snapshotStatus?.isProduction

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
      await post("/api/core-sync/trigger", {})
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
        title="Core Sync Status"
        subtitle={
          isProduction === false
            ? "Development mode — sync and snapshot triggers are disabled"
            : "Core sync and data snapshot operations"
        }
      />
      <Layouts.Content>
        <Grid.Root gap={6}>
          <Grid.Item col={6} xs={12} direction="column" alignItems="stretch">
            <SyncCard
              status={syncStatus}
              onTrigger={triggerSync}
              triggering={syncTriggering}
            />
          </Grid.Item>
          <Grid.Item col={6} xs={12} direction="column" alignItems="stretch">
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

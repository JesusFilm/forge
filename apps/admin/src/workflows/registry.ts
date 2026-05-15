import {
  runVideoDbBackup,
  runVideoDbBackupScheduler,
} from "@/workflows/videoDbBackup"

type WorkflowExport = {
  name: string
  workflowId?: string
}

export function getKnownVideoDbBackupWorkflowIds(): string[] {
  return [runVideoDbBackup, runVideoDbBackupScheduler].map((workflow) => {
    const registered = workflow as WorkflowExport
    return registered.workflowId ?? registered.name
  })
}

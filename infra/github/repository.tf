# Repository: import existing so Terraform adopts current config.
# After import, description/visibility match live repo (from data source) unless you set the vars.
# Import (provider has owner set): terraform import -var="github_token=$GITHUB_TOKEN" github_repository.forge forge

resource "github_repository" "forge" {
  name        = "forge"
  description = "Forge is an AI‑native, agent‑optimised platform for building and distributing content across web and native mobile apps."
  visibility  = "public"
  lifecycle {
    ignore_changes = [
      has_issues,
      has_wiki,
      has_discussions,
      has_projects,
      allow_merge_commit,
      allow_squash_merge,
      allow_rebase_merge,
      allow_auto_merge,
      delete_branch_on_merge,
      archive_on_destroy,
      pages,
      vulnerability_alerts,
      allow_update_branch,
    ]
  }
}

resource "github_branch_default" "forge" {
  repository = github_repository.forge.name
  branch     = "main"
}

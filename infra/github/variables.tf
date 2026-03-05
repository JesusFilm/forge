variable "github_repository" {
  description = "Repository in owner/name form (e.g. JesusFilm/forge)."
  type        = string
  default     = "JesusFilm/forge"
}

variable "github_token" {
  description = "GitHub token with repo admin or sufficient scope (e.g. classic PAT with repo). Use GITHUB_TOKEN or TF_VAR_github_token."
  type        = string
  sensitive   = true
}

# --- Repository settings (optional; import existing repo first) ---
variable "repository_description" {
  description = "Repository description (managed here if set)."
  type        = string
  default     = null
}

variable "repository_default_branch" {
  description = "Default branch name (e.g. main). Managed here if set."
  type        = string
  default     = null
}

variable "repository_visibility" {
  description = "Visibility: public or private. Managed here if set."
  type        = string
  default     = null
}

# --- Actions / deployment ---
variable "aws_region" {
  description = "AWS region for deployments (set as Actions variable)."
  type        = string
  default     = "us-east-2"
}

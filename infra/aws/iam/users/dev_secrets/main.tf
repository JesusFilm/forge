# Generated from recent human contributors, bots excluded.
# Refresh source list with:
#   # GNU/Linux:
#   gh api repos/JesusFilm/forge/commits --paginate -f since="$(date -u -d '-12 months' +%Y-%m-%dT%H:%M:%SZ)" --jq '.[] | select(.author != null and .author.type != "Bot" and (.author.login | test("bot$") | not)) | .author.login' | sort -u
#   # BSD/macOS:
#   gh api repos/JesusFilm/forge/commits --paginate -f since="$(date -u -v-12m +%Y-%m-%dT%H:%M:%SZ)" --jq '.[] | select(.author != null and .author.type != "Bot" and (.author.login | test("bot$") | not)) | .author.login' | sort -u

locals {
  dev_secret_contributors = toset([
    "tataihono",
    "ur-imazing",
    "up-tandem",
    "kneesal",
  ])
}

resource "aws_iam_user" "dev_secrets" {
  for_each = local.dev_secret_contributors

  name          = "${each.value}-dev-secrets"
  path          = "/"
  force_destroy = true
  tags = merge(var.tags, {
    ManagedBy = "terraform"
    Role      = "dev-secrets"
  })
}

resource "aws_iam_user_group_membership" "dev_secrets" {
  for_each = local.dev_secret_contributors

  user = aws_iam_user.dev_secrets[each.value].name

  groups = [
    var.group_name,
  ]
}

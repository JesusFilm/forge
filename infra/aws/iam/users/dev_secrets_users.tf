# Generated from recent human contributors (last 12 months), bots excluded.
# Refresh source list with:
#   git shortlog -sne --since="12 months ago" --all

locals {
  dev_secret_contributors = toset([
    "tataihono",
    "ur-imazing",
    "up-tandem",
    "kneesal",
  ])
}

data "aws_iam_group" "dev_secrets" {
  group_name = "forge-dev-secrets"
}

resource "aws_iam_user" "dev_secrets" {
  for_each = local.dev_secret_contributors

  name = "${each.value}-dev-secrets"
  path = "/"
  tags = merge(var.tags, {
    ManagedBy = "terraform"
    Role      = "dev-secrets"
  })
}

resource "aws_iam_user_group_membership" "dev_secrets" {
  for_each = local.dev_secret_contributors

  user = aws_iam_user.dev_secrets[each.value].name

  groups = [
    data.aws_iam_group.dev_secrets.group_name,
  ]
}

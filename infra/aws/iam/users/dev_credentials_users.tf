# Generated from recent human contributors (last 12 months), bots excluded.
# Refresh source list with:
#   git shortlog -sne --since="12 months ago" --all

locals {
  dev_credential_contributors = toset([
    "tataihono",
    "ur-imazing",
    "up-tandem",
    "kneesal",
  ])
}

data "aws_iam_group" "dev_credentials" {
  group_name = "forge-dev-credentials"
}

resource "aws_iam_user" "dev_credentials" {
  for_each = local.dev_credential_contributors

  name = "${each.value}-dev-credentials"
  path = "/"
  tags = merge(var.tags, {
    ManagedBy = "terraform"
    Role      = "dev-credentials"
  })
}

resource "aws_iam_user_group_membership" "dev_credentials" {
  for_each = local.dev_credential_contributors

  user = aws_iam_user.dev_credentials[each.value].name

  groups = [
    data.aws_iam_group.dev_credentials.group_name,
  ]
}

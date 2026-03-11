# Admin read-only + billing + IAM login profile (set console password for existing users) via group membership.

data "aws_iam_group" "admin_readonly" {
  group_name = "forge-admin-readonly"
}

data "aws_iam_group" "billing" {
  group_name = "forge-billing"
}

data "aws_iam_group" "login_profile" {
  group_name = "forge-iam-login-profile"
}

resource "aws_iam_user" "user" {
  name          = "tataihono.nikora@jesusfilm.org"
  path          = "/"
  force_destroy = true
  tags = merge(var.tags, {
    ManagedBy = "terraform"
    Role      = "admin-readonly-billing"
  })
}

resource "aws_iam_user_group_membership" "admin" {
  user = aws_iam_user.user.name

  groups = [
    data.aws_iam_group.admin_readonly.group_name,
    data.aws_iam_group.billing.group_name,
    data.aws_iam_group.login_profile.group_name,
  ]
}

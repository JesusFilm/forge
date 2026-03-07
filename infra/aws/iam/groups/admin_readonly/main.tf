# Admin read-only group: AWS ReadOnlyAccess.

resource "aws_iam_group" "admin_readonly" {
  name = "forge-admin-readonly"
  path = "/"
}

resource "aws_iam_group_policy_attachment" "admin_readonly" {
  group      = aws_iam_group.admin_readonly.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

resource "aws_iam_group_policy_attachment" "require_mfa" {
  count = var.mfa_policy_arn != null ? 1 : 0

  group      = aws_iam_group.admin_readonly.name
  policy_arn = var.mfa_policy_arn
}

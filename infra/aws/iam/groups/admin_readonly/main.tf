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
  group      = aws_iam_group.admin_readonly.name
  policy_arn = var.mfa_policy_arn
}

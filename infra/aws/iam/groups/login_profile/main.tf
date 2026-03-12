# IAM login profile group: set/reset console password for existing IAM users only.
# User creation and group membership stay in Terraform.

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "login_profile" {
  statement {
    sid    = "LoginProfile"
    effect = "Allow"
    actions = [
      "iam:AdminSetUserPassword",
      "iam:CreateLoginProfile",
      "iam:UpdateLoginProfile",
      "iam:GetLoginProfile",
      "iam:DeleteLoginProfile"
    ]
    resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:user/*"]
  }

  statement {
    sid    = "ListUsers"
    effect = "Allow"
    actions = [
      "iam:ListUsers",
      "iam:GetUser"
    ]
    resources = ["*"]
  }
}

resource "aws_iam_group" "login_profile" {
  name = "forge-iam-login-profile"
  path = "/"
}

resource "aws_iam_group_policy" "login_profile" {
  name   = "forge-iam-login-profile"
  group  = aws_iam_group.login_profile.name
  policy = data.aws_iam_policy_document.login_profile.json
}

resource "aws_iam_group_policy_attachment" "require_mfa" {
  group      = aws_iam_group.login_profile.name
  policy_arn = var.mfa_policy_arn
}

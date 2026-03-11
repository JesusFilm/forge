# Require MFA for all actions except MFA setup and minimal self-service (so users can enroll on first sign-in).

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "require_mfa" {
  # Deny all when MFA not present (BoolIfExists so long-term keys are also denied).
  statement {
    sid       = "DenyAllUnlessMFAPresent"
    effect    = "Deny"
    actions   = ["*"]
    resources = ["*"]

    condition {
      test     = "BoolIfExists"
      variable = "aws:MultiFactorAuthPresent"
      values   = ["false"]
    }
  }

  # Allow MFA setup and self-service without MFA so user can enroll on first sign-in.
  statement {
    sid    = "AllowMFASetupAndSelfService"
    effect = "Allow"
    actions = [
      "iam:CreateVirtualMFADevice",
      "iam:DeleteVirtualMFADevice",
      "iam:EnableMFADevice",
      "iam:ListMFADevices",
      "iam:ListVirtualMFADevices",
      "iam:ResyncMFADevice",
      "iam:GetUser",
      "iam:GetAccountPasswordPolicy",
      "iam:ChangePassword"
    ]
    resources = [
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:user/$${aws:username}",
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:mfa/$${aws:username}",
      "*"
    ]
  }
}

resource "aws_iam_policy" "require_mfa" {
  name        = "forge-require-mfa"
  path        = "/"
  description = "Requires MFA for all actions; allows MFA setup and self-service so users can enroll on first sign-in."
  policy      = data.aws_iam_policy_document.require_mfa.json
  tags = merge(var.tags, {
    ManagedBy = "terraform"
  })
}

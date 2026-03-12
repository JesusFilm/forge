# Require MFA for all actions except MFA setup and minimal self-service (so users can enroll on first sign-in).

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "require_mfa" {
  # Deny when MFA not present on console sessions. Both conditions must be true
  # (AND): Bool only matches when aws:MultiFactorAuthPresent exists and equals
  # "false" (access-key requests omit the key entirely). BoolIfExists on
  # aws:ViaAWSService treats an absent key as matching, so direct calls are
  # denied while cross-service calls (e.g. SSM → KMS Decrypt) pass through.
  statement {
    sid    = "DenyAllUnlessMFAPresent"
    effect = "Deny"
    not_actions = [
      "iam:CreateVirtualMFADevice",
      "iam:DeleteVirtualMFADevice",
      "iam:EnableMFADevice",
      "iam:ListMFADevices",
      "iam:ListVirtualMFADevices",
      "iam:ResyncMFADevice",
      "iam:GetUser",
      "iam:GetAccountPasswordPolicy",
      "iam:ChangePassword",
    ]
    resources = ["*"]

    condition {
      test     = "Bool"
      variable = "aws:MultiFactorAuthPresent"
      values   = ["false"]
    }

    condition {
      test     = "BoolIfExists"
      variable = "aws:ViaAWSService"
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
  description = "Requires MFA for console sessions; allows access-key programmatic access and MFA self-service."
  policy      = data.aws_iam_policy_document.require_mfa.json
  tags = merge(var.tags, {
    ManagedBy = "terraform"
  })
}

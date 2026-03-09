# Dev secrets group: users can self-manage access keys and read dev SSM params.

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "dev_secrets" {
  statement {
    sid    = "DescribeSsmParameters"
    effect = "Allow"
    actions = [
      "ssm:DescribeParameters",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "ReadDevSsmParameters"
    effect = "Allow"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParametersByPath"
    ]
    resources = [
      "arn:aws:ssm:*:${data.aws_caller_identity.current.account_id}:parameter/forge/aws/cms/dev/*"
    ]
  }

  statement {
    sid    = "DecryptStageCmsSsm"
    effect = "Allow"
    actions = [
      "kms:Decrypt"
    ]
    resources = ["*"]

    condition {
      test     = "StringLike"
      variable = "kms:ResourceAliases"
      values   = ["alias/forge-cms-dev-ssm"]
    }
  }

  statement {
    sid    = "ManageOwnAccessKeys"
    effect = "Allow"
    actions = [
      "iam:CreateAccessKey",
      "iam:DeleteAccessKey",
      "iam:GetUser",
      "iam:ListAccessKeys",
      "iam:UpdateAccessKey"
    ]
    resources = [
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:user/&{aws:username}"
    ]
  }

  statement {
    sid    = "WhoAmI"
    effect = "Allow"
    actions = [
      "sts:GetCallerIdentity"
    ]
    resources = ["*"]
  }
}

resource "aws_iam_group" "dev_secrets" {
  name = "forge-dev-secrets"
  path = "/"
}

resource "aws_iam_group_policy" "dev_secrets" {
  name   = "forge-dev-secrets"
  group  = aws_iam_group.dev_secrets.name
  policy = data.aws_iam_policy_document.dev_secrets.json
}

resource "aws_iam_group_policy_attachment" "require_mfa" {
  group      = aws_iam_group.dev_secrets.name
  policy_arn = var.mfa_policy_arn
}

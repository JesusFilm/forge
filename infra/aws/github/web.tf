data "aws_kms_alias" "vercel_ssm_for_web" {
  name = "alias/forge-vercel-prod-ssm"
}

data "aws_kms_key" "vercel_ssm_for_web" {
  key_id = data.aws_kms_alias.vercel_ssm_for_web.target_key_arn
}

data "aws_iam_policy_document" "github_actions_web_deploy_assume_role" {
  statement {
    sid     = "AllowGitHubActionsWebDeployAssumeRole"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_actions.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = concat(
        [
          "repo:JesusFilm/forge:ref:refs/heads/${local.branch_name}",
          "repo:JesusFilm/forge:environment:web-${var.environment}",
        ],
        var.environment == "stage" ? ["repo:JesusFilm/forge:environment:web-preview"] : [],
      )
    }
  }
}

resource "aws_iam_role" "github_actions_web_deploy" {
  name               = "forge-github-actions-web-deploy-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.github_actions_web_deploy_assume_role.json
  tags = merge(var.tags, {
    Environment = var.environment
    ManagedBy   = "terraform"
    Service     = "github-actions"
  })
}

data "aws_iam_policy_document" "github_actions_web_deploy" {
  statement {
    sid    = "SsmReadVercelToken"
    effect = "Allow"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters"
    ]
    resources = [
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/forge/vercel/api_token"
    ]
  }

  statement {
    sid     = "KmsDecryptVercelToken"
    effect  = "Allow"
    actions = ["kms:Decrypt"]
    resources = [
      data.aws_kms_key.vercel_ssm_for_web.arn
    ]
  }
}

resource "aws_iam_role_policy" "github_actions_web_deploy" {
  name   = "web-deploy"
  role   = aws_iam_role.github_actions_web_deploy.id
  policy = data.aws_iam_policy_document.github_actions_web_deploy.json
}

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "github_actions_assume_role" {
  for_each = local.github_actions_deploy_targets

  statement {
    sid     = "AllowGitHubActionsAssumeRole"
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
      values   = ["repo:JesusFilm/forge:ref:refs/heads/${each.value}"]
    }
  }
}

resource "aws_iam_role" "github_actions_cms_deploy" {
  for_each = local.github_actions_deploy_targets

  name               = "forge-github-actions-cms-deploy-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.github_actions_assume_role[each.key].json
  tags = merge(var.tags, {
    Environment = each.key
    ManagedBy   = "terraform"
    Service     = "github-actions"
  })
}

data "aws_iam_policy_document" "github_actions_cms_deploy" {
  for_each = local.github_actions_deploy_targets

  statement {
    sid    = "EcrAuth"
    effect = "Allow"
    actions = [
      "ecr:GetAuthorizationToken"
    ]
    resources = ["*"]
  }

  statement {
    sid    = "EcrRepoManage"
    effect = "Allow"
    actions = [
      "ecr:CreateRepository",
      "ecr:DescribeRepositories"
    ]
    resources = ["*"]
  }

  statement {
    sid    = "EcrPushPull"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart"
    ]
    resources = [
      "arn:aws:ecr:${var.aws_region}:${data.aws_caller_identity.current.account_id}:repository/forge-cms"
    ]
  }

  statement {
    sid    = "EcsDeploy"
    effect = "Allow"
    actions = [
      "ecs:DescribeServices",
      "ecs:DescribeTaskDefinition",
      "ecs:RegisterTaskDefinition",
      "ecs:UpdateService",
      "ecs:TagResource"
    ]
    resources = [
      "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:cluster/forge-cms-${each.key}",
      "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:service/forge-cms-${each.key}/forge-cms-${each.key}-service",
      "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:task-definition/forge-cms-${each.key}-task*"
    ]
  }

  statement {
    sid    = "IamPassRolesForEcsTasks"
    effect = "Allow"
    actions = [
      "iam:PassRole"
    ]
    resources = [
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/forge-cms-${each.key}-execution-role",
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/forge-cms-${each.key}-task-role"
    ]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "github_actions_cms_deploy" {
  for_each = local.github_actions_deploy_targets

  name   = "cms-deploy"
  role   = aws_iam_role.github_actions_cms_deploy[each.key].id
  policy = data.aws_iam_policy_document.github_actions_cms_deploy[each.key].json
}

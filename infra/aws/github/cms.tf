data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "github_actions_assume_role" {
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
      values = [
        "repo:JesusFilm/forge:ref:refs/heads/${local.branch_name}",
        "repo:JesusFilm/forge:environment:cms-${var.environment}"
      ]
    }
  }
}

resource "aws_iam_role" "github_actions_cms_deploy" {
  name               = "forge-github-actions-cms-deploy-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.github_actions_assume_role.json
  tags = merge(var.tags, {
    Environment = var.environment
    ManagedBy   = "terraform"
    Service     = "github-actions"
  })
}

data "aws_iam_policy_document" "github_actions_cms_deploy" {
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
      "ecr:DescribeRepositories"
    ]
    resources = [
      "arn:aws:ecr:${var.aws_region}:${data.aws_caller_identity.current.account_id}:repository/forge-cms-${var.environment}"
    ]
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
      "arn:aws:ecr:${var.aws_region}:${data.aws_caller_identity.current.account_id}:repository/forge-cms-${var.environment}"
    ]
  }

  statement {
    sid    = "EcsDescribeTaskDefinitions"
    effect = "Allow"
    actions = [
      "ecs:DescribeTaskDefinition"
    ]
    resources = ["*"]
  }

  statement {
    sid    = "EcsDeploy"
    effect = "Allow"
    actions = [
      "ecs:DescribeServices",
      "ecs:RegisterTaskDefinition",
      "ecs:UpdateService",
      "ecs:TagResource"
    ]
    resources = [
      "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:cluster/forge-cms-${var.environment}",
      "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:service/forge-cms-${var.environment}/forge-cms-${var.environment}-service",
      "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:task-definition/forge-cms-${var.environment}-task*"
    ]
  }

  statement {
    sid       = "EcsListTasks"
    effect    = "Allow"
    actions   = ["ecs:ListTasks"]
    resources = ["*"]
  }

  statement {
    sid     = "EcsDescribeStoppedTasks"
    effect  = "Allow"
    actions = ["ecs:DescribeTasks"]
    resources = [
      "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:task/forge-cms-${var.environment}/*"
    ]
  }

  statement {
    sid     = "CloudWatchLogsReadTaskLogs"
    effect  = "Allow"
    actions = ["logs:GetLogEvents"]
    resources = [
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/ecs/forge-cms-${var.environment}:*"
    ]
  }

  statement {
    sid    = "IamPassRolesForEcsTasks"
    effect = "Allow"
    actions = [
      "iam:PassRole"
    ]
    resources = [
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/forge-cms-${var.environment}-execution-role",
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/forge-cms-${var.environment}-task-role"
    ]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "github_actions_cms_deploy" {
  name   = "cms-deploy"
  role   = aws_iam_role.github_actions_cms_deploy.id
  policy = data.aws_iam_policy_document.github_actions_cms_deploy.json
}

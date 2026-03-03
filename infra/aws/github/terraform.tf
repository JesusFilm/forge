data "aws_iam_policy_document" "github_actions_terraform_apply_assume_role" {
  for_each = local.github_actions_deploy_targets

  statement {
    sid     = "AllowGitHubActionsTerraformApplyAssumeRole"
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

data "aws_iam_policy_document" "github_actions_terraform_plan_assume_role" {
  for_each = local.github_actions_deploy_targets

  statement {
    sid     = "AllowGitHubActionsTerraformPlanAssumeRole"
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
      values   = ["repo:JesusFilm/forge:pull_request"]
    }
  }
}

resource "aws_iam_role" "github_actions_terraform_apply" {
  for_each = local.github_actions_deploy_targets

  name               = "forge-github-actions-terraform-apply-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.github_actions_terraform_apply_assume_role[each.key].json
  tags = merge(var.tags, {
    Environment = each.key
    ManagedBy   = "terraform"
    Service     = "github-actions"
  })
}

resource "aws_iam_role" "github_actions_terraform_plan" {
  for_each = local.github_actions_deploy_targets

  name               = "forge-github-actions-terraform-plan-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.github_actions_terraform_plan_assume_role[each.key].json
  tags = merge(var.tags, {
    Environment = each.key
    ManagedBy   = "terraform"
    Service     = "github-actions"
  })
}

resource "aws_iam_role_policy_attachment" "github_actions_terraform_apply_admin" {
  for_each = local.github_actions_deploy_targets

  role       = aws_iam_role.github_actions_terraform_apply[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

resource "aws_iam_role_policy_attachment" "github_actions_terraform_plan_readonly" {
  for_each = local.github_actions_deploy_targets

  role       = aws_iam_role.github_actions_terraform_plan[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

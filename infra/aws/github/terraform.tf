# ------------------------------------------------------------------------------
# Terraform apply (infra/aws) — full AWS access per environment (stage/prod).
# ------------------------------------------------------------------------------

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
      values = [
        "repo:JesusFilm/forge:ref:refs/heads/${each.value}",
        "repo:JesusFilm/forge:environment:aws-${each.key}"
      ]
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

data "aws_iam_policy_document" "github_actions_terraform_apply" {
  statement {
    sid    = "TerraformAwsServiceManagement"
    effect = "Allow"
    actions = [
      "acm:*",
      "cloudfront:*",
      "cloudwatch:*",
      "dynamodb:*",
      "ec2:*",
      "ecr:*",
      "ecs:*",
      "elasticloadbalancing:*",
      "kms:*",
      "logs:*",
      "rds:*",
      "secretsmanager:*",
      "route53:*",
      "s3:*",
      "wafv2:*"
    ]
    resources = ["*"]
  }

  statement {
    sid    = "TerraformIamForForgeResources"
    effect = "Allow"
    actions = [
      "iam:AttachRolePolicy",
      "iam:CreateOpenIDConnectProvider",
      "iam:CreatePolicy",
      "iam:CreatePolicyVersion",
      "iam:CreateRole",
      "iam:DeleteOpenIDConnectProvider",
      "iam:DeletePolicy",
      "iam:DeletePolicyVersion",
      "iam:DeleteRole",
      "iam:DeleteRolePolicy",
      "iam:DetachRolePolicy",
      "iam:GetOpenIDConnectProvider",
      "iam:GetPolicy",
      "iam:GetPolicyVersion",
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:ListOpenIDConnectProviderTags",
      "iam:ListOpenIDConnectProviders",
      "iam:ListPolicies",
      "iam:ListPolicyVersions",
      "iam:ListRolePolicies",
      "iam:ListRoleTags",
      "iam:ListRoles",
      "iam:PassRole",
      "iam:PutRolePolicy",
      "iam:RemoveClientIDFromOpenIDConnectProvider",
      "iam:SetDefaultPolicyVersion",
      "iam:TagOpenIDConnectProvider",
      "iam:TagPolicy",
      "iam:TagRole",
      "iam:UntagOpenIDConnectProvider",
      "iam:UntagPolicy",
      "iam:UntagRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:UpdateOpenIDConnectProviderThumbprint"
    ]
    resources = [
      "arn:aws:iam::*:oidc-provider/token.actions.githubusercontent.com",
      "arn:aws:iam::*:policy/forge-*",
      "arn:aws:iam::*:role/forge-*"
    ]
  }

  statement {
    sid    = "AllowCreateServiceLinkedRoles"
    effect = "Allow"
    actions = [
      "iam:CreateServiceLinkedRole"
    ]
    resources = [
      "arn:aws:iam::*:role/aws-service-role/*"
    ]
  }

  statement {
    sid    = "DenyIamUserAndGroupMutation"
    effect = "Deny"
    actions = [
      "iam:AddUserToGroup",
      "iam:AttachGroupPolicy",
      "iam:AttachUserPolicy",
      "iam:CreateAccessKey",
      "iam:CreateGroup",
      "iam:CreateLoginProfile",
      "iam:CreateUser",
      "iam:DeleteAccessKey",
      "iam:DeleteGroup",
      "iam:DeleteGroupPolicy",
      "iam:DeleteLoginProfile",
      "iam:DeleteUser",
      "iam:DeleteUserPolicy",
      "iam:DetachGroupPolicy",
      "iam:DetachUserPolicy",
      "iam:PutGroupPolicy",
      "iam:PutUserPolicy",
      "iam:RemoveUserFromGroup",
      "iam:UpdateLoginProfile"
    ]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "github_actions_terraform_apply" {
  name   = "forge-github-actions-terraform-apply"
  policy = data.aws_iam_policy_document.github_actions_terraform_apply.json
}

resource "aws_iam_role_policy_attachment" "github_actions_terraform_apply" {
  for_each = local.github_actions_deploy_targets

  role       = aws_iam_role.github_actions_terraform_apply[each.key].name
  policy_arn = aws_iam_policy.github_actions_terraform_apply.arn
}

# ------------------------------------------------------------------------------
# Terraform plan (PRs) — read-only AWS per environment.
# ------------------------------------------------------------------------------

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

resource "aws_iam_role_policy_attachment" "github_actions_terraform_plan_readonly" {
  for_each = local.github_actions_deploy_targets

  role       = aws_iam_role.github_actions_terraform_plan[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

# ------------------------------------------------------------------------------
# State-only role for Terraform apply — cannot make changes to AWS.
# Read/write S3 state + DynamoDB lock + KMS only.
# Bucket and table names from bootstrap state (passed in).
# ------------------------------------------------------------------------------

data "aws_kms_alias" "terraform_state" {
  name = "alias/forge-terraform-state"
}

data "aws_kms_key" "terraform_state" {
  key_id = data.aws_kms_alias.terraform_state.target_key_arn
}

data "aws_iam_policy_document" "github_actions_terraform_state_assume" {
  statement {
    sid     = "AllowGitHubActionsTerraformStateAssumeRole"
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
        "repo:JesusFilm/forge:ref:refs/heads/main",
        "repo:JesusFilm/forge:environment:github-prod",
        "repo:JesusFilm/forge:environment:vercel-prod"
      ]
    }
  }
}

data "aws_iam_policy_document" "github_actions_terraform_state" {
  statement {
    sid    = "StateBucketAccess"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:ListBucket"
    ]
    resources = [
      "arn:aws:s3:::${var.terraform_state_bucket_name}",
      "arn:aws:s3:::${var.terraform_state_bucket_name}/*"
    ]
  }

  statement {
    sid    = "StateLockTableAccess"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:BatchGetItem",
      "dynamodb:BatchWriteItem",
      "dynamodb:ConditionCheckItem",
      "dynamodb:DescribeTable"
    ]
    resources = [
      "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${var.terraform_state_lock_table_name}"
    ]
  }

  statement {
    sid    = "StateKmsAccess"
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:GenerateDataKey"
    ]
    resources = [data.aws_kms_key.terraform_state.arn]
  }
}

resource "aws_iam_role" "github_actions_terraform_state" {
  name               = "forge-github-actions-terraform-state"
  assume_role_policy = data.aws_iam_policy_document.github_actions_terraform_state_assume.json
  tags = merge(var.tags, {
    ManagedBy = "terraform"
    Service   = "github-actions"
  })
}

resource "aws_iam_role_policy" "github_actions_terraform_state" {
  name   = "terraform-state-only"
  role   = aws_iam_role.github_actions_terraform_state.id
  policy = data.aws_iam_policy_document.github_actions_terraform_state.json
}

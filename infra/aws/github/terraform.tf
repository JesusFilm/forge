# ------------------------------------------------------------------------------
# Terraform apply (infra/aws) — full AWS access per environment (stage/prod).
# Policy and state role are account-level: prod creates them, stage uses existing.
# ------------------------------------------------------------------------------

locals {
  create_shared_github_resources = var.environment == "prod"
}

data "aws_iam_policy_document" "github_actions_terraform_apply_assume_role" {
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
        "repo:JesusFilm/forge:ref:refs/heads/${local.branch_name}",
        "repo:JesusFilm/forge:environment:aws-${var.environment}"
      ]
    }
  }
}

resource "aws_iam_role" "github_actions_terraform_apply" {
  name               = "forge-github-actions-terraform-apply-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.github_actions_terraform_apply_assume_role.json
  tags = merge(var.tags, {
    Environment = var.environment
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
      "route53:*",
      "s3:*",
      "ssm:*",
      "wafv2:*"
    ]
    resources = ["*"]
  }

  # List/GetPolicy need resource * (no resource-level support). Scope limited to list/get only.
  statement {
    sid    = "TerraformIamListPolicies"
    effect = "Allow"
    actions = [
      "iam:GetPolicy",
      "iam:ListPolicies"
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
      "iam:GetPolicyVersion",
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:ListOpenIDConnectProviderTags",
      "iam:ListOpenIDConnectProviders",
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
  count  = local.create_shared_github_resources ? 1 : 0
  name   = "forge-github-actions-terraform-apply"
  policy = data.aws_iam_policy_document.github_actions_terraform_apply.json
}

data "aws_iam_policy" "github_actions_terraform_apply" {
  count = local.create_shared_github_resources ? 0 : 1
  name  = "forge-github-actions-terraform-apply"
}

locals {
  terraform_apply_policy_arn = local.create_shared_github_resources ? aws_iam_policy.github_actions_terraform_apply[0].arn : data.aws_iam_policy.github_actions_terraform_apply[0].arn
}

resource "aws_iam_role_policy_attachment" "github_actions_terraform_apply" {
  role       = aws_iam_role.github_actions_terraform_apply.name
  policy_arn = local.terraform_apply_policy_arn
}

# ------------------------------------------------------------------------------
# Terraform plan (PRs) — read-only AWS per environment.
# ------------------------------------------------------------------------------

data "aws_iam_policy_document" "github_actions_terraform_plan_assume_role" {
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
      values   = ["repo:JesusFilm/forge:environment:aws-plan-${var.environment}"]
    }
  }
}

resource "aws_iam_role" "github_actions_terraform_plan" {
  name               = "forge-github-actions-terraform-plan-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.github_actions_terraform_plan_assume_role.json
  tags = merge(var.tags, {
    Environment = var.environment
    ManagedBy   = "terraform"
    Service     = "github-actions"
  })
}

resource "aws_iam_role_policy_attachment" "github_actions_terraform_plan_readonly" {
  role       = aws_iam_role.github_actions_terraform_plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

data "aws_iam_policy_document" "github_actions_terraform_plan_ssm_kms" {
  statement {
    sid    = "ReadPlanSecureStrings"
    effect = "Allow"
    actions = [
      "kms:Decrypt"
    ]
    resources = compact([
      var.cms_ssm_kms_key_arn,
      var.vercel_ssm_kms_key_arn,
      try(aws_kms_key.github_ssm[0].arn, null),
    ])
  }
}

resource "aws_iam_role_policy" "github_actions_terraform_plan_ssm_kms" {
  name   = "terraform-plan-ssm-kms"
  role   = aws_iam_role.github_actions_terraform_plan.id
  policy = data.aws_iam_policy_document.github_actions_terraform_plan_ssm_kms.json
}

# ------------------------------------------------------------------------------
# Stack roles for infra/vercel and infra/github.
# Limited to Terraform state plus stack-specific SSM parameters.
# ------------------------------------------------------------------------------

data "aws_kms_alias" "terraform_state" {
  name = "alias/forge-terraform-state"
}

data "aws_kms_key" "terraform_state" {
  key_id = data.aws_kms_alias.terraform_state.target_key_arn
}

data "aws_kms_alias" "cms_ssm_stage" {
  count = local.create_shared_github_resources ? 1 : 0
  name  = "alias/forge-cms-stage-ssm"
}

data "aws_kms_key" "cms_ssm_stage" {
  count  = local.create_shared_github_resources ? 1 : 0
  key_id = data.aws_kms_alias.cms_ssm_stage[0].target_key_arn
}

data "aws_kms_alias" "cms_ssm_prod" {
  count = local.create_shared_github_resources ? 1 : 0
  name  = "alias/forge-cms-prod-ssm"
}

data "aws_kms_key" "cms_ssm_prod" {
  count  = local.create_shared_github_resources ? 1 : 0
  key_id = data.aws_kms_alias.cms_ssm_prod[0].target_key_arn
}

locals {
  terraform_stack_roles = local.create_shared_github_resources ? {
    vercel_plan = {
      github_environment = "vercel-plan"
      role_name          = "forge-github-actions-terraform-vercel-plan"
      state_key          = "infra/vercel/terraform.tfstate"
      state_bucket_object_actions = [
        "s3:GetObject",
      ]
      state_bucket_list_actions = [
        "s3:ListBucket"
      ]
      state_lock_actions = [
        "dynamodb:DescribeTable",
        "dynamodb:GetItem"
      ]
      kms_actions = [
        "kms:Decrypt"
      ]
      ssm_parameter_arns = [
        "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/forge/vercel/api_token",
        "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/forge/aws/cms/stage/STRAPI_INTERNAL_API_TOKEN",
        "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/forge/aws/cms/prod/STRAPI_INTERNAL_API_TOKEN",
      ]
      ssm_kms_key_arns = [
        var.vercel_ssm_kms_key_arn,
        data.aws_kms_key.cms_ssm_stage[0].arn,
        data.aws_kms_key.cms_ssm_prod[0].arn,
      ]
    }
    vercel_apply = {
      github_environment = "vercel-prod"
      role_name          = "forge-github-actions-terraform-vercel-apply"
      state_key          = "infra/vercel/terraform.tfstate"
      state_bucket_object_actions = [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
      ]
      state_bucket_list_actions = [
        "s3:ListBucket"
      ]
      state_lock_actions = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:DeleteItem",
        "dynamodb:BatchGetItem",
        "dynamodb:BatchWriteItem",
        "dynamodb:ConditionCheckItem",
        "dynamodb:DescribeTable"
      ]
      kms_actions = [
        "kms:Decrypt",
        "kms:GenerateDataKey"
      ]
      ssm_parameter_arns = [
        "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/forge/vercel/api_token",
        "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/forge/aws/cms/stage/STRAPI_INTERNAL_API_TOKEN",
        "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/forge/aws/cms/prod/STRAPI_INTERNAL_API_TOKEN",
      ]
      ssm_kms_key_arns = [
        var.vercel_ssm_kms_key_arn,
        data.aws_kms_key.cms_ssm_stage[0].arn,
        data.aws_kms_key.cms_ssm_prod[0].arn,
      ]
    }
    github_plan = {
      github_environment = "github-plan"
      role_name          = "forge-github-actions-terraform-github-plan"
      state_key          = "infra/github/terraform.tfstate"
      state_bucket_object_actions = [
        "s3:GetObject",
      ]
      state_bucket_list_actions = [
        "s3:ListBucket"
      ]
      state_lock_actions = [
        "dynamodb:DescribeTable",
        "dynamodb:GetItem"
      ]
      kms_actions = [
        "kms:Decrypt"
      ]
      ssm_parameter_arns = [
        "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/forge/github/*",
        "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/forge/aws/cms/stage/STRAPI_INTERNAL_API_TOKEN",
      ]
      ssm_kms_key_arns = [
        aws_kms_key.github_ssm[0].arn,
        data.aws_kms_key.cms_ssm_stage[0].arn,
      ]
    }
    github_apply = {
      github_environment = "github-prod"
      role_name          = "forge-github-actions-terraform-github-apply"
      state_key          = "infra/github/terraform.tfstate"
      state_bucket_object_actions = [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
      ]
      state_bucket_list_actions = [
        "s3:ListBucket"
      ]
      state_lock_actions = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:DeleteItem",
        "dynamodb:BatchGetItem",
        "dynamodb:BatchWriteItem",
        "dynamodb:ConditionCheckItem",
        "dynamodb:DescribeTable"
      ]
      kms_actions = [
        "kms:Decrypt",
        "kms:GenerateDataKey"
      ]
      ssm_parameter_arns = [
        "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/forge/github/*",
        "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/forge/aws/cms/stage/STRAPI_INTERNAL_API_TOKEN",
      ]
      ssm_kms_key_arns = [
        aws_kms_key.github_ssm[0].arn,
        data.aws_kms_key.cms_ssm_stage[0].arn,
      ]
    }
  } : {}
}

data "aws_iam_policy_document" "github_actions_terraform_stack_assume" {
  for_each = local.terraform_stack_roles

  statement {
    sid     = "AllowGitHubActionsTerraform${replace(title(each.key), "_", "")}AssumeRole"
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
      values   = ["repo:JesusFilm/forge:environment:${each.value.github_environment}"]
    }
  }
}

data "aws_iam_policy_document" "github_actions_terraform_stack" {
  for_each = local.terraform_stack_roles

  statement {
    sid     = "StateBucketObjectAccess"
    effect  = "Allow"
    actions = each.value.state_bucket_object_actions
    resources = [
      "arn:aws:s3:::${var.terraform_state_bucket_name}/${each.value.state_key}"
    ]
  }

  statement {
    sid     = "StateBucketListAccess"
    effect  = "Allow"
    actions = each.value.state_bucket_list_actions
    resources = [
      "arn:aws:s3:::${var.terraform_state_bucket_name}"
    ]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values = [
        each.value.state_key,
        "${dirname(each.value.state_key)}/"
      ]
    }
  }

  statement {
    sid     = "StateLockTableAccess"
    effect  = "Allow"
    actions = each.value.state_lock_actions
    resources = [
      "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${var.terraform_state_lock_table_name}"
    ]

    condition {
      test     = "ForAllValues:StringLike"
      variable = "dynamodb:LeadingKeys"
      values = [
        "${var.terraform_state_bucket_name}/${each.value.state_key}*"
      ]
    }
  }

  statement {
    sid       = "StateKmsAccess"
    effect    = "Allow"
    actions   = each.value.kms_actions
    resources = [data.aws_kms_key.terraform_state.arn]
  }

  statement {
    sid    = "ScopedSsmParameterRead"
    effect = "Allow"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters"
    ]
    resources = each.value.ssm_parameter_arns
  }

  statement {
    sid    = "ScopedSsmParameterDecrypt"
    effect = "Allow"
    actions = [
      "kms:Decrypt"
    ]
    resources = each.value.ssm_kms_key_arns
  }
}

resource "aws_iam_role" "github_actions_terraform_stack" {
  for_each           = local.terraform_stack_roles
  name               = each.value.role_name
  assume_role_policy = data.aws_iam_policy_document.github_actions_terraform_stack_assume[each.key].json
  tags = merge(var.tags, {
    ManagedBy = "terraform"
    Service   = "github-actions"
  })
}

resource "aws_iam_role_policy" "github_actions_terraform_stack" {
  for_each = local.terraform_stack_roles
  name     = "terraform-${each.key}-access"
  role     = aws_iam_role.github_actions_terraform_stack[each.key].id
  policy   = data.aws_iam_policy_document.github_actions_terraform_stack[each.key].json
}

locals {
  terraform_vercel_plan_role_arn  = local.create_shared_github_resources ? aws_iam_role.github_actions_terraform_stack["vercel_plan"].arn : null
  terraform_vercel_apply_role_arn = local.create_shared_github_resources ? aws_iam_role.github_actions_terraform_stack["vercel_apply"].arn : null
  terraform_github_plan_role_arn  = local.create_shared_github_resources ? aws_iam_role.github_actions_terraform_stack["github_plan"].arn : null
  terraform_github_apply_role_arn = local.create_shared_github_resources ? aws_iam_role.github_actions_terraform_stack["github_apply"].arn : null
}

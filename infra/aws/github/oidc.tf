locals {
  env_to_branch = {
    prod  = "main"
    stage = "stage"
  }
  branch_name = local.env_to_branch[var.environment]
}

resource "aws_iam_openid_connect_provider" "github_actions" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

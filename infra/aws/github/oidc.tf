locals {
  github_actions_deploy_branches = {
    stage = "stage"
    prod  = "main"
  }

  github_actions_deploy_targets = {
    for env, branch in local.github_actions_deploy_branches : env => branch
    if contains(tolist(var.target_environments), env)
  }
}

resource "aws_iam_openid_connect_provider" "github_actions" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

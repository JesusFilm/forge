# Billing group: members can manage Billing and Cost Management (payment methods, contacts).
# Root must enable IAM access: https://console.aws.amazon.com/billing/home#/account

data "aws_iam_policy_document" "billing" {
  statement {
    sid    = "BillingConsoleView"
    effect = "Allow"
    actions = [
      "aws-portal:ViewAccount",
      "aws-portal:ViewBilling",
      "aws-portal:ViewPaymentMethods",
      "aws-portal:ViewUsage"
    ]
    resources = ["*"]
  }

  statement {
    sid    = "BillingConsoleModify"
    effect = "Allow"
    actions = [
      "aws-portal:ModifyAccount",
      "aws-portal:ModifyBilling",
      "aws-portal:ModifyPaymentMethods"
    ]
    resources = ["*"]
  }
}

resource "aws_iam_group" "billing" {
  name = "forge-billing"
  path = "/"
}

resource "aws_iam_group_policy" "billing" {
  name   = "forge-billing"
  group  = aws_iam_group.billing.name
  policy = data.aws_iam_policy_document.billing.json
}

resource "aws_iam_group_policy_attachment" "require_mfa" {
  count = var.mfa_policy_arn != null ? 1 : 0

  group      = aws_iam_group.billing.name
  policy_arn = var.mfa_policy_arn
}

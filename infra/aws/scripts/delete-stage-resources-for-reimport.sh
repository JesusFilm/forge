#!/usr/bin/env bash
# Deletes stage resources that already exist in AWS so stage apply can recreate them.
# Run from infra/aws. Requires AWS CLI and permissions to delete these resources.
# WARNING: This will break the stage environment until you run: terraform apply -var="environment=stage"

set -e
REGION=us-east-2
REGION_CF=us-east-1  # CloudFront is global but OAC is in us-east-1 for us-east-1 distributions

echo "=== Emptying and deleting S3 buckets ==="
for bucket in forge-cms-stage-assets-access-logs forge-platform-stage-alb-logs forge-cms-stage-assets; do
  if aws s3api head-bucket --bucket "$bucket" 2>/dev/null; then
    echo "Emptying $bucket..."
    aws s3 rm "s3://$bucket" --recursive 2>/dev/null || true
    # Remove any versioned objects
    aws s3api list-object-versions --bucket "$bucket" --output json --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' 2>/dev/null | jq -r '.Objects[]? | "\(.Key) \(.VersionId)"' | while read -r key vid; do
      [ -z "$key" ] || aws s3api delete-object --bucket "$bucket" --key "$key" --version-id "$vid" 2>/dev/null || true
    done
    echo "Deleting $bucket..."
    aws s3 rb "s3://$bucket" --force 2>/dev/null || echo "  (skip or manual)"
  fi
done

echo "=== Deleting CloudWatch log groups ==="
for lg in "/ecs/forge-cms-stage" "/aws-waf-logs-forge-platform-stage"; do
  aws logs delete-log-group --log-group-name "$lg" --region "$REGION" 2>/dev/null || echo "  $lg not found or already deleted"
done

echo "=== Detaching and deleting IAM roles (stage CMS) ==="
for role in forge-cms-stage-execution-role forge-cms-stage-task-role; do
  for policy in $(aws iam list-attached-role-policies --role-name "$role" --query 'AttachedPolicies[].PolicyArn' --output text 2>/dev/null); do
    aws iam detach-role-policy --role-name "$role" --policy-arn "$policy" 2>/dev/null || true
  done
  for policy in $(aws iam list-role-policies --role-name "$role" --query 'PolicyNames[]' --output text 2>/dev/null); do
    aws iam delete-role-policy --role-name "$role" --policy-name "$policy" 2>/dev/null || true
  done
  aws iam delete-role --role-name "$role" 2>/dev/null || echo "  $role not found or already deleted"
done

echo "=== CloudFront OAC (forge-cms-stage-oac) ==="
OAC_ID=$(aws cloudfront list-origin-access-controls --query "OriginAccessControlList.Items[?OriginAccessControlConfig.Name=='forge-cms-stage-oac'].Id" --output text 2>/dev/null)
if [ -n "$OAC_ID" ]; then
  echo "  Delete any distribution using this OAC first, then:"
  echo "  aws cloudfront delete-origin-access-control --id $OAC_ID"
else
  echo "  OAC not found or already deleted"
fi

echo "=== WAFv2 Web ACL (forge-platform-stage-waf) ==="
WAF_ARN=$(aws wafv2 list-web-acls --scope REGIONAL --region "$REGION" --query "WebACLs[?Name=='forge-platform-stage-waf'].ARN" --output text 2>/dev/null)
if [ -n "$WAF_ARN" ]; then
  LOCK=$(aws wafv2 get-web-acl --id "$(echo "$WAF_ARN" | cut -d'/' -f2)" --name forge-platform-stage-waf --scope REGIONAL --region "$REGION" --query 'LockToken' --output text 2>/dev/null)
  echo "  Disassociate this Web ACL from the ALB in the AWS console (WAF → Web ACLs → Associated AWS resources), then:"
  echo "  aws wafv2 delete-web-acl --id $(echo "$WAF_ARN" | cut -d'/' -f2) --name forge-platform-stage-waf --scope REGIONAL --region $REGION --lock-token $LOCK"
else
  echo "  Web ACL not found or already deleted"
fi

echo "=== Done. Run: terraform apply -var=\"environment=stage\" -auto-approve -input=false ==="

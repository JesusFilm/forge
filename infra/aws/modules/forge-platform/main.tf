resource "aws_ecs_cluster" "this" {
  name = "forge-${var.environment}"
}

# Placeholder resources. Expand in environment stacks.
resource "aws_s3_bucket" "media" {
  bucket = "forge-media-${var.environment}"
}

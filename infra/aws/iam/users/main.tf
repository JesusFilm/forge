# Load each admin read-only user (billing via group membership).

module "tataihono" {
  source = "./tataihono"

  tags = var.tags
}

variable "environment" {
  type = string
}

variable "vercel_api_token" {
  type      = string
  sensitive = true
}
